'use client'

import { MainMarkdown } from '~/components/ui/markdown'
import { useCurrentPostDataSelector } from '~/providers/post/CurrentPostDataProvider'

export const PostMarkdownRenderer = () => {
  const content = useCurrentPostDataSelector((data) => data?.content)
  const text = useCurrentPostDataSelector((data) => data?.text)
  const isTranslated = useCurrentPostDataSelector((data) =>
    Boolean((data as any)?.translationMeta?.isTranslated),
  )

  // Core v14 在开启 AI 翻译时，会将翻译后的 Markdown 存入 `text` 字段，
  // 而 `content` 仍保留原文。因此在译文模式下，必须优先使用 `text`；
  // 未翻译时两者均为完整 Markdown 正文。
  const markdown = isTranslated
    ? (typeof text === 'string' && text) ||
      (typeof content === 'string' && content) ||
      ''
    : (typeof content === 'string' && content) ||
      (typeof text === 'string' && text) ||
      ''

  if (!markdown) return null
  return (
    <MainMarkdown
      allowsScript
      value={markdown}
      className="min-w-0 overflow-hidden"
    />
  )
}
