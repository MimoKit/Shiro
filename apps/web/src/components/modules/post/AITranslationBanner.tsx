'use client'

import { useQuery } from '@tanstack/react-query'
import { usePathname, useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import { memo } from 'react'

import { API_URL } from '~/constants/env'
import { clsxm } from '~/lib/helper'

interface AITranslationBannerProps {
  id: string
  sourceLang?: string
  className?: string
}

const LANGUAGE_LABELS: Record<string, string> = {
  zh: '简体中文',
  ja: '日本語',
  en: 'English',
  ko: '한국어',
}

export const AITranslationBanner = memo(
  ({ id, sourceLang = 'zh', className }: AITranslationBannerProps) => {
    const locale = useLocale()
    const router = useRouter()
    const pathname = usePathname()

    const { data: languages } = useQuery({
      queryKey: ['ai-translation-languages', id],
      queryFn: async () => {
        const res = await fetch(
          `${API_URL}/ai/translations/article/${id}/languages`,
        )
        if (!res.ok) return []
        const json = await res.json()
        return (json?.data || []) as string[]
      },
      staleTime: 1000 * 60 * 30,
    })

    if (!languages || languages.length === 0) return null

    // All available languages = source language + target languages
    const allLangs = Array.from(new Set([sourceLang, ...languages]))

    const handleSwitchLang = (targetLang: string) => {
      // replace /zh/ or /ja/ or /en/ in current pathname
      let newPath = pathname
      const segments = pathname.split('/').filter(Boolean)
      if (['zh', 'ja', 'en', 'ko'].includes(segments[0])) {
        segments[0] = targetLang
        newPath = `/${  segments.join('/')}`
      } else {
        newPath = `/${targetLang}${pathname}`
      }
      router.push(newPath)
    }

    const isCurrentTranslated = locale !== sourceLang

    return (
      <div
        data-hide-print
        className={clsxm(
          'my-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200/80 bg-neutral-100/50 px-3.5 py-2 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900/40 dark:text-neutral-300',
          className,
        )}
      >
        <div className="flex items-center gap-2">
          <i className="i-mingcute-globe-line text-sm text-accent" />
          <span className="font-medium text-neutral-800 dark:text-neutral-200">
            {isCurrentTranslated ? '当前为 AI 译文' : '可用 AI 译文'}
          </span>
          {isCurrentTranslated && (
            <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] text-accent">
              已由 AI 保留格式翻译
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {allLangs.map((langCode) => {
            const isSelected = locale === langCode
            return (
              <button
                key={langCode}
                type="button"
                onClick={() => handleSwitchLang(langCode)}
                className={clsxm(
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition-all',
                  isSelected
                    ? 'bg-accent text-white shadow-sm dark:text-black'
                    : 'bg-white/80 hover:bg-neutral-200 dark:bg-neutral-800 dark:hover:bg-neutral-700',
                )}
              >
                {LANGUAGE_LABELS[langCode] || langCode.toUpperCase()}
                {langCode === sourceLang && !isSelected && ' (原文)'}
              </button>
            )
          })}
        </div>
      </div>
    )
  },
)

AITranslationBanner.displayName = 'AITranslationBanner'
