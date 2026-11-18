import { cache } from 'react'

import { attachServerFetch } from '~/lib/attach-fetch'
import { apiClient } from '~/lib/request'
import { requestErrorHandler } from '~/lib/request.server'

export interface PageParams extends LocaleParams {
  slug: string
}

export const getData = cache(async (slug: string) => {
  await attachServerFetch()
  const data = await apiClient.page
    .getBySlug(slug, { prefer: 'lexical' })
    .catch(requestErrorHandler)

  // 与 queries/definition/page.ts、post.ts 对齐：Core v14 详情可能是
  // {data, meta} 多键信封，消费方直读本体字段，先解包并提取翻译信息
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
})
