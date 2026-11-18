import { Suspense } from 'react'

import { CommentBoxRootLazy, CommentsLazy } from '~/components/modules/comment'
import { MotionButtonBase } from '~/components/ui/button'
import { Link } from '~/i18n/navigation'
import { apiClient } from '~/lib/request'

import { ThinkingItem } from '../item'

export default async function Page(props: {
  params: Promise<{
    id: string
  }>
}) {
  const params = await props.params
  const data = await apiClient.recently.getById(params.id)
  // v14 详情若是 {data, meta} 多键信封先解包（单键时回退本体）
  const serialized = data.$serialized as any
  const item = serialized?.data ?? serialized

  return (
    <div>
      <header className="prose">
        <h1 className="flex items-end gap-2">
          思考
          <a
            data-event="Say RSS click"
            aria-hidden
            href="/thinking/feed"
            target="_blank"
            className="center flex size-8 select-none text-[#EE802F]"
            rel="noreferrer"
          >
            <i className="i-mingcute-rss-fill" />
          </a>
        </h1>
        <h3>谢谢你听我诉说</h3>
      </header>

      <main className="-mt-12">
        <MotionButtonBase>
          <Link
            href="/thinking"
            className="flex items-center gap-2"
            data-event="Say back click"
          >
            <i className="i-mingcute-arrow-left-circle-line" />
            返回
          </Link>
        </MotionButtonBase>
        <ThinkingItem item={item} />

        {data.allowComment && (
          <Suspense>
            <CommentBoxRootLazy className="mb-12 mt-6" refId={data.id} />
            <CommentsLazy refId={data.id} />
          </Suspense>
        )}
      </main>
    </div>
  )
}
