import { RequestError } from '@mx-space/api-client'
import type { FetchError } from 'ofetch'

export const getErrorMessageFromRequestError = (error: RequestError) => {
  if (!(error instanceof RequestError)) return (error as Error).message
  const fetchError = error.raw as FetchError
  const body = fetchError.response?._data as
    | { message?: unknown; error?: { message?: unknown } }
    | undefined

  // Core v14 的业务错误格式为 `{ error: { code, message } }`，
  // 而旧 Core 使用顶层的 `message`。两者都要能取到。
  const messagesOrMessage = body?.error?.message ?? body?.message
  const bizMessage =
    typeof messagesOrMessage === 'string'
      ? messagesOrMessage
      : Array.isArray(messagesOrMessage)
        ? messagesOrMessage[0]
        : undefined

  return bizMessage || fetchError.message
}
