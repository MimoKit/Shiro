import { apiClient } from '~/lib/request'

import { defineQuery } from '../helper'

export const page = {
  bySlug: (slug: string) =>
    defineQuery({
      queryKey: ['page', slug],

      queryFn: async ({ queryKey }) => {
        const [, slug] = queryKey

        const data = await apiClient.page.getBySlug(slug, {
          prefer: 'lexical',
        })

        // 与 post.ts 对齐：Core v14 详情可能是 {data, meta} 多键信封
        // （管线 A 保留外层），消费方直读本体字段，必须先解包，
        // 并把 meta.translation 提取出来（之前整层被丢弃）
        const serialized = data.$serialized as any
        const pageObj = serialized?.data ?? serialized

        if (pageObj && serialized?.meta) {
          const { translation } = serialized.meta
          const transArticle =
            translation?.article ||
            (translation && typeof translation === 'object'
              ? (Object.values(translation)[0] as any)?.article
              : undefined)
          if (transArticle) {
            pageObj.translationMeta = transArticle
            pageObj.availableTranslations =
              transArticle.availableTranslations ??
              transArticle.available_translations ??
              []
          }
        }

        return pageObj
      },
    }),
}
