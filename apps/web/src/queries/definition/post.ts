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
          const {meta} = serialized
          const { translation } = meta
          const transArticle =
            translation?.article ||
            (translation && typeof translation === 'object'
              ? (Object.values(translation)[0] as any)?.article
              : undefined)
          if (transArticle) {
            postObj.translationMeta = transArticle
            // generateMetadata 的 hreflang 读的是文章对象顶层的
            // availableTranslations，之前从没被挂上，恒为 undefined
            postObj.availableTranslations =
              transArticle.availableTranslations ??
              transArticle.available_translations ??
              []
          }

          // Core v14 的 AI 摘要不在文章本体的 summary 字段（那是手写摘要），
          // 而在 meta.summary.text 里；页面一直读 data.summary，
          // 导致 AI 摘要卡片要么张冠李戴、要么永远不出现。
          const aiSummary = meta.summary
          if (aiSummary?.text) {
            postObj.aiSummary = aiSummary.text as string
          }

          // 精读有无的服务端结论（meta.insights.has_in_locale，归一化后
          // 键名转驼峰），供 AIInsights 决定要不要发请求
          const {insights} = meta
          if (insights && typeof insights === 'object') {
            const hasInLocale = insights.hasInLocale ?? insights.has_in_locale
            if (typeof hasInLocale === 'boolean') {
              postObj.hasInsightsInLocale = hasInLocale
            }
          }
        }

        return postObj as PostWithTranslation
      },
    }),
}
