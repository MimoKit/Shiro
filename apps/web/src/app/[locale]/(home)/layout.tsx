import { dehydrate } from '@tanstack/react-query'

import { QueryHydrate } from '~/components/common/QueryHydrate'
import { isShallowEqualArray } from '~/lib/lodash'
import { getQueryClient } from '~/lib/query-client.server'
import { apiClient } from '~/lib/request'
import { definePrerenderPage, requestErrorHandler } from '~/lib/request.server'

import { ActivityScreen } from './components/ActivityScreen'
import { Hero } from './components/Hero'
import { HomePageTimeLine } from './components/HomePageTimeLine'
import { Windsock } from './components/Windsock'
import { queryKey } from './query'

export const dynamic = 'force-dynamic'

export default definePrerenderPage()({
  fetcher() {
    const queryClient = getQueryClient()

    return queryClient
      .fetchQuery({
        queryKey,
        queryFn: async () => {
          const res = await apiClient.aggregate.getTop(5)
          // 兼容两种形状：已解包（{notes,posts,says,...}）与 v14 原始信封（{data:{...}}）。
          // 旧写法直接取 $serialized，在 v14 下会得到 {data:{...}}，
          // 于是子组件 `[...notes, ...posts]` 抛 "notes is not iterable" → 首页 500。
          const payload: any = res?.$serialized ?? res
          const data = payload?.data ?? payload
          return {
            notes: Array.isArray(data?.notes) ? data.notes : [],
            posts: Array.isArray(data?.posts) ? data.posts : [],
            says: Array.isArray(data?.says) ? data.says : [],
            recently: Array.isArray(data?.recently) ? data.recently : [],
          }
        },
      })
      .catch(requestErrorHandler)
  },
  async Component(props) {
    const queryClient = getQueryClient()

    const dehydrateState = dehydrate(queryClient, {
      shouldDehydrateQuery(query) {
        return isShallowEqualArray(query.queryKey as any, queryKey)
      },
    })

    return (
      <QueryHydrate state={dehydrateState}>
        <Hero />
        <ActivityScreen />
        <HomePageTimeLine />
        <Windsock />
        {props.children}
      </QueryHydrate>
    )
  },
})
