import type { IRequestAdapter } from '@mx-space/api-client'
import createClient, { allControllers } from '@mx-space/api-client'
import type { $fetch } from 'ofetch'

import { API_URL } from '~/constants/env'

import { getDataFromResponse, transformResponse } from './normalize'

type FetchType = typeof $fetch
export const createFetchAdapter = (
  $fetch: FetchType,
): IRequestAdapter<typeof $fetch> => ({
  default: $fetch,
  get(url: string, options) {
    const { params } = options || {}
    return $fetch(url, {
      method: 'GET',
      query: params,
    })
  },
  post(url: string, options) {
    const { params, data } = options || {}
    return $fetch(url, {
      method: 'post',
      query: params,
      body: data,
    })
  },
  put(url: string, options) {
    const { params, data } = options || {}
    return $fetch(url, {
      method: 'put',
      query: params,
      body: data,
    })
  },
  patch(url: string, options) {
    const { params, data } = options || {}
    return $fetch(url, {
      method: 'patch',
      query: params,
      body: data,
    })
  },
  delete(url: string, options) {
    const { params, data } = options || {}
    return $fetch(url, {
      method: 'delete',
      query: params,
      body: data,
    })
  },
})
export const createApiClient = (
  fetchAdapter: ReturnType<typeof createFetchAdapter>,
) =>
  createClient(fetchAdapter)(API_URL, {
    controllers: allControllers,
    // 兼容 Core v14：信封解包 + snake_case/语义改名 + 分页合成，
    // 同时保留 `$serialized` / `$raw`（源码多处依赖）。详见 ./normalize.ts
    getDataFromResponse,
    // 归一化已完成命名转换，禁止 api-client 再跑一次默认 camelcaseKeys，
    // 否则会破坏 `custom_elements` 等要求保留下划线的字段。
    transformResponse,
  })
