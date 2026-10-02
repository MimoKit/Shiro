'use client'

import { useTranslations } from 'next-intl'
import { memo } from 'react'

import { Markdown } from '~/components/ui/markdown'
import { clsxm } from '~/lib/helper'

interface AISummaryProps {
  summary?: string | null
  className?: string
}

export const AISummary = memo(({ summary, className }: AISummaryProps) => {
  const t = useTranslations('common')

  if (!summary || !summary.trim()) return null

  return (
    <div
      data-hide-print
      className={clsxm(
        'relative my-6 overflow-hidden rounded-2xl border border-accent/25 bg-gradient-to-br from-accent/10 via-accent/5 to-transparent p-5 text-neutral-900 transition-all dark:text-neutral-100',
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-accent/15 pb-3">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-lg bg-accent text-white dark:text-black">
            <i className="i-mingcute-ai-fill text-sm" />
          </span>
          <span className="text-sm font-semibold tracking-wide text-accent">
            {t('ai_key_insights') || 'AI 摘要'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 rounded-full bg-accent/10 px-2.5 py-0.5 text-[11px] font-medium text-accent">
          <span className="size-1.5 animate-pulse rounded-full bg-accent" />
          <span className="font-mono uppercase tracking-wider">AI·GEN</span>
        </div>
      </div>

      <div className="mt-3.5 text-[14px] leading-relaxed opacity-90">
        <Markdown value={summary} />
      </div>
    </div>
  )
})

AISummary.displayName = 'AISummary'
