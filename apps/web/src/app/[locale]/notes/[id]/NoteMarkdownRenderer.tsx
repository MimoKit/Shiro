'use client'

import { RuleType } from 'markdown-to-jsx'

import { MainMarkdown, type MarkdownToJSX } from '~/components/ui/markdown'
import { useCurrentNoteDataSelector } from '~/providers/note/CurrentNoteDataProvider'

const MarkdownRenderers: Partial<MarkdownToJSX.PartialRules> = {
  [RuleType.text]: {
    render(node: MarkdownToJSX.TextNode, _: any, state?: MarkdownToJSX.State) {
      return <span key={state?.key as React.Key}>{node.text}</span>
    },
  },
}

export const NoteMarkdownRenderer = () => {
  const content = useCurrentNoteDataSelector((data) => data?.data.content)
  const text = useCurrentNoteDataSelector((data) => data?.data.text)

  // 与文章页同理：content 才是 Markdown 正文，text 是纯文本摘要。
  // 手记目前两者内容一致，但 content_format=markdown 时以 content 为准更稳妥。
  const markdown =
    (typeof content === 'string' && content) ||
    (typeof text === 'string' && text) ||
    ''

  if (!markdown) return null
  return (
    <MainMarkdown
      className="mt-10"
      allowsScript
      renderers={MarkdownRenderers}
      variant="note"
      value={markdown}
    />
  )
}
