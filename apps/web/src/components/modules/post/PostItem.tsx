import type { PostListItem } from '@mx-space/api-client'
import clsx from 'clsx'
import { memo } from 'react'
import RemoveMarkdown from 'remove-markdown'

import { useIsOwnerLogged } from '~/atoms/hooks/owner'
import { PostPinIcon } from '~/components/modules/post/PostPinIcon'
import { MagneticHoverEffect } from '~/components/ui/effect/MagneticHoverEffect'
import { Link } from '~/i18n/navigation'

import { PostMetaBar } from './PostMetaBar'

export const PostLooseItem = memo<{ data: PostListItem }>(
  function PostLooseItem({ data }) {
    const text = data.text ?? ''
    // 先剥离全文再截断：短文本分支之前完全不剥离，正文里的图片/链接
    // 语法会原样露在卡片摘要里；长文本先截后剥则会在语法中间截断、
    // 剥不干净。统一成先剥后截。
    const strippedText = RemoveMarkdown(text)
    const displayText =
      strippedText.length > 300
        ? `${strippedText.slice(0, 300)}...`
        : strippedText
    // 封面优先用 meta.cover（与详情页、首页 ld+json 的既有约定一致），
    // 正文提取的第一张图只兜底——否则文末的正文图会被当成卡片封面
    const hasImage =
      (data as any).meta?.cover ||
      (data.images?.length > 0 && data.images[0].src)
    const categorySlug = data.category?.slug
    const postLink = `/posts/${categorySlug}/${data.slug}`

    const isLogged = useIsOwnerLogged()
    return (
      <MagneticHoverEffect
        as={Link}
        href={postLink}
        className="relative flex cursor-pointer! flex-col py-8 before:-inset-x-6 focus-visible:shadow-none!"
      >
        <h2 className="relative break-words text-2xl font-medium">
          <div
            className={clsx(
              'flex items-baseline gap-2',
              isLogged || data.pin ? 'w-[calc(100%-2rem)]' : 'w-full',
            )}
          >
            <span>{data.title}</span>
          </div>

          <PostPinIcon pin={!!data.pin} id={data.id} />
        </h2>
        <div className="relative mt-8 space-y-2">
          {!!data.summary && (
            <p className="mb-4 break-all rounded-md px-4 py-2 text-sm leading-relaxed text-zinc-900 ring-1 ring-accent/10 dark:text-zinc-50">
              摘要： {data.summary}
            </p>
          )}
          <div className="relative overflow-hidden text-justify">
            {hasImage && (
              <div
                className={clsx(
                  'float-right mb-2 ml-3 size-[5.5rem] overflow-hidden rounded-md',
                  'bg-cover bg-center bg-no-repeat',
                )}
                style={{ backgroundImage: `url(${hasImage})` }}
              />
            )}
            <p className="break-all leading-loose text-zinc-800/90 dark:text-zinc-200/90">
              {displayText}
            </p>
          </div>
        </div>

        <div className="mt-2 flex select-none flex-wrap items-center justify-end gap-4 text-base-content/60">
          <PostMetaBar meta={data} />
          <span className="flex shrink-0 select-none items-center space-x-1 text-right text-accent hover:text-accent [&>svg]:hover:ml-2">
            <span>阅读全文</span>
            <i className="i-mingcute-arrow-right-line text-lg transition-[margin]" />
          </span>
        </div>
      </MagneticHoverEffect>
    )
  },
)

export const PostCompactItem = memo<{ data: PostListItem }>(
  function PostCompactItem({ data }) {
    const categorySlug = data.category?.slug
    const postLink = `/posts/${categorySlug}/${data.slug}`

    const isLogged = useIsOwnerLogged()
    return (
      <MagneticHoverEffect
        as={Link}
        href={postLink}
        className="relative flex cursor-pointer! flex-col py-8 before:-inset-x-6 focus-visible:shadow-none!"
      >
        <h2 className="relative break-words text-2xl font-medium">
          <div
            className={clsx(
              'flex items-baseline gap-2',
              isLogged || data.pin ? 'w-[calc(100%-2rem)]' : 'w-full',
            )}
          >
            <span>{data.title}</span>
          </div>

          <PostPinIcon pin={!!data.pin} id={data.id} />
        </h2>
        <div className="relative mt-4 space-y-2">
          <div className="relative overflow-hidden text-justify">
            {data.summary && (
              <p className="mb-2 break-all leading-loose text-zinc-800/90 dark:text-zinc-200/90">
                {data.summary}
              </p>
            )}
          </div>
        </div>

        <div className="post-meta-bar flex select-none flex-wrap items-center justify-end gap-4 text-base-content/60">
          <PostMetaBar meta={data} />
        </div>
      </MagneticHoverEffect>
    )
  },
)
