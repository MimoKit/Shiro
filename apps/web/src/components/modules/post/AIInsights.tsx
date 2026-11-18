'use client'

import { useQuery } from '@tanstack/react-query'
import { m } from 'motion/react'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Markdown } from '~/components/ui/markdown'
import { API_URL } from '~/constants/env'
import { clsxm } from '~/lib/helper'

interface AIInsightsProps {
  id: string
  lang?: string
  /**
   * 来自详情响应 meta.insights（has_in_locale）。
   * 明确为 false 时不发请求、直接显示占位；undefined 时照常请求。
   */
  hasInsights?: boolean
  className?: string
}

export const AIInsights = ({
  id,
  lang = 'zh',
  hasInsights,
  className,
}: AIInsightsProps) => {
  const t = useTranslations('common')
  const [isOpen, setIsOpen] = useState(false)

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['ai-insights', id, lang],
    queryFn: async () => {
      const res = await fetch(
        `${API_URL}/ai/insights/article/${id}?lang=${lang}`,
      )
      // 只有 404 才是「没生成」；5xx / 网络错误 / 登录失效等失败必须抛错，
      // 不能吞成 null —— 否则一次瞬时失败会被当成「暂未生成」，
      // 再被 staleTime 焊住，出现「后台有、点进去没有」。
      if (res.status === 404) return null
      if (!res.ok) throw new Error(`insights request failed: ${res.status}`)
      const json = await res.json()
      return (json?.data?.content as string | undefined) ?? null
    },
    // 有内容缓存 30 分钟；空结果不缓存，下次展开重新查询
    staleTime: (query) => (query.state.data ? 1000 * 60 * 30 : 0),
    retry: 2,
    enabled: isOpen && hasInsights !== false, // Only fetch when expanded
  })

  return (
    <div
      data-hide-print
      className={clsxm(
        'my-6 overflow-hidden rounded-2xl border border-neutral-200/80 bg-neutral-50/50 p-4 transition-all dark:border-neutral-800 dark:bg-neutral-900/40',
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center gap-2 text-sm font-medium text-neutral-800 transition-colors hover:text-accent dark:text-neutral-200"
        >
          <span className="flex size-6 items-center justify-center rounded-lg bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300">
            <i
              className={clsxm(
                'text-sm transition-transform duration-200',
                isOpen ? 'i-mingcute-book-open-line' : 'i-mingcute-book-2-line',
              )}
            />
          </span>
          <span>
            {isOpen ? '收起 AI 精读手记' : '此文有 AI 精读手记（余白伴读）'}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          className="text-xs text-accent transition-opacity hover:opacity-80"
        >
          {isOpen ? '收起 ↗' : '展开阅读 ↘'}
        </button>
      </div>

      {isOpen && (
        <m.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          transition={{ duration: 0.3, ease: 'easeInOut' }}
          className="mt-4 border-t border-neutral-200/60 pt-4 dark:border-neutral-800/60"
        >
          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-xs text-neutral-400">
              <i className="i-mingcute-loading-line mr-2 animate-spin text-base" />
              正在提取精读要点...
            </div>
          ) : isError ? (
            <div className="py-4 text-center text-xs text-neutral-400">
              <p>精读加载失败。</p>
              <button
                type="button"
                onClick={() => refetch()}
                className="mt-2 text-accent transition-opacity hover:opacity-80"
              >
                点此重试
              </button>
            </div>
          ) : data ? (
            <div className="prose prose-sm dark:prose-invert max-w-none text-[13.5px] leading-relaxed">
              <Markdown value={data} />
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-neutral-400">
              暂未生成此篇的精读手记。
            </div>
          )}
        </m.div>
      )}
    </div>
  )
}
