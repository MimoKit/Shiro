import { EventTypes } from '~/types/events'

import type { EventHandler } from './types'

// 服务端主动下发 content.refresh（例如后台发布/更新内容）时，
// 管理端的行为是提示并刷新；博客前端之前没有注册 handler，
// 事件只会落到 dev 日志里、页面无反应，这里对齐为刷新当前路由数据
export const contentRefreshHandlers: Record<string, EventHandler> = {
  [EventTypes.CONTENT_REFRESH]: (_data, { router }) => {
    router.refresh()
  },
}
