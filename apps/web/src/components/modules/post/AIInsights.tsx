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
  className?: string
}

export const AIInsights = ({ id, lang = 'zh', className }: AIInsightsProps) => {
  const t = useTranslations('common')
  const [isOpen, setIsOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['ai-insights', id, lang],
    queryFn: async () => {
      const res = await fetch(
        `${API_URL}/ai/insights/article/${id}?lang=${lang}`,
      )
      if (!res.ok) return null
      const json = await res.json()
      return json?.data?.content as string | undefined
    },
    staleTime: 1000 * 60 * 30, // 30 mins
    enabled: isOpen, // Only fetch when expanded
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
