import Vue from 'vue';
import { filter, sortBy } from 'lodash';
import { asyncify, series } from 'async';

export const state = () => ({
  posts: {},
});

export const getters = {
  posts: (state) => (params = {}) =>
    sortBy(
      filter(state.posts, (post) => {
        if (params.tag) {
          if (params.tag.constructor === String) {
            return (post.caption || '').includes(params.tag);
          }
          if (params.tag.constructor === RegExp) {
            return params.tag.test(post.caption || '');
          }
        }
        return true;
      }),
      'timestamp'
    ).reverse(),
};

export const mutations = {
  POSTS(state, posts) {
    posts.forEach((post) => {
      Vue.set(state.posts, post.id, {
        ...(state.posts[post.id] || {}),
        ...post,
      });
    });
  },
};

export const actions = {
  async fetchRecent(
    { commit },
    { userId = undefined, limit = 20, children = false } = {}
  ) {
    let instagramApiBaseUrl = `provider/instagram/api`;

    if (userId) {
      instagramApiBaseUrl = `provider/instagram/${userId}/api`;
    }

    const { id: instagramUserId } = await this.$api.$get(
      `${instagramApiBaseUrl}/me`
    );

    let posts = [];
    let after;

    let seriesTasks = Array(Math.ceil(limit / 20)).fill(null);

    seriesTasks = seriesTasks.map(() =>
      asyncify(async () => {
        const { data, paging } = await this.$api.$get(
          `${instagramApiBaseUrl}/${instagramUserId}/media`,
          {
            params: {
              fields:
                'id,media_type,media_url,thumbnail_url,caption,permalink,timestamp,username',
              limit: Math.min(limit, 20),
              after,
            },
          }
        );

        after = paging.cursors.after;

        posts = posts.concat(data);
      })
    );

    await new Promise((resolve) => series(seriesTasks, resolve));

    if (children) {
      await Promise.all(
        posts.map(async (post) => {
          if (post.media_type === 'CAROUSEL_ALBUM') {
            const { data: children } = await this.$api.$get(
              `${instagramApiBaseUrl}/${post.id}/children`,
              {
                params: {
                  fields: 'id,media_type,media_url,thumbnail_url',
                },
              }
            );

            post.children = children;
          }
          return post;
        })
      );
    }

    commit('POSTS', posts);

    return posts;
  },
};
