/**
 * Mix Space Core v14 -> Shiro 数据归一化层
 *
 * 背景：Shiro 面向 Core 10.x 编写；Core v14 起后端响应改为
 *   1) 外层包一层 `{ data: ... }` 信封（部分接口还带兄弟字段 `meta`）
 *   2) 字段命名改为 snake_case
 *   3) 若干字段做了**语义改名**（不是简单下划线转驼峰），例如
 *      `created_at` -> `created`（而非 createdAt）、`no_rss` -> `noRSS`
 *
 * 本模块只做「读入 v10/v14 两种形状 → 输出 Shiro 期望的稳定形状」，
 * 不改变任何页面既有的读取方式（identity 策略），因此对旧 Core 亦向后兼容。
 */

/** 单个 `{ data: ... }` 信封的解包结果 */
interface UnwrappedEnvelope {
  /** 信封内层业务数据（已规范化） */
  data: unknown
  /** 信封的兄弟字段（如 v14 的分页 `meta`）；无兄弟字段时为 undefined */
  meta: Record<string, unknown> | undefined
}

const MONGO_ID_RE = /^[\dA-F]{24}$/i

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (!value || typeof value !== 'object') return false
  if (Array.isArray(value)) return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

/**
 * 仅当对象**只有 `data` 一个键**时才视为信封。
 *
 * 这一点至关重要：v14 的列表类接口返回 `{ data, meta }`（多键），
 * 若无条件取 `.data` 会丢掉 `meta.pagination`，导致分页失效。
 * 判据与 api-client 内置的 `destructureData` 保持一致。
 */
const isBareEnvelope = (value: unknown): value is { data: unknown } =>
  isPlainObject(value) && Object.keys(value).length === 1 && 'data' in value

/**
 * 语义化字段改名：snake_case 转驼峰**修正不了**的那些字段。
 *
 * 左值为 v14 后端字段，右值为 Shiro 期望字段。
 * 未列出的字段走通用 snake_case -> camelCase。
 */
const FIELD_ALIASES: Record<string, string> = {
  // v14 用 `_at` 后缀，Shiro 全线读无后缀形式（约 35 处依赖 `created`）
  created_at: 'created',
  modified_at: 'modified',
  // 置顶时间字段
  pin_at: 'pin',
  // 全大写缩写，通用驼峰会得到错误的 `noRss`
  no_rss: 'noRSS',
  // 分页字段
  page: 'currentPage',
  total_pages: 'totalPage',
}

/**
 * 需要**保留下划线原样**的字段（源码 `app.config.d.ts` 就以该形式声明）。
 *
 * `follow_challenge` 是 RSS 自定义元素结构内的嵌套键，同样需要保留。
 */
const PRESERVE_AS_IS = new Set(['custom_elements', 'follow_challenge'])

/** snake_case / kebab-case -> camelCase */
const toCamelCase = (key: string): string => {
  if (PRESERVE_AS_IS.has(key)) return key
  return key.replaceAll(/[_-](\w)/g, (_, char: string) => char.toUpperCase())
}

/** 计算单个键的最终键名 */
const resolveKey = (key: string): string => {
  if (PRESERVE_AS_IS.has(key)) return key
  // ObjectId 形态的键（v14 用 id 作为 map 键）必须原样保留
  if (MONGO_ID_RE.test(key)) return key
  const aliased = FIELD_ALIASES[key]
  if (aliased) return aliased
  return toCamelCase(key)
}

/**
 * v14 把阅读/点赞数拍平成 `read_count` / `like_count`，
 * 而 Shiro 组件读 `count.read` / `count.like`。
 * 这里在缺失 `count` 时补一个合成对象（已存在则不覆盖）。
 */
const attachCount = (value: Record<string, unknown>): void => {
  if (value.count !== undefined) return
  const read = value.readCount
  const like = value.likeCount
  if (read === undefined && like === undefined) return
  value.count = {
    read: typeof read === 'number' ? read : 0,
    like: typeof like === 'number' ? like : 0,
  }
}

