import type { AggregateRoot } from '@mx-space/api-client'
import { $fetch } from 'ofetch'

import { defaultThemeConfig } from '~/app.default.theme-config'
import { appStaticConfig } from '~/app.static.config'
import { attachServerFetch } from '~/lib/attach-fetch'
import { getDataFromResponse } from '~/lib/fetch/normalize'
import { deepMerge } from '~/lib/lodash'
import { getQueryClient } from '~/lib/query-client.server'
import { apiClient } from '~/lib/request'

const cacheTime = appStaticConfig.cache.enabled
  ? appStaticConfig.cache.ttl.aggregation
  : 1
export const fetchAggregationData = async () => {
  await attachServerFetch()
  const queryClient = getQueryClient()
  const fetcher = async () => {
    // 注意：这条通路是**裸 `$fetch`**，不经过 api-client 的
    // `getDataFromResponse`。旧实现只做了 `simpleCamelcaseKeys`，
    // 它只转换命名而**不解包** `{ data: ... }` 信封，导致 Core v14 下
    // `data.theme` 恒为 undefined（首页 theme/url 全部落空）。
    // 这里改用统一的归一化层，与 api-client 通路保持完全一致。
    const raw = await $fetch<unknown>(
      apiClient.aggregate.proxy.toString(true),
      {
        params: {
          theme: 'shiro',
        },
      },
    )

    const data = getDataFromResponse(raw) as AggregateRoot & {
      theme: AppThemeConfig
    }

    return {
      ...data,
      theme: data.theme
        ? deepMerge(defaultThemeConfig, data.theme)
        : defaultThemeConfig,
    }
  }

  return queryClient.fetchQuery({
    queryKey: ['aggregate', 'shiro'],
    queryFn: fetcher,
    staleTime: cacheTime,
    gcTime: cacheTime,
  })
}
