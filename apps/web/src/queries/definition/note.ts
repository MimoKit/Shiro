import type { NoteWrappedWithLikedAndTranslationPayload } from '@mx-space/api-client'

import { apiClient } from '~/lib/request'

import { defineQuery } from '../helper'

const LATEST_KEY = 'latest'
export const note = {
  byNid: (nid: string, password?: string | null, lang?: string) =>
    defineQuery({
      queryKey: ['note', nid, lang],

      queryFn: async ({ queryKey }) => {
        const [, id, lang] = queryKey as [string, string, string | undefined]

        if (id === LATEST_KEY) {
          return (await apiClient.note.getLatest()).$serialized
        }
        const data = await apiClient.note.getNoteByNid(Number(id), {
          password: password || undefined,
          lang: lang || undefined,
          prefer: 'lexical',
        })

        const serialized = data.$serialized as any

        // 与 post.ts 对齐：Core v14 详情响应的 meta 里带着翻译/AI 信息，
        // 之前整层被丢弃，导致手记页的 translationMeta 恒 undefined、
        // hreflang 缺失，AI 组件也拿不到判断依据。
        // 注意保持 wrapper 形状不变（页面依赖 data.data 取手记本体）。
        const noteObj = serialized?.data
        if (noteObj && serialized?.meta) {
          const {meta} = serialized
          const { translation } = meta
          const transArticle =
            translation?.article ||
            (translation && typeof translation === 'object'
              ? (Object.values(translation)[0] as any)?.article
              : undefined)
          if (transArticle) {
            noteObj.translationMeta = transArticle
            noteObj.availableTranslations =
              transArticle.availableTranslations ??
              transArticle.available_translations ??
              []
            serialized.translationMeta = transArticle
          }

          const aiSummary = meta.summary
          if (aiSummary?.text) {
            noteObj.aiSummary = aiSummary.text as string
          }

          const {insights} = meta
          if (insights && typeof insights === 'object') {
            const hasInLocale = insights.hasInLocale ?? insights.has_in_locale
            if (typeof hasInLocale === 'boolean') {
              noteObj.hasInsightsInLocale = hasInLocale
            }
          }
        }

        return serialized as NoteWrappedWithLikedAndTranslationPayload
      },
    }),
}
