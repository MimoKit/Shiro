import { TimelineType } from '@mx-space/api-client'
import { dehydrate } from '@tanstack/react-query'
import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'
import type { PropsWithChildren } from 'react'

import { QueryHydrate } from '~/components/common/QueryHydrate'
import { SearchFAB } from '~/components/modules/shared/SearchFAB'
import { getQueryClient } from '~/lib/query-client.server'
import { definePrerenderPage } from '~/lib/request.server'

import { fetchTimeline } from './data'

export const generateMetadata = async (
  props: NextPageParams<{ locale: string }>,
): Promise<Metadata> => {
  const { locale } = await props.params
  const t = await getTranslations({
    namespace: 'common',
    locale,
  })
  return {
    title: t('page_title_timeline'),
  }
}

export const dynamic = 'force-dynamic'

export default definePrerenderPage<{
  type: string
  year: string
}>()({
  async fetcher({ type, year }) {
    const nextType = {
      post: TimelineType.Post,
      note: TimelineType.Note,
    }[type]
    const queryClient = getQueryClient()
    await queryClient.fetchQuery({
      queryKey: ['timeline', nextType, year],
      // server 侧显式规约成「纯 plain 数据」再交给 dehydrate：
      //  - data 层是 api-client 的响应对象（带 $raw/$request/$serialized getter 与多层信封），
      //    不同 Core 版本/接口前缀下 data 的层级还不一致；
      //  - @tanstack/query-core 的 dehydrate 使用恒等 serializeData，会把值原样放进 RSC payload。
      // 规约后进入 payload 的只有纯 plain object/array + string，RSC 序列化与客户端渲染形状都被固定。
      // （实测：v14 下时间字段为 createdAt，页面若读 .created 会得到 Invalid Date →
      //   Intl.DateTimeFormat.format() 抛 RangeError: Invalid time value，这才是 /timeline 500 的真因。）
      queryFn: () =>
        fetchTimeline({
          type: nextType,
          year: +(year || 0) || undefined,
        }),
    })
  },
  Component: async (props: PropsWithChildren) => {
    const queryClient = getQueryClient()
    return (
      <QueryHydrate
        state={dehydrate(queryClient, {
          shouldDehydrateQuery: (query) => query.queryKey[0] === 'timeline',
        })}
      >
        {props.children}

        <SearchFAB />
      </QueryHydrate>
    )
  },
})
