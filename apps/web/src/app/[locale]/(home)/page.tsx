'use client'

import { useEffect } from 'react'
import type { Blog, ItemList, WithContext } from 'schema-dts'

import { registerPushWorker } from '~/lib/push-worker'
import { useAggregationSelector } from '~/providers/root/aggregation-data-provider'

import { useHomeQueryData } from './query'

export default function Home() {
  useEffect(() => {
    registerPushWorker()
  }, [])
  const config = useAggregationSelector((state) => ({
    user: state.user,
    seo: state.seo,
    url: state.url,
  }))
  const ldJson: WithContext<Blog> = {
    '@context': 'https://schema.org',
    '@type': 'Blog',
    name: config?.seo.title,
    url: config?.url.webUrl,
    description: config?.seo.description,
    author: {
      '@type': 'Person',
      name: config?.user.name,
      url: config?.url.webUrl,
    },
    publisher: {
      '@type': 'Person',
      name: config?.user.name,
      url: config?.url.webUrl,
    },
    image: {
      '@type': 'ImageObject',
      url: `${config?.url.webUrl}/home-og`,
    },
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': config?.url.webUrl,
    },
    keywords: config?.seo.keywords,
  }
  const { notes, posts } = useHomeQueryData()
  // getTop 的条目在不同 Core 版本下时间字段可能是 created / createdAt，
  // 这里统一取值，避免 Invalid Date（并在排序时兜底）。
  const pickCreated = (item: any): string | undefined =>
    item?.created ?? item?.createdAt ?? undefined
  const toTime = (item: any) => {
    const t = new Date(pickCreated(item) ?? 0).getTime()
    return Number.isNaN(t) ? 0 : t
  }
  const listLdJson: WithContext<ItemList> = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: [...(notes ?? []), ...(posts ?? [])]
      .sort((a, b) => toTime(b) - toTime(a))
      .map((article, index) => ({
        '@type': 'ListItem',
        position: index + 1,
        item: {
          '@type': 'BlogPosting',
          author: {
            '@type': 'Person',
            name: config?.user.name,
            url: config?.url.webUrl,
          },
          headline: article.title,
          image: article.meta?.cover || [],
          name: article.title,
          url:
            'nid' in article
              ? `${config?.url.webUrl}/notes/${article.nid}`
              : `${config?.url.webUrl}/posts/${article.category?.slug ?? ''}/${article.slug}`,
          datePublished: pickCreated(article),
        },
      })),
  }
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(ldJson),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(listLdJson),
        }}
      />
    </>
  )
}
