import type { TimelineType } from '@mx-space/api-client'

import { apiClient } from '~/lib/request'

/**
 * Timeline 数据的「纯 plain 化」规约层。
 *
 * 为什么需要它：
 * 1) 结构确定性：timeline/layout.tsx 会把 fetchQuery 的结果交给 `dehydrate()` 并传给客户端
 *    组件 <QueryHydrate>；@tanstack/query-core 的 dehydrate 使用恒等 serializeData，会把值
 *    原样放进 RSC payload。而 api-client 的响应对象带 `$raw/$request/$serialized` getter，
 *    且不同 Core 版本下 `{data}` 信封层级不一致。这里显式规约成「纯 plain object/array +
 *    string」，进入 payload 的形状被固定，不随数据层实现变化。
 *    （注：实测这些响应对象原型为 Object.prototype，本身不会触发 React flight 的
 *     "Only plain objects..." 抛错；规约的价值在于形状确定 + 顺带统一下面的时间字段。）
 * 2) 字段兼容 / 真正导致 500 的原因：不同 Core 版本下时间字段既可能是 `created` 也可能是
 *    `createdAt`（v14 原始响应为 `created_at`，经 camelCase 后为 `createdAt`）。
 *    页面若读不到会得到 `new Date(undefined)` → Invalid Date →
 *    `Intl.DateTimeFormat.format()` 抛 `RangeError: Invalid time value`，
 *    这正是 /timeline 500 的实测真因。这里统一归一化并让调用侧跳过非法日期。
 */

export interface TimelinePostItem {
  id: string
  title: string
  slug: string
  createdAt: string | null
  category?: {
    name?: string
    slug?: string
  }
}

export interface TimelineNoteItem {
  id: string
  nid: number
  title: string
  createdAt: string | null
  weather?: string | null
  mood?: string | null
  bookmark?: boolean
}

export interface TimelineDataPlain {
  posts: TimelinePostItem[]
  notes: TimelineNoteItem[]
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value ? value : null

/** 兼容 `created` / `createdAt` / `created_at` 三种写法 */
const pickDate = (item: Record<string, any>): string | null =>
  asString(item?.createdAt) ??
  asString(item?.created) ??
  asString(item?.created_at) ??
  null

/**
 * 把任意层级的响应信封剥开，拿到真正的 { posts, notes }。
 * 兼容三种形态：
 *   - 已解包：{ posts, notes }
 *   - 单层信封：{ data: { posts, notes } }（v14 原始响应外层包了一层 data）
 */
const unwrapTimelinePayload = (
  payload: any,
): { posts: any[]; notes: any[] } => {
  const candidates = [
    payload,
    payload?.data,
    payload?.data?.data,
    payload?.$serialized,
    payload?.$serialized?.data,
  ]
  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === 'object' &&
      (Array.isArray(candidate.posts) || Array.isArray(candidate.notes))
    ) {
      return {
        posts: Array.isArray(candidate.posts) ? candidate.posts : [],
        notes: Array.isArray(candidate.notes) ? candidate.notes : [],
      }
    }
  }
  return { posts: [], notes: [] }
}

/** 只挑出需要渲染的字段，保证产出是纯 plain object / array */
export const normalizeTimelineData = (payload: any): TimelineDataPlain => {
  const { posts, notes } = unwrapTimelinePayload(payload)

  return {
    posts: posts.map((post: any) => ({
      id: String(post?.id ?? ''),
      title: typeof post?.title === 'string' ? post.title : '',
      slug: typeof post?.slug === 'string' ? post.slug : '',
      createdAt: pickDate(post),
      category: post?.category
        ? {
            name:
              typeof post.category.name === 'string'
                ? post.category.name
                : undefined,
            slug:
              typeof post.category.slug === 'string'
                ? post.category.slug
                : undefined,
          }
        : undefined,
    })),
    notes: notes.map((note: any) => ({
      id: String(note?.id ?? ''),
      nid: typeof note?.nid === 'number' ? note.nid : Number(note?.nid) || 0,
      title: typeof note?.title === 'string' ? note.title : '',
      createdAt: pickDate(note),
      weather: typeof note?.weather === 'string' ? note.weather : null,
      mood: typeof note?.mood === 'string' ? note.mood : null,
      bookmark: !!note?.bookmark,
    })),
  }
}

/**
 * 统一入口：请求 timeline 并返回已规约的纯 plain 数据。
 * server（layout）与 client（page）共用，保证两侧形状一致。
 */
export const fetchTimeline = async (options: {
  type?: TimelineType
  year?: number
}): Promise<TimelineDataPlain> => {
  const response = await apiClient.aggregate.getTimeline({
    type: options.type,
    year: options.year,
  })

  return normalizeTimelineData(response)
}
