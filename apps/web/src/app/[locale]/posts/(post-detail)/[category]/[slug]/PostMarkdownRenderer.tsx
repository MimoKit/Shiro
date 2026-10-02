'use client'

import { MainMarkdown } from '~/components/ui/markdown'
import { useCurrentPostDataSelector } from '~/providers/post/CurrentPostDataProvider'

export const PostMarkdownRenderer = () => {
  const content = useCurrentPostDataSelector((data) => data?.content)
  const text = useCurrentPostDataSelector((data) => data?.text)

  // Core v14 在 content_format=markdown 时同时返回两个字段：
  //   content = Markdown 正文（标题 / 列表 / 代码块 / 表格 等原始 Markdown 源）
  //   text    = 纯文本摘要（仅用于列表摘要与 SEO description）
  // 旧写法只读 `text`，会把「摘要」当正文渲染 → 文章正文（标题、代码块、表格）全部丢失。
  // 这里优先 content，仅在 content 缺失时回退 text（兼容旧 Core 形态）。
  const markdown =
    (typeof content === 'string' && content) ||
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