/**
 * 合成 Shiro 契约的分页对象。
 *
 * v14 返回 `meta.pagination = { page, size, total, totalPages }`，
 * 而 Shiro 期望顶层 `pagination = { currentPage, totalPage, hasNextPage, hasPrevPage, ... }`。
 */
const buildPagination = (
  meta: Record<string, unknown> | undefined,
  current: unknown,
): Record<string, unknown> | undefined => {
  const source = isPlainObject(current)
    ? current
    : isPlainObject(meta?.pagination)
      ? meta.pagination
      : undefined
  if (!source) return undefined

  const currentPage = Number(source.currentPage ?? source.page ?? 1) || 1
  const totalPage = Number(source.totalPage ?? source.totalPages ?? 1) || 1
  const size = Number(source.size ?? 10) || 10
  const total = Number(source.total ?? 0) || 0

  return {
    ...source,
    currentPage,
    totalPage,
    size,
    total,
    hasNextPage: source.hasNextPage ?? currentPage < totalPage,
    hasPrevPage: source.hasPrevPage ?? currentPage > 1,
  }
}

/** 递归规范化任意值 */
const normalizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (!isPlainObject(value)) return value

  const result: Record<string, unknown> = {}
  for (const [key, raw] of Object.entries(value)) {
    result[resolveKey(key)] = normalizeValue(raw)
  }
  attachCount(result)
  return result
}

/**
 * 规范化一个原始响应体（可能是信封，也可能不是）。
 *
 * - 单键 `{ data }` → 解开信封
 * - 多键 `{ data, meta }` → **保留外层**，保证页面既有的 `.data` 读取不破
 * - 无信封（如 `server-time` 的 `{ t2, t3 }`）→ 原样规范化
 */
export const normalizeResponse = (payload: unknown): unknown => {
  if (Array.isArray(payload)) return payload.map(normalizeValue)
  if (!isPlainObject(payload)) return payload

  if (isBareEnvelope(payload)) {
    return normalizeValue(payload.data)
  }

  const normalized = normalizeValue(payload) as Record<string, unknown>

  // 多键信封：把 meta 里的分页信息提升为顶层 `pagination`，
  // 但**保留** `data` 与 `meta` 本身，兼容页面既有读法。
  const meta = isPlainObject(payload.meta) ? payload.meta : undefined
  const pagination = buildPagination(meta, normalized.pagination)
  if (pagination && normalized.pagination === undefined) {
    normalized.pagination = pagination
  }

  return normalized
}

/**
 * 给对象挂上 api-client 兼容的非枚举 getter。
 *
 * Shiro 源码有 14 处读 `$serialized`，feed 路由还读 `$raw.theme`。
 * 必须是 **non-enumerable**：否则会污染 JSON.stringify 输出与
 * React Server Component 的序列化载荷。
 */
export const attachCompatGetters = <T extends object>(
  target: T,
  raw: unknown,
): T => {
  const define = (key: string, resolver: () => unknown) => {
    if (key in target) return
    Object.defineProperty(target, key, {
      get: resolver,
      enumerable: false,
      configurable: true,
    })
  }

  define('$raw', () => raw)
  define('$request', () => {})
  define('$serialized', () => target)

  return target
}

/**
 * 供 api-client 的 `getDataFromResponse` 使用：
 * 规范化响应，并在对象上补齐 `$serialized` / `$raw`。
 *
 * 签名需与 api-client 的 `IRequestAdapter` 对齐（泛型返回）。
 */
export const getDataFromResponse = <T = any>(response: unknown): T => {
  const normalized = normalizeResponse(response)
  if (normalized && typeof normalized === 'object') {
    return attachCompatGetters(normalized as object, response) as T
  }
  return normalized as T
}

/**
 * 供 api-client 的 `transformResponse` 使用。
 *
 * 必须显式覆盖：api-client 的默认实现是 `camelcaseKeys`，它会在
 * `getDataFromResponse` 之后再跑一遍。由于 Shiro 的归一化已经完成了
 * 命名与语义改名，二次处理会破坏 `custom_elements` 这类**要求保留下划线**
 * 的字段（api-client 只豁免 ObjectId 形态的键）。这里改为恒等返回。
 */
export const transformResponse = <T>(data: T): T => data
