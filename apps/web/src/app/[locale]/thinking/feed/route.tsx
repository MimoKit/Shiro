import type { AggregateRoot } from '@mx-space/api-client'
import RSS from 'rss'

import { apiClient } from '~/lib/request'

export const dynamic = 'force-dynamic'
export const revalidate = 86400 // 1 day

export async function GET() {
  const [agg, thinking] = await Promise.all([
    // 走站内 apiClient（已注入 v14 归一化）；之前这里裸 fetch 聚合接口
    // 再 simpleCamelcaseKeys，v14 信封下 agg.seo 恒 undefined 直接 500
    apiClient.aggregate.getAggregateData('shiro') as Promise<AggregateRoot>,
    apiClient.recently.getList({
      size: 20,
    }) as Promise<any>,
  ])

  const { title, description } = agg.seo

  const now = new Date()
  const feed = new RSS({
    title: `思考 - ${title}`,
    description,
    site_url: agg.url.webUrl,
    feed_url: `${agg.url.webUrl}/thinking/feed`,
    language: 'zh-CN',
    generator: 'Shiro (https://github.com/Innei/Shiro)',
    pubDate: now.toUTCString(),
  })

  // /recently 是单键信封，管线 A 已解包成数组本身，不能再读 .data
  const thinkingList: any[] = Array.isArray(thinking)
    ? thinking
    : (thinking?.data ?? [])

  for (const t of thinkingList) {
    feed.item({
      title: new Date(t.created).toLocaleDateString(),
      description:
        `${t.content}\n\n${t.ref?.title ? `引用：${t.ref.title}` : ''}\n\n` +
        ` <p style='text-align: right'>
      <a href='${`${agg.url.webUrl}/thinking/${t.id}`}'>看完了？说点什么呢</a>
      </p>`,
      url: `${agg.url.webUrl}/thinking`,
      guid: t.id,
      date: t.created,
    })
  }

  return new Response(feed.xml(), {
    headers: {
      'Content-Type': 'application/xml',
      'Cache-Control': 'max-age=60, s-maxage=86400',
      'CDN-Cache-Control': 'max-age=86400',
      'Cloudflare-CDN-Cache-Control': 'max-age=86400',
      'Vercel-CDN-Cache-Control': 'max-age=86400',
    },
  })
}
