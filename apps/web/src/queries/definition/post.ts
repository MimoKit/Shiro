import type {
  ModelWithLiked,
  ModelWithTranslation,
  PostModel,
} from '@mx-space/api-client'

import { apiClient } from '~/lib/request'

import { defineQuery } from '../helper'

export type PostWithTranslation = ModelWithLiked<
  ModelWithTranslation<PostModel>
>

export const post = {
  bySlug: (category: string, slug: string, lang?: string) =>
    defineQuery({
      queryKey: ['post', category, slug, lang],

      queryFn: async ({ queryKey }) => {
        const [, category, slug, lang] = queryKey as [
          string,
          string,
          string,
          string | undefined,
        ]

        const data = await apiClient.post.getPost(category, slug, {
          lang: lang || undefined,
          prefer: 'lexical',
        })

        // 详情页把返回值**直接当 post 本体**使用（读 `data.contentFormat`
        // / `data.content` / `data.text`），因此这里必须解包一层。
        // Core v14 的详情响应是 `{ data: <post>, meta: {...} }`，归一化对
        // 多键信封保留外层，故取 `$serialized.data`；旧 Core 无信封时回退到
        // `$serialized` 自身。
        const serialized = data.$serialized as any
        const postObj = serialized?.data ?? serialized

        if (postObj && serialized?.meta) {
          const {translation} = serialized.meta
          const transArticle =
            translation?.article ||
            (translation && typeof translation === 'object'
              ? (Object.values(translation)[0] as any)?.article
              : undefined)
          if (transArticle) {
            postObj.translationMeta = transArticle
          }
        }

        return postObj as PostWithTranslation
      },
    }),
}
