import { apiClient } from '~/lib/request'
import { defineQuery } from '~/queries/helper'

export const getTopicQuery = (topicSlug: string) =>
  defineQuery({
    queryKey: ['topic', topicSlug],
    queryFn: async ({ queryKey }) => {
      const [_, slug] = queryKey
      const serialized = (await apiClient.topic.getTopicBySlug(slug))
        .$serialized as any
      // 与 post.ts 对齐：v14 详情若是 {data, meta} 多键信封先解包，
      // 单键时管线 A 已解包、回退本体，两种形状都安全
      return serialized?.data ?? serialized
    },
  })
