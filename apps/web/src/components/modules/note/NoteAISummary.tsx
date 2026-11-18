'use client'

import { useQuery } from '@tanstack/react-query'

import { AISummary } from '~/components/modules/post/AISummary'
import { API_URL } from '~/constants/env'

interface NoteAISummaryProps {
  id: string
  lang?: string
}

/**
 * 手记的 AI 摘要不在手记载荷里（本体没有 summary 字段），
 * 只能单独拉取：GET /ai/summaries/article/:id（注意是复数 summaries，
 * 单数路径 404），返回形状 { data: { summary } }。
 * 文章页不走这里——文章的 AI 摘要在详情响应的 meta.summary 里。
 */
export const NoteAISummary = ({ id, lang = 'zh' }: NoteAISummaryProps) => {
  const { data } = useQuery({
    queryKey: ['ai-summary', 'note', id, lang],
    queryFn: async () => {
      const res = await fetch(
        `${API_URL}/ai/summaries/article/${id}?lang=${lang}`,
      )
      // 404 = 没生成；其余失败抛错走重试，不要吞成「没有」
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`summary request failed: ${res.status}`)
      const json = await res.json()
      return (json?.data?.summary as string | undefined) ?? null
    },
    staleTime: (query) => (query.state.data ? 1000 * 60 * 30 : 0),
    retry: 2,
  })

  return <AISummary summary={data} />
}
