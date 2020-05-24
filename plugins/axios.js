import toPlainObject from 'lodash/toPlainObject';
import hash from 'hash-obj';
// import sizeof from 'object-sizeof';
import * as Cookies from 'es-cookie';
import QuickLRU from 'quick-lru';

const getCacheKey = (config) => {
  let data = config.data;

  try {
    data = JSON.parse(data);
  } catch (error) {
    //
  }

  const hashObj = {
    method: config.method,
    url: config.url.replace(config.baseURL, ''),
    token: config.headers.common['x-api-token'],
    params: config.params,
    data,
  };

  return hash(toPlainObject(hashObj));
};

// TODO: check time and maxAge of stored value and destroy if necessary
// eslint-disable-next-line
const cacheGet = (cache, key, maxAge) => cache.get(key);

// TODO: set time and maxAge on stored value
// eslint-disable-next-line
const cacheSet = (cache, key, value, maxAge) => cache.set(key, value);

export default ({ $axios, env, store, req, res, query }, inject) => {
  const options = {
    API_URL: '',
    API_TOKEN: '',
    DEBUG: false,
    CACHE_ENABLED: true,
    CACHE_MAX_AGE: 30 * 60 * 1000, // 30 mins
    // CACHE_MAX_SIZE: 128 * 1000 * 1000, // 128mb
    // TODO: reimplement max size based on memory
    CACHE_MAX_SIZE: 1000,
    ROLE: 'guest',
    ...env,
  };

  let cache;

  if (options.CACHE_ENABLED) {
    cache = new QuickLRU({
      maxSize: options.CACHE_MAX_SIZE,
    });
  }

  const api = $axios.create({
    debug: options.DEBUG,
    proxyHeaders: false,
    baseURL: options.API_URL,
    headers: {
      common: {
        'x-api-token': options.API_TOKEN,
      },
    },
  });

  api.onRequest(
    (config) => {
      let cookies = {};
      if (req && req.headers.cookie) {
        cookies = Cookies.parse(req.headers.cookie);
      }

      if (res && query.apiToken) {
        let expires = new Date();
        expires.setHours(expires.getHours() + 1);

        res.setHeader(
          'Set-Cookie',
          Cookies.encode('apiToken', query.apiToken, {
            expires,
          })
        );
      }

      config.headers.common['x-api-token'] =
        query.apiToken || cookies.apiToken || options.API_TOKEN;

      const role = store.state.role || options.ROLE;

      if (options.CACHE_ENABLED && role === 'guest') {
        const key = getCacheKey(config);

        if (cache.has(key)) {
          const data = cacheGet(cache, key);

          config.data = data;

          // Set the request adapter to send the cached response
          // and prevent the request from actually running
          config.adapter = () =>
            Promise.resolve({
              data,
              status: config.status,
              statusText: config.statusText,
              headers: config.headers,
              config,
              request: config,
            });
        }
      }

      return config;
    },
    (error) => {
      // eslint-disable-next-line
      console.error(error);
      return Promise.reject(error);
    }
  );

  api.onResponse(
    (response) => {
      if (response.headers['x-role']) {
        store.commit('ROLE', response.headers['x-role']);
      }

      const role = store.state.role || options.ROLE;

      if (options.CACHE_ENABLED && role === 'guest') {
        let maxAge = options.CACHE_MAX_AGE;

        try {
          maxAge = JSON.parse(response.config.params.__cache);
        } catch (error) {
          //
        }

        if (maxAge !== false) {
          const key = getCacheKey(response.config);
          cacheSet(cache, key, response.data, maxAge);
        }
      }

      return response;
    },
    (error) => {
      // eslint-disable-next-line
      console.error(error);
      return Promise.reject(error);
    }
  );

  inject('api', api);
};
