# Shiro 6.6.7 ↔ Mix Space Core v14.15.2 契约差异清单（T1 侦察固化）

> 交付物：本文件（`docs/core-v14-compat.md`）
> 目的：把「Shiro(web 6.6.7, api-client 2.3.0) 对 Mix Space Core v14.15.2」的接口契约差异固化成可执行清单，供 T2/T3/T4 直接照做。
> 侦察方式：只读。真实 SSH + curl 取线上响应；真实源码阅读（fork `main`，web 6.6.7）；真实 Node 执行 api-client 2.3.0 做行为验证。
> 所有结论均附「实际命令 + 真实输出片段」。无法证实的标注「待验证」。

### ⚠️ 基线版本与行号漂移说明（必读）

本文件所有 **Shiro 源码行号**均以基线提交为准：

```bash
cd /data/dsh/home/xiaolin/Shiro && git rev-parse HEAD
# 输出： 891bb24cd59aff7c9baaf4d9a3579ca4275da3b7
#        chore(deps): bump @haklex/* to 0.0.105   (分支 feat/core-v14-compat)
```

侦察结束时，**T3/T4 已开始写入**（`git status` 可见 `M Dockerfile`、`M apps/web/src/app/[locale]/(home)/components/Hero.tsx`），
因此**这些文件的行号会漂移**。请以「关键词/现写法」为准定位，行号仅作参考。

已知两处已被并发修复（记录于此，避免 T2/T3 重复劳动）：

- `Dockerfile`：基线里是硬编码 `ENV NEXT_PUBLIC_API_URL=${BASE_URL}/api/v2`；**T4 已改为**
  `ARG API_PREFIX=/api/v3` + `ENV NEXT_PUBLIC_API_URL=${BASE_URL}${API_PREFIX}`（`Dockerfile:82,92`）。§4.4-2 的决策点已被采纳。
- `Hero.tsx`：基线 `:34` 的 `useAppConfigSelector(...)!` 裸断言已改为 `const hero = useAppConfigSelector((config) => config.hero) ?? undefined`。
  §3.8 中 Hero 的行号（`34,36,37,78,82,103`）已不适用，改为按 `config.hero` / `avatar` / `socialIds` 关键词定位。

以下行号（`lib/fetch/shared.ts`、`app/[locale]/api.tsx`、`layout.tsx`、`timeline/**`、`FooterInfo.tsx`、
`PostTagsFAB.tsx`、`projects/page.tsx`、`posts/**`、`app.config.d.ts`、`queries/**`）在侦察结束时**未被改动**，
可直接引用（已用 `sed -n` 逐条复核）。

---

## 0. 根因定性与线上现状

### 0.1 根因定性依据

Shiro README 第 8 行原文（`README.md:8`）：

```
> **Shiro 要求 Mix Space Core 版本 == 10.x**，不兼容更高版本。
```

验证命令：

```bash
sed -n '8p' /data/dsh/home/xiaolin/Shiro/README.md
# 输出： > **Shiro 要求 Mix Space Core 版本 == 10.x**，不兼容更高版本。
```

线上版本确认（真实命令）：

```bash
ssh ... 'docker inspect mx-server --format "{{index .Config.Labels \"org.opencontainers.image.version\"}}"'
# 输出： v14.15.2
ssh ... 'docker exec shiro sh -c "cat /app/node_modules/../package.json 2>/dev/null | head -5"'
# 输出： { "name": "Shiro", "version": "1.2.3", ...
```

关键判断：**Docker Hub 上 `innei/shiro` 最新 tag = 1.2.3（2024-10-27），而 fork 源码 web 版本已是 6.6.7**。源码已演进很多代，因此本清单**全部基于 fork 源码 `/data/dsh/home/xiaolin/Shiro` 分析**，不基于线上镜像反编译结论。

### 0.2 线上拓扑与「已存在的运行时兼容层」（重大发现）

服务器上**已存在**一个 v2 兼容 shim，Shiro 容器实际打的是 `/api/v2`（**不是** `/api/v3`）：

```bash
ssh ... "docker inspect shiro --format '{{range .Config.Env}}{{println .}}{{end}}' | grep -i API_URL"
# 输出： NEXT_PUBLIC_API_URL=https://blog.xlinxc.cn/api/v2

ssh ... "cat /etc/nginx/sites-available/blog.xlinxc.cn | grep -A3 'api/v2'"
# 输出：
#     # v2 API -> compatibility shim (unwraps {data} + camelCase)
#     location ^~ /api/v2/ {
#         proxy_pass http://127.0.0.1:2334;
```

shim 本体（只读查看，未修改）：

```bash
ssh ... "ps -o pid,cmd -p 3313851"
# 输出： 3313851 /usr/bin/node /root/mx-space/v2-compat.mjs
ssh ... "systemctl list-units --all --no-pager | grep v2-compat"
# 输出： mx-v2-compat.service  loaded active running  Mix Space v2 API compatibility shim (v14 -> Shiro)
```

shim 做的事（`/root/mx-space/v2-compat.mjs`，84 行，已 `systemctl enable`，`Restart=always`）：
1. `/api/v2/*` → `/api/v3/*`
2. 若 body 顶层只有 `data` 一个键 → 解开信封
3. 递归 key 转 camelCase

**这是本任务的关键约束**：T2 必须决定「继续依赖/加固这个 shim」还是「在 Shiro 源码里做转换」。两种路线的差异见 §3.0。

### 0.3 线上实测故障复现

```bash
ssh ... "for u in / /timeline /posts /notes /thinking; do printf '%-12s ' \$u; curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:2323\$u; done"
# 输出：
# /            200
# /timeline    500
# /posts       200
# /notes       200
# /thinking    200
```

`/timeline` 500 的真实服务端日志（可复现）：

```bash
ssh ... "curl -s -o /dev/null http://127.0.0.1:2323/timeline; sleep 2; docker logs shiro --since 8s 2>&1 | head -20"
# 输出：
# Error: Only plain objects, and a few built-ins, can be passed to Client Components from Server Components. Classes or null prototypes are not supported.
#     at ek (.../next-server/app-page.runtime.prod.js:12:139520)
#     at Object.toJSON (.../app-page.runtime.prod.js:12:135626)
#     at stringify (<anonymous>)
#     ...
#   digest: '886154139'
```

固定 digest `886154139`，每次访问必现。

---

## 1. 响应信封与字段命名差异（含真实 curl 样例）

### 1.1 信封差异

| 维度 | Core v14 (`/api/v3`) 实际返回 | Shiro 期望 | 是否一致 |
|---|---|---|---|
| 成功响应外层 | `{"data": ...}` 包一层 | 扁平，直接是数据体 | **否** |
| 列表分页 | `{"data":[...],"meta":{"pagination":{...}}}` | `{data:[...], pagination:{...}}` | **否**（层级不同） |
| 错误响应 | `{"error":{"code":"...","message":"..."}}` | `{"message":"..."}`（`request.shared.ts` 读 `_data.message`） | **否** |
| 字段命名 | `snake_case` | `camelCase` | **否** |

**错误信封也是一个坑**（此前未被记录）。真实命令：

```bash
ssh ... "curl -s 'http://127.0.0.1:2333/api/v3/notes/nid/99999'"
# 输出： {"error":{"code":"NOTE_NOT_FOUND","message":"Note not found","details":{"id":"99999"}}}

ssh ... "curl -s 'http://127.0.0.1:2333/api/v3/aggregate/stat'"
# 输出： {"error":{"code":"AUTH_NOT_LOGGED_IN","message":"Not logged in"}}
```

Shiro 侧读法（`apps/web/src/lib/request.shared.ts:7`，整函数 4-16 行）：

```ts
export const getErrorMessageFromRequestError = (error: RequestError) => {
  if (!(error instanceof RequestError)) return (error as Error).message
  const fetchError = error.raw as FetchError
  const messagesOrMessage = fetchError.response?._data?.message   // ← 第 7 行
  ...
  return bizMessage || fetchError.message
}
```

v14 的 message 在 `error.message` 里，不在顶层 `message`，**因此业务错误信息会退化成 ofetch 的通用文案**。

### 1.2 样例 A：`/api/v3/aggregate?theme=shiro`

```bash
ssh ... "curl -s 'http://127.0.0.1:2333/api/v3/aggregate?theme=shiro'"
```

真实输出（关键片段，完整 2064B 已存于 `/data/dsh/home/xiaolin/live-evidence/v3-aggregate.json`）：

```json
{"data":{"user":{"id":"187986221505449984","username":"admin","name":"小林","introduce":"玩机器人的","avatar":"http://q1.qlogo.cn/g?b=qq&nk=3853125761&s=640","mail":"3853125761@qq.com","last_login_time":"2026-10-02T17:50:43.478Z","role":"owner","email":"3853125761@qq.com","image":"http://q1.qlogo.cn/g?b=qq&nk=3853125761&s=640","handle":"admin","display_username":"小林","created_at":"2026-10-02T17:50:07.976Z"},"seo":{"title":"小林的小世界","description":"Hi, welcome to Xiao Lin's blog","icon":"","icon_dark":"","keywords":[]},"url":{"ws_url":"https://blog.xlinxc.cn","server_url":"https://blog.xlinxc.cn/api/v2","web_url":"https://blog.xlinxc.cn"},"comment_options":{"disable_comment":false,"allow_guest_comment":true},"latest_note_id":{"nid":1,"id":"187986221505449985"},"theme":{"footer":{"other_info":{"date":"2026-{{now}}","icp":{"text":"","link":""}},"link_sections":[{"name":"关于","links":[{"name":"关于我","href":"/about"}]}]},"config":{"color":{"light":["#33A6B8",...],"dark":["#F596AA",...]},"bg":["/static/images/F0q8mwwaIAEtird.jpeg"],"custom":{"css":[],"styles":[],"js":[],"scripts":[]},"site":{"favicon":"/innei.svg","favicon_dark":"/innei-dark.svg"},"hero":{"title":{"template":[{"type":"h1","text":"Hi, I'm ","class":"font-light text-4xl"},...]},"description":"An independent developer coding with love."},"module":{"activity":{"enable":false},"donate":{"enable":false},"bilibili":{"live_id":0},"rss":{"no_rss":false}}}},"ai":{"enable_summary":true}}}
```

**注意 v14 aggregate 实际返回的顶层键**：`user, seo, url, comment_options, latest_note_id, theme, ai`。
**没有** `categories`，**没有** `page_meta`（api-client 的 `AggregateRoot` 类型里有这两个字段）：

```bash
ssh ... "curl -s 'http://127.0.0.1:2333/api/v3/aggregate?theme=shiro' | grep -o 'categories\|page_meta\|social_ids' | sort -u; echo '(空=不存在)'"
# 输出： (空=不存在)
```

而 Shiro 会读 `pageMeta`（`HeaderDataConfigureProvider.tsx:32`、`(page-detail)/[slug]/pageExtra.tsx:75`）和 `socialIds`（`layout.tsx:127`、`Hero.tsx:36`、`projects/page.tsx:27`）→ 见 §2.5。

### 1.3 样例 B：`/api/v3/aggregate/timeline?year=2026`

```bash
ssh ... "curl -s 'http://127.0.0.1:2333/api/v3/aggregate/timeline?year=2026'"
```

真实输出：

```json
{"data":{"posts":[],"notes":[{"id":"187986221505449985","nid":1,"title":"Hello World","slug":"hello-world","content_format":"markdown","images":null,"meta":null,"is_published":true,"has_password":false,"public_at":null,"mood":null,"weather":null,"bookmark":false,"coordinates":null,"location":null,"read_count":1,"like_count":0,"topic_id":null,"created_at":"2026-10-02T17:56:04.747Z","modified_at":null,"topic":null}]}}
```

带文章的真实形状（该站之后新增了 posts）：

```bash
ssh ... "curl -s 'http://127.0.0.1:2333/api/v3/aggregate/timeline' | head -c 300"
# 输出： {"data":{"posts":[{"id":"187986221505450001","title":"欢迎来到小林的小世界","slug":"welcome-to-xiao-lin-blog","content_format":"markdown","summary":null,...
```

**结构差异（不是简单改名！）**：api-client 的 `getTimeline()` 类型声明是 `RequestProxyResult<{data: TimelineData}, ...>`，即期望 `res.data = {posts, notes}`。而 v14 在「不包 `data`」时的 `res` 本身就是 `{posts, notes}`（见 §1.5 实测）。

### 1.4 样例 C：`/api/v3/posts` 与 `/api/v3/notes`

```bash
ssh ... "curl -s 'http://127.0.0.1:2333/api/v3/posts?page=1&size=2'"
# 输出（尾部）： ...,"related":[]}],"meta":{"pagination":{"page":1,"size":2,"total":3,"total_pages":2},"view":"card"}}

ssh ... "curl -s 'http://127.0.0.1:2333/api/v3/notes'"
# 输出： {"data":[{"id":"187986221505449985","nid":1,"title":"Hello World","slug":"hello-world","text":"欢迎使用 Mix Space 与 Shiro 主题！","content":"欢迎使用 Mix Space 与 Shiro 主题！","content_format":"markdown",...,"read_count":1,"like_count":0,"topic_id":null,"created_at":"2026-10-02T17:56:04.747Z","modified_at":null,"topic":null}],"meta":{"pagination":{"page":1,"size":10,"total":1,"total_pages":1},"view":"card"}}
```

**分页字段命名陷阱（必读）**：v14 用 `page` / `total_pages`，而 api-client 的 `Pager` 接口要求 `currentPage` / `totalPage` / `hasPrevPage` / `hasNextPage`：

```ts
// api-client 2.3.0 dist/index.d.mts:148
interface Pager { total: number; size: number; currentPage: number; totalPage: number; hasPrevPage: boolean; hasNextPage: boolean }
```

`page` **不会**被 camelCase 转成 `currentPage`，`total_pages` → `totalPages`（≠ `totalPage`，且 Shiro 读 `hasNextPage`/`currentPage`）。见 §2.4。

### 1.5 api-client 2.3.0 真实管线行为（本清单最重要的证据）

我用真实 api-client 2.3.0 包 + 真实线上报文在 Node 里跑了完整管线，**不是推测**：

```bash
cd /tmp/recon && node real.mjs
```

真实输出：

```
===== OVERRIDE (Shiro shared.ts:57-59)
  Object.keys(res)      : ["data"]
  res.theme             : undefined
  res.url               : undefined
  res.$serialized keys  : ["data"]
  -> `const {theme:{config}} = res`  => THROWS: TypeError: Cannot read properties of undefined (reading 'config')
  getTimeline res.data  : DEFINED
  getTimeline res keys  : ["data"]

===== DEFAULT (api-client default)
  Object.keys(res)      : ["user","seo","url","commentOptions","latestNoteId","theme","ai"]
  res.theme             : DEFINED
  res.url               : {"wsUrl":"https://blog.xlinxc.cn","serverUrl":"https://blog.xlinxc.cn/api/v2","webUrl":"https://blog.xlinxc.cn"}
  -> `const {theme:{config}} = res`  => OK true
  getTimeline res.data  : undefined
  getTimeline res keys  : ["user","seo","url","commentOptions","latestNoteId","theme","ai"]
```

**结论（逐条）**：

1. `getDataFromResponse` 被覆盖为 `res => res` 后，`res` 顶层只有 `data` 键 → 这正是线上历史 500 `Cannot read properties of undefined (reading 'config')` 的机制（`layout.tsx:63` 解构 `theme: { config }`）。
2. 改回默认 `res => res.data`，则 v14 的**信封被解开**、**snake_case 被自动转 camelCase**（api-client 的 `transformResponse` 默认 `camelcaseKeys`，见下）→ `res.theme.config` 有值。
3. **但**默认解包会把 `getTimeline` 的语义弄反：v14 的 `{posts, notes}` 会被当成「信封」的 `data` 剥掉 → `res.data === undefined`，而 `timeline/layout.tsx:46` 与 `timeline/page.tsx:108` 都写 `.then((res) => res.data)` → 拿到 `undefined`。

api-client 内部两行关键源码：

```js
// node_modules/@mx-space/api-client/dist/index.mjs:1037-1038
options.transformResponse || (options.transformResponse = (data) => camelcaseKeys(data));
options.getDataFromResponse || (options.getDataFromResponse = (res) => res.data);
```

```js
// dist/index.mjs:1134-1138
const data = that.options.getDataFromResponse(res);
if (!data) return null;
const cameledObject = (Array.isArray(data) || isPlainObject(data)) && that.options.transformResponse ? that.options.transformResponse(data) : data;
```

`camelcaseKeys` 实现（`dist/index.mjs:43-53`），注意它是**朴素**转换：

```js
const camelcase = (str) => str.replace(/^_+/, '').replaceAll(/([_-][a-z])/gi, ($1) => $1.toUpperCase().replace('-', '').replace('_', ''))
```

**→ `no_rss` 会变成 `noRss`，但 Shiro 读的是 `noRSS`**：

```bash
node -e "const c=s=>s.replace(/^_+/,'').replaceAll(/([_-][a-z])/gi,m=>m.toUpperCase().replace('-','').replace('_','')); console.log(c('no_rss'))"
# 输出： noRss
grep -n 'noRSS' /data/dsh/home/xiaolin/Shiro/apps/web/src/app.config.d.ts
# 输出： 93:      noRSS?: boolean
```

同理 `favicon_dark` → `faviconDark` ✅（这条能对上），`custom_elements` → `customElements` ⚠️（`app.config.d.ts:92` 写的是 `custom_elements`，保留了下划线 → **对不上**）。见 §2.6。

---

## 2. 逐字段映射表（可直接照抄写转换函数）

> 约定：**左列 = v14 实际返回的键**（真实 curl 得到），**右列 = Shiro 源码实际读取的键**（附文件:行号）。
> 「✔ 朴素 camel 可自动修好」= 只依赖 `camelcaseKeys` 即可；「✘ 需显式重命名/补默认」= 必须手写映射。

### 2.1 `aggregate`（`/api/v3/aggregate?theme=shiro`）

| v14 实际键 | Shiro 读取键 | Shiro 读取位置 | 朴素 camel | 备注 |
|---|---|---|---|---|
| `data`（外层信封） | —（需剥掉） | `app/[locale]/api.tsx:19-27` | — | **必须显式解包** |
| `user` | `user` | `layout.tsx:62`, `aggregation-data-provider.tsx:59` | ✔ | |
| `user.id` | `user.id` | — | ✔ | |
| `user.username` | `user.username` | `UserModel` | ✔ | |
| `user.name` | `user.name` | `layout.tsx:123`, `OwnerName.tsx:7`, `Hero.tsx:37` | ✔ | |
| `user.introduce` | `user.introduce` | `UserModel`；用于简介 | ✔ | 值含**裸文本**，见 §4.3 |
| `user.avatar` | `user.avatar` | `Hero.tsx:37,103`, `authjs.tsx:106` | ✔ | 值 `http://q1.qlogo.cn/...`（http!），见 §4.3 |
| `user.last_login_time` | `user.lastLoginTime` | `UserModel` | ✔ | |
| `user.display_username` | `user.displayUsername` | `BetterAuthUser` | ✔ | |
| `user.created_at` | `user.created` | `BaseModel.created` | ✘ | **`created_at`→`createdAt` ≠ `created`** |
| `user.mail` / `user.email` / `user.image` / `user.role` / `user.handle` | 同名 | `BetterAuthUser` | ✔ | |
| `user.social_ids` | `user.socialIds` | `layout.tsx:127`, `Hero.tsx:36`, `projects/page.tsx:27` | ✘ | **v14 根本不返回**（见 §1.2） |
| `seo` | `seo` | `layout.tsx:60` | ✔ | |
| `seo.title` | `seo.title` | `layout.tsx:75,113,117,129` | ✔ | |
| `seo.description` | `seo.description` | `layout.tsx:78,116,130` | ✔ | |
| `seo.keywords` | `seo.keywords` | `layout.tsx:79` | ✔ | |
| `seo.icon` / `seo.icon_dark` | `seo.icon` / `seo.iconDark` | `SeoOptionModel` | ✔ | |
| `url.web_url` | `url.webUrl` | `layout.tsx:73,120,134` | ✔ | **关键**：`new URL(url.webUrl)` |
| `url.ws_url` | `url.wsUrl` | `Url` | ✔ | |
| `url.server_url` | `url.serverUrl` | `Url` | ✔ | |
| `comment_options.disable_comment` | `commentOptions.disableComment` | `CommentOptionsModel` | ✔ | |
| `comment_options.allow_guest_comment` | `commentOptions.allowGuestComment` | `CommentOptionsModel` | ✔ | |
| `latest_note_id` | `latestNoteId` | `AggregateRoot.latestNoteId` | ✔ | |
| `latest_note_id.nid` | `latestNoteId.nid` | 同上 | ✔ | |
| `latest_note_id.id` | `latestNoteId.id` | 同上 | ✔ | |
| `theme` | `theme` | `layout.tsx:63,186` | ✔ | |
| `theme.footer.other_info.date` | `theme.footer.otherInfo.date` | `FooterInfo.tsx:168` | ✔ | 值 `2026-{{now}}` |
| `theme.footer.other_info.icp.text` | `theme.footer.otherInfo.icp.text` | `FooterInfo.tsx:169` | ✔ | |
| `theme.footer.other_info.icp.link` | `theme.footer.otherInfo.icp.link` | `FooterInfo.tsx:169` | ✔ | |
| `theme.footer.link_sections` | `theme.footer.linkSections` | `FooterInfo.tsx:31,37` | ✔ | |
| `theme.footer.link_sections[].links[].external` | 同名 | `FooterInfo.tsx:50` | — | v14 **未返回** `external`（首页链接 `href:"/about"`） |
| `theme.config.color.light/dark` | `theme.config.color.light/dark` | `layout.tsx:218-219` | ✔ | |
| `theme.config.bg` | `theme.config.bg` | `AppConfig` | ✔ | |
| `theme.config.custom.css/js/styles/scripts` | 同名 | `script-inject-provider.tsx:7` | ✔ | |
| `theme.config.site.favicon` | `theme.config.site.favicon` | `layout.tsx:229` | ✔ | 值 `/innei.svg` |
| `theme.config.site.favicon_dark` | `theme.config.site.faviconDark` | `layout.tsx:95,223` | ✔ | |
| `theme.config.hero.title.template[]` | 同名 | `Hero.tsx:34,57` | ✔ | 每项 `{type,text,class}` |
| `theme.config.hero.description` | 同名 | `Hero.tsx:78` | ✔ | |
| `theme.config.module.donate` | `theme.config.module.donate` | `AsideDonateButton.tsx:31` | ✔ | v14 只返回 `{enable:false}` |
| `theme.config.module.bilibili.live_id` | `module.bilibili.liveId` | `app.config.d.ts:108` | ✔ | |
| `theme.config.module.rss.no_rss` | `module.rss.noRSS` | `app.config.d.ts:93`, `app/feed/route.tsx:49` | ✘ | **`noRss` ≠ `noRSS`** |
| `theme.config.module.rss.custom_elements` | `module.rss.custom_elements` | `app.config.d.ts:92`, `app/feed/route.tsx:47` | ✘ | 朴素 camel → `customElements`，源码读 `custom_elements` |
| `theme.config.module.activity` | 同名 | `app.config.d.ts:82` | ✔ | v14 只返回 `{enable:false}` |
| `ai.enable_summary` | `ai.enableSummary` | `AggregateAIConfig` | ✔ | |
| （缺失）`categories` | `categories` | `AggregateRoot` | — | v14 aggregate 不返回 |
| （缺失）`page_meta` | `pageMeta` | `HeaderDataConfigureProvider.tsx:32`, `pageExtra.tsx:75` | — | v14 aggregate 不返回 |

### 2.2 `aggregate/timeline`

| v14 实际键 | Shiro 读取键 | 位置 | 朴素 camel | 备注 |
|---|---|---|---|---|
| `data`（信封） | `res.data`（**注意语义相反**） | `timeline/page.tsx:108`, `timeline/layout.tsx:46` | — | 若走默认解包则 `res.data` 变 `undefined`；若覆盖则 `res.data = {posts,notes}` ✔ |
| `posts[]` / `notes[]` | `posts` / `notes` | `timeline/page.tsx:118` | ✔ | |
| `note.id` | `note.id` | `timeline/page.tsx:163` | ✔ | |
| `note.nid` | `note.nid` | `timeline/page.tsx:162` → `/notes/${note.nid}` | ✔ | |
| `note.title` | `note.title` | `timeline/page.tsx:155` | ✔ | |
| `note.mood` / `note.weather` | 同名 | `timeline/page.tsx:156-159` | ✔ | |
| `note.bookmark` | `note.bookmark` | `timeline/page.tsx:141,164` | ✔ | |
| `note.created_at` | **`note.created`** | `timeline/page.tsx:150` `new Date(note.created)` | ✘ | **必须映射**，否则 `Invalid Date` |
| `note.modified_at` | `note.modified` | `TimelineData` 类型 | ✘ | 同上 |
| `post.created_at` | **`post.created`** | `timeline/page.tsx:129` | ✘ | 同上 |
| `post.modified_at` | `post.modified` | `TimelineData` 类型 | ✘ | 同上 |
| `post.category.slug` | `post.category.slug` | `timeline/page.tsx:135` | ✔ | |
| `post.category.name` | `post.category.name` | `timeline/page.tsx:133` | ✔ | |
| `post.slug` | `post.slug` | `timeline/page.tsx:134` | ✔ | |

`created_at` → `created` 是关键陷阱，实测：

```bash
node -e "const d=new Date(undefined); console.log(String(d), d.getFullYear()); new Intl.DateTimeFormat('en-us',{month:'2-digit',day:'2-digit'}).format(d)"
# 输出： Invalid Date NaN
# RangeError: Invalid time value
```

即 `timeline/page.tsx:129/150` 得到 `Invalid Date`，进而 `Item` 组件里 `Intl.DateTimeFormat(...).format(item.date)` **抛 RangeError**。

### 2.3 `post` / `note` 详情页

| v14 实际键 | Shiro 读取键 | 位置 | 朴素 camel | 备注 |
|---|---|---|---|---|
| `data`（信封） | `data.data`（wrapped payload） | `notes/[id]/page.tsx:230-247` | — | 需 `{data: <note>}` 形状；v14 恰好就是 `{data:...}` |
| `note.nid` | `note.nid` | `notes/[id]/pageExtra.tsx:153` | ✔ | |
| `note.content_format` | `note.contentFormat` | `notes/[id]/page.tsx:230` | ✔ | `markdown` / `lexical` |
| `note.content` | `note.content` | `notes/[id]/page.tsx:231,240` | ✔ | |
| `note.text` | `note.text` | `TextBaseModel` | ✔ | |
| `note.allow_comment` | **`note.allowComment`** | `notes/[id]/page.tsx:247` | ✘ | **v14 不返回**（见下） |
| `note.count.read` / `note.count.like` | **`note.count.read` / `.like`** | `NoteMetaBar.tsx:62,79`；`NoteActionAside.tsx:85` | ✘ | **v14 拍平成 `read_count`/`like_count`，无 `count` 对象** |
| `note.read_count` / `note.like_count` | —（v14 新形状） | — | — | 需**反向合成** `count:{read,like}` |
| `note.modified_at` | `note.modified` | `notes/[id]/pageExtra.tsx:87` | ✘ | |
| `note.created_at` | `note.created` | `BaseModel.created` | ✘ | |
| `note.is_published` | `note.isPublished` | `notes/[id]/page.tsx:92` | ✔ | |
| `note.topic` / `note.topic_id` | `note.topic` / `note.topicId` | `NoteBottomTopic.tsx:26` | ✔ | |
| `post.category.slug` | `post.category.slug` | `posts/(post-detail)/[category]/[slug]/page.tsx:182` | ✔ | |
| `post.created_at` | `post.created` | 同上:191 | ✘ | |
| `post.modified_at` | `post.modified` | 同上:192 | ✘ | |
| `post.content_format` | `post.contentFormat` | 同上:146,152,197 | ✔ | |
| `post.count.read` / `.like` | `post.count.read` / `.like` | `PostMetaBar.tsx:97,101,105,109`；`PostActionAside.tsx:92,101` | ✘ | 同 note，v14 只剩 `read_count`/`like_count` |
| `post.pin_at` | **`post.pin`** | `PostItem.tsx:33,39,91,97` | ✘ | **`pin_at` 不叫 `pin`**，因此「置顶角标」永远判为 false |
| `post.summary` / `post.tags` / `post.images` / `post.meta` | 同名 | `PostItem.tsx:22,27,47` | ✔ | |
| `post.related` | `related` | `PostModel` | ✔ | |
| `note.is_liked`（位于 `meta.interaction`） | `liked` | `ModelWithLiked` | ✘ | 在 `meta.interaction.is_liked`，非 note 顶层 |
| `meta.translation.<id>.article.is_translated` | `isTranslated` | `notes/[id]/page.tsx:171` | ✘ | 深层嵌套，需显式提取 |
| `meta.translation.<id>.article.available_translations` | `availableTranslations` | 同上:172, `lib/seo/hreflang.ts:45` | ✘ | 同上 |

`allowComment` 缺失证据：

```bash
ssh ... "curl -s 'http://127.0.0.1:2333/api/v3/notes/nid/1' | grep -o 'allow_comment\|comments_index' | sort -u; echo '(空=不存在)'"
# 输出： (空=不存在)
```

`count` 拍平证据：

```bash
ssh ... "curl -s 'http://127.0.0.1:2333/api/v3/notes' | grep -c '\"count\"'"
# 输出： 0
ssh ... "curl -s 'http://127.0.0.1:2333/api/v3/notes' | grep -o '\"read_count\"\|\"like_count\"' | sort -u"
# 输出： "like_count"
#       "read_count"
```

而 Shiro 读 `data?.count.like`，若 `count` 缺失会**直接抛 TypeError**：

```bash
node -e "try{({}).count.like}catch(e){console.log(e.constructor.name+': '+e.message)}"
# 输出： TypeError: Cannot read properties of undefined (reading 'like')
```

### 2.4 分页（`Pager`）——独立且必改的一类

| v14 实际键（`meta.pagination`） | api-client `Pager` / Shiro 读取键 | 位置 | 朴素 camel | 备注 |
|---|---|---|---|---|
| `meta.pagination` | `pagination`（**顶层**） | `posts/page.tsx:62` `const {data, pagination} = props.data` | ✘ | 层级不同，必须提到顶层 |
| `page` | **`currentPage`** | `PostPagination.tsx:13,22`, `loader.tsx:46`, `say/hooks.ts:23` | ✘ | **`page` ≠ `currentPage`** |
| `total_pages` | **`totalPage`** | `Pager` | ✘ | `totalPages` ≠ `totalPage` |
| `size` | `size` | `Pager` | ✔ | |
| `total` | `total` | `Pager` | ✔ | |
| （无） | **`hasNextPage`** | `PostPagination.tsx:21`, `loader.tsx:45`, `say/hooks.ts:22`, `comment/hooks.tsx:25` | ✘ | **v14 不返回，需计算** |
| （无） | **`hasPrevPage`** | `PostPagination.tsx:12`, `comment/hooks.tsx:28` | ✘ | **v14 不返回，需计算** |

实测（真实 api-client + shim 形状报文）：

```bash
cd /tmp/recon && node pl.mjs
# 输出：
# keys of result      : ["data","meta"]
# result.pagination   : undefined
# result.meta         : {"pagination":{"page":1,"size":10,"total":3,"totalPages":1},"view":"card"}
# -> `const {data, pagination} = res`: {"data":1}
```

**→ `pagination` 为 `undefined`**，而 `posts/page.tsx:62` 立刻解构它；`loader.tsx:45` 读 `lastPage.pagination.hasNextPage` → 抛错。（注：线上 `/posts` 目前 200，是因为当前只有 3 篇文章、`NothingFound` 分支在 `pagination` 被使用前就 return 了；`posts/page.tsx:70` `if (!data?.length) return <NothingFound />`。分页一旦被用到就会崩。）

### 2.5 其它接口

| 端点 | v14 真实返回（命令与片段） | Shiro 读取 | 差异 |
|---|---|---|---|
| `aggregate/site` | `{"data":{"user":{"id","name"},"seo":{...},"url":{"web_url":...}}}` | — | 非 Shiro 主路径 |
| `aggregate/top?size=5` | `{"data":{"notes":[...],"posts":[],"says":[],"recently":[]}}` | `(home)/layout.tsx:24` 取 `.$serialized` | 信封 |
| `aggregate/stat` | `{"error":{"code":"AUTH_NOT_LOGGED_IN",...}}` HTTP 401 | — | **需鉴权** |
| `activity/recent` | `{"data":{"like":[],"comment":[],"recent":[],"post":[],"note":[...]}}` | `ActivityRecent.tsx:21` 取 `.$serialized` 后 `Object.entries` → 依赖**扁平对象** | 若不解包则 `Object.entries` 得到 `[["data",{...}]]`，类型名错误 |
| `activity/last-year/publication` | `{"data":{"posts":[],"notes":[{"created_at":...}]}}` | `HomePageTimeLine.tsx:109-114` 读 `yearData.posts/notes`，再用 `post.created` | 信封 + `created_at`→`created` |
| `activity/rooms` | `{"data":{"rooms":[],"room_count":{},"objects":{...}}}` | `GatewayInfo.tsx:124` 取 `.$serialized` | `room_count`→`roomCount`，`objects` 内 `recentlies` |
| `owner/check_logged` | `{"data":{"ok":0,"is_guest":true}}` | `layout.tsx:200-206` 用 **ofetch 裸 fetch** 读 `res.ok` | ✘ **双重错误**：真实响应 `res.ok` 是 `{ok,isGuest}` 对象（`!!` 后恒 true ），且正确值是 `res.data.ok` |
| `options/url` | HTTP 401 `{"error":{"code":"AUTH_NOT_LOGGED_IN"}}` | `atoms/url.ts:20-28` 读 `{data:{adminUrl,webUrl}}` | **需鉴权** |
| `server-time` | `{"t2":1790965537227,"t3":1790965537228}`（**无 `data` 信封**） | `SyncServerTime.tsx` | 该端点本就扁平，**转换层不能一刀切解包** |
| `aggregate/sitemap` | `{"data":[{"url":"...","published_at":"..."}]}` | `sitemap/route.tsx` | `published_at`→`publishedAt` |
| `categories` | `{"data":[{"id","name":"Default","slug":"default","type":0,"created_at":"...","count":3}],"meta":{"view":"card"}}` | `PostTagsFAB.tsx:38` 读 `(await ...).data` | 见下 |
| `categories?type=1`（tags） | `{"data":[],"meta":{"view":"card"}}` | `PostTagsFAB.tsx:38` `getAllTags()` 后取 `.data` | 双重 `.data`：控制器已解包 |
| `notes/latest` | `{"data":{"id","nid",...,"next":null},"meta":{...}}` | `notes/page.tsx:14` `latest?.data` | `notes/page.tsx:17` 读 `nullableData.isPublished` |
| `comments` | HTTP 401 `{"error":{"code":"AUTH_NOT_LOGGED_IN"}}` | 评论区 | **需鉴权** |
| `search/algolia` | HTTP 400 `{"error":{"code":"INVALID_SEARCH_TYPE",...}}` | `SearchFAB.tsx` | 端点已移除 |
| `fn/shiro/status` | HTTP 404 `{"error":{"code":"FUNCTION_NOT_FOUND",...}}` | `OwnerStatus.tsx` | 端点已移除 |

**`.data` 双重取值陷阱**（很关键，T2 必须注意）：`getDataFromResponse` 若为**默认**（`res=>res.data`），则 api-client 已经把 v14 的信封剥掉了，于是 `category.getAllTags()` 返回的就是 `{data:[...],meta:{...}}`，此时源码里的 `.data`（`PostTagsFAB.tsx:38`）**正好取到 tags 数组** ✔。

而 `projects/page.tsx:22` 也写 `return data.data` —— 与 `PostTagsFAB` 同类。**这批 `.data` 是否要删，完全取决于 T2 最终选哪条路线（见 §3.0）**，不能无脑删。

### 2.6 `noRSS` / `custom_elements` 命名陷阱汇总

| v14 键 | 朴素 camel 结果 | Shiro 期望 | 一致？ |
|---|---|---|---|
| `no_rss` | `noRss` | `noRSS`（`app.config.d.ts:93`） | ✘ |
| `custom_elements` | `customElements` | `custom_elements`（`app.config.d.ts:92`，**故意保留下划线**） | ✘ |
| `favicon_dark` | `faviconDark` | `faviconDark`（`app.config.d.ts:53`） | ✔ |
| `created_at` | `createdAt` | `created` | ✘ |
| `modified_at` | `modifiedAt` | `modified` | ✘ |
| `total_pages` | `totalPages` | `totalPage` | ✘ |
| `page` | `page` | `currentPage` | ✘ |
| `pin_at` | `pinAt` | `pin` | ✘ |
| `read_count`/`like_count` | `readCount`/`likeCount` | `count.read`/`count.like` | ✘ |
| `social_ids` | `socialIds` | `socialIds` | ✔（但 v14 不返回，需兜底 `{}`） |
| `icon_dark` | `iconDark` | `iconDark` | ✔ |

---

## 3. Shiro 侧需要改动的文件清单（路径 + 行号 + 现写法 → 应改成什么）

### 3.0 先决策：两条路线（T2 必须先选，否则下面行号会互相矛盾）

Shiro 存在**两套并行的数据通路**，各自都会被 v14 打破，且修法不同：

- **通路 A（api-client 控制器）**：`apiClient.post.getList()` → `getDataFromResponse` → 可自动解包+camel，但会把 `{posts,notes}` 误当信封。
- **通路 B（ofetch 裸请求）**：`app/[locale]/api.tsx:19-27` 直接 `$fetch(apiClient.aggregate.proxy.toString(true))` + `simpleCamelcaseKeys`，**完全绕过** `getDataFromResponse`，因此**永远不解包**。

`apps/web/src/lib/fetch/shared.ts` 的覆盖同时影响 A 与 `$serialized` 内容。

**推荐路线（低风险、可增量验证）**：把归一化下沉到 `shared.ts` 一个点，统一产出「扁平 + camelCase + Pager 修正」的 v2 形状；同时把 `api.tsx` 的裸请求改为走同一归一化函数。

### 3.1 【最高优先级】`apps/web/src/lib/fetch/shared.ts`

**现写法（55-60 行）**：

```ts
  createClient(fetchAdapter)(API_URL, {
    controllers: allControllers,
    getDataFromResponse(response) {
      return response as any
    },
  })
```

**问题**：覆盖了 api-client 默认的 `res => res.data`（`dist/index.mjs:1038`），导致 v14 的 `{data:...}` 信封**永不解包**，`res` 顶层只剩 `data`。已实测（§1.5）：`Object.keys(res) === ["data"]`，`res.theme === undefined`，`const {theme:{config}} = res` → `TypeError: Cannot read properties of undefined (reading 'config')`。

**建议改法**（给出可执行骨架，T2 按此落地）：

```ts
const unwrapV14Envelope = <T>(body: any): T => {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const keys = Object.keys(body)
    // v14 成功信封：仅有一个 data 键时才剥；避免误剥 {posts,notes}
    if (keys.length === 1 && keys[0] === 'data') return body.data as T
    // v14 错误信封：转成 api-client/ofetch 期望的 {message}
    if (keys.length === 1 && keys[0] === 'error') {
      const err: any = new Error(body.error?.message ?? 'Request failed')
      err.status = err.statusCode = err.code = body.error?.code
      throw err
    }
  }
  return body as T
}

export const createApiClient = (fetchAdapter) =>
  createClient(fetchAdapter)(API_URL, {
    controllers: allControllers,
    // 关键：不要覆盖默认语义，而是在其之上做 v14 兼容
    getDataFromResponse(response) {
      const body = response as any
      return unwrapV14Envelope(body)
    },
  })
```

⚠️ **重要**：**不能**简单写回 `response.data`。因为 `getTimeline` 的 v14 响应是 `{data:{posts,notes}}`，默认解包后 `res.data` 恰好正确；但 `aggregate/site`、`server-time`（`{"t2":...,"t3":...}`，**无信封**）等端点不能一刀切。**必须做「仅当顶层只有 `data` 一个键时才剥」的条件解包**，这正是上面 `unwrapV14Envelope` 的逻辑，也正是线上 shim（`/root/mx-space/v2-compat.mjs` `normalize()`）采用的策略。

**同时**：`getDataFromResponse` 里做 camelCase 转换**不必要**（api-client 的 `transformResponse` 已默认转，`dist/index.mjs:1037`），但 `no_rss`→`noRss` 这类**语义改名不受 camelCase 影响**，需另做（见 §3.4）。

### 3.2 `apps/web/src/app/[locale]/api.tsx`（通路 B，首页/Footer 的唯一数据源）

**现写法（19-29 行）**：

```ts
    const data = (await $fetch<
      AggregateRoot & { theme: AppThemeConfig }
    >(apiClient.aggregate.proxy.toString(true), {
      params: { theme: 'shiro' },
    }).then(simpleCamelcaseKeys)) as AggregateRoot & { theme: AppThemeConfig }
```

**问题**：`$fetch` 返回**完整信封** `{data:{...}}`，`simpleCamelcaseKeys` 只转键名**不解包**。已实测（真实线上报文 + 真实 api-client）：

```bash
cd /tmp/recon && node apitsx.mjs
# top-level keys of `data` : ["data"]
# data.theme               : undefined
# -- layout.tsx:59-64 destructure --  OK
# -- layout.tsx:73 new URL(url.webUrl) --  THROWS -> TypeError: Cannot read properties of undefined (reading 'webUrl')
# -- layout.tsx:75 seo.title --  THROWS -> TypeError: Cannot read properties of undefined (reading 'title')
```

**应改成**：解包后再 camel（注意 `data.theme` 可能不存在，故 33-36 行的兜底要保留）：

```ts
    const raw = await $fetch<{ data: AggregateRoot & { theme?: AppThemeConfig } }>(
      apiClient.aggregate.proxy.toString(true),
      { params: { theme: 'shiro' } },
    )
    const data = simpleCamelcaseKeys(raw.data ?? raw) as AggregateRoot & {
      theme: AppThemeConfig
    }
```

**并且**：`deepMerge(defaultThemeConfig, data.theme)`（34 行）只保证 `config.site.favicon` 等默认值存在；`data.theme` 为 `undefined` 时走 `defaultThemeConfig`，因此 `layout.tsx:63` 解构**在 `theme` 缺失时也会 500**（`theme: {config}` 对 `undefined` 解构抛错）。修好解包后此路径恢复正常。

### 3.3 时间字段映射（`created_at`→`created`、`modified_at`→`modified`）

必须改的读取点（现写法 → 应改成）：

| 文件:行 | 现写法 | 应改成 |
|---|---|---|
| `app/[locale]/timeline/page.tsx:129` | `new Date(post.created)` | `new Date(post.created)`（**保留读法**，改由数据层把 `created_at` 映射为 `created`） |
| `app/[locale]/timeline/page.tsx:150` | `new Date(note.created)` | 同上 |
| `app/[locale]/timeline/page.tsx:156-159` | `note.mood` / `note.weather` | 无需改（v14 同名） |
| `app/[locale]/posts/(post-detail)/[category]/[slug]/page.tsx:191-192` | `data.created` / `data.modified` | 同上 |
| `PostMetaBar.tsx:33,37,41,50` | `meta.created` / `meta.modified` | 同上 |
| `app/[locale]/(home)/components/HomePageTimeLine.tsx:106` | `post.created`（经 `organizePostsByDate`） | 同上 |
| `notes/[id]/pageExtra.tsx:87` | `data?.data.modified` | 同上 |

**推荐在数据层统一映射**（而非逐个改组件，避免 T2/T3 写作用域冲突）：

```ts
const RENAMES: Record<string, string> = {
  created_at: 'created', modified_at: 'modified',
  pin_at: 'pin', page: 'currentPage', total_pages: 'totalPage',
  no_rss: 'noRSS', custom_elements: 'custom_elements',
}
// 递归转换：先 camelCase，再对已知语义改名的键做重命名
```

⚠️ 若不修，`Intl.DateTimeFormat().format(Invalid Date)` 抛 `RangeError: Invalid time value`（已实测，见 §2.1 末尾）。

### 3.4 `noRSS` / `custom_elements` 兜底

- `app.config.d.ts:93` `noRSS?: boolean`；`app/feed/route.tsx:49` `get(agg.$raw.theme as AppConfig, 'config.module.rss.noRSS')`。
- `app.config.d.ts:92` `custom_elements: RSSCustomElements`；`app/feed/route.tsx:47` 读 `config.module.rss.custom_elements`。
- 现写法（数据层朴素 camel）→ `noRss` / `customElements`，两者都对不上。
- **应改成**：在归一化里加上述 `RENAMES` 特例。

⚠️ 注意 `app/feed/route.tsx:49` 读的是 `agg.$raw.theme`（**不是** `agg.theme`）。`$raw` 是 api-client 挂的**原始信封**（`dist/index.mjs:1142-1150`），因此那里拿到的是 **snake_case 的 `theme`**，含 `no_rss`/`custom_elements` → **恰好能对上**。这个文件属于「改动会互相影响」的区域，T2 需单独确认，标为**待验证**。

### 3.5 `categories` 的 `.data` 双重取值（T2 必须与 §3.1 一起决定）

| 文件:行 | 现写法 | 说明 |
|---|---|---|
| `components/modules/post/fab/PostTagsFAB.tsx:38` | `(await apiClient.category.getAllTags()).data` | 若 `getDataFromResponse` 走**条件解包**，控制器返回值 = `{data:[...],meta:{...}}`，`.data` **正确** ✔ |
| `components/modules/post/fab/PostTagsFAB.tsx:93` | `(await apiClient.category.getTagByName(tagName)).data` | 同上 |
| `app/[locale]/projects/page.tsx:22` | `return data.data` | 同上 |
| `app/[locale]/(note-topic)/notes/series/page.tsx:12` | `(await apiClient.topic.getAll()).data` | 同上 |
| `app/[locale]/timeline/page.tsx:108` / `timeline/layout.tsx:46` | `.then((res) => res.data)` | 同上，**保留 `.data` 才正确** |

**结论**：这批 `.data` 在「条件解包」路线下**应当保留**。这与 §3.1 的 `unwrapV14Envelope`（仅当只有 `data` 一个键时才剥）自洽：`{data:[...],meta:{...}}` 有 2 个键 → **不剥** → `res.data` 仍是数组 ✔。

### 3.6 `owner/check_logged` 判定逻辑（独立小 bug）

`app/[locale]/layout.tsx:200-206`：

```ts
  const userAuth = await fetch(apiClient.proxy('owner')('check_logged').toString(true), { headers })
    .then((res) => res.json())
    .then((res) => !!res.ok)
    .catch(() => false)
```

v14 真实返回：

```bash
ssh ... "curl -s 'http://127.0.0.1:2333/api/v3/owner/check_logged'"
# 输出： {"data":{"ok":0,"is_guest":true}}
```

**应改成** `!!res?.data?.ok`。现状 `!!res.ok` 对对象恒为 `true` → **游客也被判定为已登录**（影响 `UserAuth`/`OwnerStatus` 等客户端分支）。

### 3.7 缺失字段兜底（避免 T3 侧崩溃）

| 字段 | v14 是否返回 | Shiro 读取位置 | 兜底要求 |
|---|---|---|---|
| `pageMeta` | ✘ | `HeaderDataConfigureProvider.tsx:32,43`；`(page-detail)/[slug]/pageExtra.tsx:75` | 已有 `if (!pageMeta) return`（43 行）与 `pageMeta \|\| []`（76 行）→ **安全** |
| `socialIds` | ✘ | `layout.tsx:127`；`Hero.tsx:36,82`；`projects/page.tsx:27` | `Hero.tsx:82` 已有 `socialIds \|\| noopObj` ✔；`layout.tsx:127` 用 `user.socialIds?.twitter` ✔ 可选链；**建议数据层默认 `{}`** |
| `count` | ✘（拍平成 `read_count`） | `NoteMetaBar.tsx:62,79`；`NoteActionAside.tsx:85,97`；`PostActionAside.tsx:92,101`；`PostMetaBar.tsx:97,105` | **多数用了 `?.`，但 `NoteActionAside.tsx:97` 的 `draft.data.count.like += 1` 与 `PostActionAside.tsx:101` 的 `draft.count.like += 1` 会抛错** → 数据层必须合成 `count:{read,like}` |
| `allowComment` | ✘ | `notes/[id]/page.tsx:247` | 需给默认值（如 `true`） |
| `pin` | ✘（v14 叫 `pin_at`） | `PostItem.tsx:33,39,91,97` | 数据层映射 `pin_at`→`pin` |

### 3.8 全量受影响文件清单（供 T2/T3 划分写作用域）

**数据层（T2，`lib/**` + `app/[locale]/api.tsx` + `queries/**` 等）**：

```
apps/web/src/lib/fetch/shared.ts                                  ← §3.1 最高优先级
apps/web/src/app/[locale]/api.tsx                                 ← §3.2
apps/web/src/lib/request.shared.ts                                ← 错误信封 §1.1
apps/web/src/queries/definition/aggregation.ts:15                 ← .$serialized
apps/web/src/queries/definition/note.ts:17,25                     ← .$serialized
apps/web/src/queries/definition/page.ts:17                        ← .$serialized
apps/web/src/queries/definition/post.ts:33                        ← .$serialized
apps/web/src/app/[locale]/timeline/page.tsx:108                   ← .then(res=>res.data)（仅数据取用行）
apps/web/src/app/[locale]/timeline/layout.tsx:46                  ← 同上
apps/web/src/app/[locale]/(home)/layout.tsx:24                    ← .$serialized
apps/web/src/app/[locale]/(home)/components/ActivityRecent.tsx:21 ← .$serialized
apps/web/src/components/layout/footer/GatewayInfo.tsx:124         ← .$serialized
apps/web/src/app/[locale]/thinking/[id]/page.tsx:48               ← .$serialized
apps/web/src/app/[locale]/thinking/page.tsx:76                    ← .$serialized
apps/web/src/app/[locale]/(page-detail)/[slug]/api.ts:16          ← .$serialized
apps/web/src/app/[locale]/(note-topic)/notes/(topic-detail)/series/[slug]/query.ts:9
apps/web/src/components/modules/comment/hooks.tsx:18              ← .$serialized
apps/web/src/app/home-og/route.tsx:30                             ← .$serialized
apps/web/src/atoms/url.ts:20-28                                   ← {data:{...}} 解构
apps/web/src/app/feed/route.tsx:47,49                             ← $raw + noRSS/custom_elements
```

**渲染/序列化层（T3，`app/**` 页面组件 + `components/**`）**：

```
apps/web/src/app/[locale]/layout.tsx:63,186,218-232,242-245       ← theme 解构 + appConfig 传参
apps/web/src/components/layout/footer/FooterInfo.tsx:30,166-169   ← footer.otherInfo
apps/web/src/app/[locale]/timeline/page.tsx:129,150,155-164       ← created / Invalid Date
apps/web/src/app/[locale]/posts/page.tsx:62                       ← {data,pagination} 解构
apps/web/src/app/[locale]/posts/loader.tsx:45,46,61               ← pagination.hasNextPage
apps/web/src/components/modules/post/PostPagination.tsx:12,13,21,22
apps/web/src/components/modules/post/PostMetaBar.tsx:33,41,50,97,105
apps/web/src/components/modules/post/PostItem.tsx:33,39,91,97     ← pin
apps/web/src/components/modules/post/PostActionAside.tsx:92,101   ← count.like
apps/web/src/components/modules/note/NoteMetaBar.tsx:62,79        ← count.read/like
apps/web/src/components/modules/note/NoteActionAside.tsx:85,97    ← count.like
apps/web/src/app/[locale]/notes/[id]/page.tsx:230,231,246,247     ← allowComment
apps/web/src/app/[locale]/notes/[id]/pageExtra.tsx:87             ← modified
apps/web/src/components/modules/say/hooks.ts:22,23                ← pagination
apps/web/src/components/modules/comment/hooks.tsx:25,26,28        ← pagination
apps/web/src/providers/root/script-inject-provider.tsx:6-7        ← theme.config.custom
apps/web/src/components/layout/header/internal/HeaderDataConfigureProvider.tsx:32
apps/web/src/app/[locale]/(home)/components/Hero.tsx:34,36,37,78,82,103 ← hero.title/avatar/socialIds
apps/web/src/app/[locale]/(home)/components/HomePageTimeLine.tsx:109-114
```

**构建/部署（T4）**：见 §4.4。

---

## 4. 问题归属划分

> ⚠️ 依据 Lead 指示修正归属：**「样式/头像/HTML 转义」归 T3**（T3 = 页面组件 `app/**`、`components/**`）；**T4 只负责构建与部署链路（Dockerfile / pnpm / 镜像）**。下文按此划分。

### 4.1 解包 / 命名类 → **T2（数据层，`lib/**`、`queries/**`、`app/[locale]/api.tsx`）**

判据：**只要改对了取值路径/键名就能修好，不需要碰 JSX 结构。**

1. `shared.ts:57-59` 的 `getDataFromResponse` 覆盖导致信封不解包 —— §3.1（**一切下游 500 的总根因**）
2. `app/[locale]/api.tsx:19-27` 裸 `$fetch` 不解包 —— §3.2（首页 `Cannot read properties of undefined (reading 'config')` 直接来源）
3. `created_at`→`created`、`modified_at`→`modified` 语义改名 —— §3.3
4. `pin_at`→`pin` —— §3.6/§2.3
5. `read_count`/`like_count`→合成 `count:{read,like}` —— §3.7
6. `meta.pagination.{page,total_pages}`→顶层 `pagination.{currentPage,totalPage,hasNextPage,hasPrevPage}` —— §2.4
7. `no_rss`→`noRSS`、`custom_elements` 保持 —— §3.4
8. `allowComment` / `socialIds` / `pageMeta` 缺省兜底 —— §3.7
9. v14 错误信封 `{error:{code,message}}` → `request.shared.ts:7` 读不到 message —— §1.1
10. `owner/check_logged` 的 `!!res.ok` → `!!res?.data?.ok` —— §3.6
11. `.$serialized` 一批调用点在解包策略变化后的行为确认 —— §3.8 清单
12. `atoms/url.ts:20-28` 的 `{data:{adminUrl,webUrl}}` 与 401 —— §2.5
13. `server-time`（无信封）等**不能一刀切解包**的端点 —— §2.5

### 4.2 渲染 / 序列化类 → **T3（页面组件 `app/**`、`components/**`）**

判据：**取值可能已经对了，但组件结构/序列化边界/日期格式会崩或显示错。**

1. **`/timeline` 500：`Only plain objects ... can be passed to Client Components`（digest `886154139`）**
   - 现象已复现（§0.3）。位置：`timeline/layout.tsx` 的 `dehydrate(queryClient, {shouldDehydrateQuery})`（部署 chunk `(app)/timeline/page.js` 里可见 `shouldDehydrateQuery:e=>"timeline"===e.queryKey[0]`）→ 把查询状态交给 `QueryHydrate`（**`'use client'`**）。
   - 我实测确认：api-client 返回对象上挂的 `$raw`/`$request`/`$serialized` 均为 **`enumerable: false`**（`dist/index.mjs:1142-1150`），因此 `JSON.stringify` 不会碰到它们，**当前证据不足以把 500 归因到这三个属性**。线上 HTML 里也搜不到 `$serialized`/`$raw`（`grep -c` 全为 0）。
   - **确切机制标为「待验证」**，验证方法见 §5。无论如何，**该 500 的最终修复落点在 T3**（`timeline/layout.tsx` 的 dehydrate/QueryHydrate 边界、或 `timeline/page.tsx` 的渲染分支——那里的 `Intl.DateTimeFormat(...).format(item.date)` 在 `created` 缺失时抛 `RangeError`，已实测）。
2. `timeline/page.tsx:129,150` → `Invalid Date` → `Item` 内 `Intl.DateTimeFormat.format` 抛 `RangeError`（§2.1 实测）
3. `layout.tsx:63` / `:218-232` / `:242-245` 对 `theme`、`theme.config` 的解构与传参（`AggregationProvider`/`AccentColorStyleInjector`）
4. `FooterInfo.tsx:30,166` 的 `theme.footer` 解构（历史 500 `Cannot destructure property 'footer'`）
5. `posts/page.tsx:62`、`loader.tsx:45-46` 的 `pagination` 解构
6. `Hero.tsx:34` `title.template.reduce`（若 `hero.title` 缺失会崩）
7. `script-inject-provider.tsx:6-7` 的 `theme.config.custom` 解构
8. `count` / `pin` / `allowComment` 相关组件的显示分支（`PostMetaBar`、`NoteMetaBar`、`PostItem`、`PostActionAside`、`NoteActionAside`、`PostPinIcon`）

### 4.3 样式 / 头像 / HTML 转义类 → **T3（归入渲染层，不归 T4）**

> 按 Lead 指示：这类归 T3。

1. **头像「不显示」的确切原因已定位：不是字段名问题，是 Next Image Optimizer 拒绝 http 协议。**
   真实命令：

   ```bash
   ssh ... "curl -s 'http://127.0.0.1:2333/api/v3/aggregate?theme=shiro' | grep -o '\"avatar\":\"[^\"]*\"'"
   # 输出： "avatar":"http://q1.qlogo.cn/g?b=qq&nk=3853125761&s=640"     ← 注意是 http

   # 用真实头像 URL 打图片优化器
   ssh ... "curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:2323/_next/image?url=http%3A%2F%2Fq1.qlogo.cn%2Fg%3Fb%3Dqq%26nk%3D3853125761%26s%3D640&w=640&q=75'"
   # 输出： 400

   # 响应体明确说原因
   ssh ... "curl -s 'http://127.0.0.1:2323/_next/image?url=http%3A%2F%2Fq1.qlogo.cn%2F...&w=640&q=75'"
   # 输出： "url" parameter is not allowed

   # 同一主机换 https 就 200
   ssh ... "curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:2323/_next/image?url=https%3A%2F%2Fq1.qlogo.cn%2Fg%3Fb%3Dqq%26nk%3D3853125761%26s%3D640&w=640&q=75'"
   # 输出： 200
   ```

   且 Shiro 已把头像渲染成 `<img src="/_next/image?...">`（真实首页 HTML）：

   ```html
   <img alt="Site Owner Avatar" ... src="/_next/image?url=http%3A%2F%2Fq1.qlogo.cn%2F...&amp;w=640&amp;q=75"/>
   ```

   → 渲染链路本身是通的，**断在 `next.config.mjs` 的 `images` 配置拒绝 http**。该文件属构建/框架配置，**T3 与 T4 需协调**（见 §4.4）。已在 `Hero.tsx` 读到 `avatar`，字段名正确。
   注：远端主机 `q1.qlogo.cn` 是**可达**的（`docker exec shiro wget` → `HTTP/1.1 200 OK`, `Content-Type: image/jpeg`, 115761 bytes），所以不是网络问题。

   > **⚠️ 侦察结束时该问题仍未被任何任务认领**：`apps/web/next.config.mjs` 的 `images.remotePatterns`
   > 仍是 `[{ protocol: 'https', hostname: '**' }]`（仅 https），T4 当时只改了 `Dockerfile`。
   > 因此头像**仍会 400 不显示**，需要一个明确 owner 来修（建议 T4 改 `next.config.mjs`，或 T2 在数据层把 `http://` 升为 `https://`）。
2. **「主页简介里出现裸 HTML」的确切原因**：`theme.config.hero.title.template[]` 里的 `text` 本身就是含尖括号的字符串，真实 curl 可见：

   ```json
   {"type":"code","text":"<Developer />","class":"font-medium mx-2 text-3xl rounded p-1 ..."}
   ```

   `Hero.tsx:57-68` 用 `createElement(type, {className}, t.text)` 渲染，`type` 来自数据（`"h1"`/`"code"`/`"br"`），**`text` 作为普通文本子节点 → React 会转义**，所以页面上显示的是字面量 `<Developer />`（实测线上首页确实是转义显示，`grep '&lt;'` 为 0，RSC 流里是 `\u003cDeveloper /\u003e`）。
   → 这是**「期望渲染成 HTML/组件、实际被转义成文本」**的转义类问题，**归 T3**：需要把 `type: "code"` + `<Developer />` 这类模板项按主题约定转成真实 React 元素（`Shiro` 原版 `<Developer />` 组件），而不是纯文本。**T3 需决定渲染策略并说明安全边界**。
3. 其它 `dangerouslySetInnerHTML` 注入点（改动时需保持转义安全）：`layout.tsx:265`（版本号 console）、`(home)/page.tsx:79,85`（JSON-LD）、`AccentColorStyleInjector.tsx:51`、`posts/.../[slug]/pageExtra.tsx:46`、`preview/page.tsx:149`。
4. `theme.config.color` → `AccentColorStyleInjector`（`layout.tsx:218-219`）——若 `theme` 解构失败则整套主题色丢失（表现为「样式不对」）。
5. `theme.config.site.favicon` / `favicon_dark`（`layout.tsx:95,223,229`）。

### 4.4 构建 / 部署类 → **T4（Dockerfile / pnpm / 镜像链路）**

1. **`next.config.mjs:51-70` 的 `images` 配置**：`remotePatterns: [{ protocol: 'https', hostname: '**' }]` **只允许 https**，而站点头像是 `http://`。这是 §4.3-1 的根因，属**框架/构建配置**（不在 `app/**`、`components/**` 内）。
   - 修法选项：(a) 把 `protocol` 放宽为同时允许 `http`（`{protocol:'http',hostname:'**'}` 或改用 `remotePatterns` 双条）；(b) 数据层把 `http://` 升级为 `https://`（归 T2）；(c) 站点侧把头像源换成 https。
   - **T4 与 T3/T2 必须约定由谁改**，避免同文件争用。建议 **T4 负责 `next.config.mjs`**。
2. **`Dockerfile`**：`ENV NEXT_PUBLIC_API_URL=${BASE_URL}/api/v2`（`Dockerfile` 内硬编码 `/api/v2`）。这意味着**新构建的镜像仍会打 `/api/v2`**（即那条 shim 路径）。若 T2 的修复走「源码内归一化」，则**应改为 `/api/v3` 直连**，否则会**双重转换**（shim 先转一次 + 源码再转一次）。**这是 T4 的关键决策点**，必须与 T2 对齐。
3. **构建工具链**：`package.json` `packageManager: pnpm@10.27.0`、`engines.node >= 20`；`Dockerfile` `FROM node:lts-alpine` 并用 `npm install -g pnpm`（**不固定版本**，有漂移风险）。`apps/web` 的 `build` 脚本为 `tsc --noEmit && next build`，但 `next.config.mjs` 里 `typescript.ignoreBuildErrors: true`。
4. **构建期环境变量**：`next.config.mjs:66` `output: 'standalone'`；`ASSETPREFIX`、`TMDB_API_KEY`、`S3_*` 等经 `Dockerfile` ARG 注入。
5. **产物验证**：`apps/web` 有 `analyze`/`build:ci` 脚本；T4 需在改完后验证 `pnpm --filter @shiro/web build` 通过并产出 standalone。

### 4.5 归属速查表

| 问题 | 归属 |
|---|---|
| envelope 不解包（`shared.ts`） | T2 |
| 首页裸 `$fetch` 不解包（`api.tsx`） | T2 |
| `created_at`/`modified_at`/`pin_at`/`no_rss` 映射 | T2 |
| `count:{read,like}` 合成 | T2 |
| `Pager`（`page`→`currentPage`、补 `hasNextPage`） | T2 |
| 错误信封 `{error:{...}}` | T2 |
| `check_logged` 判定 | T2 |
| `/timeline` 500（RSC 序列化边界） | T3 |
| `Invalid Date` → `RangeError` 渲染 | T3 |
| `theme` / `theme.footer` / `theme.config` 解构与传参 | T3 |
| 头像不显示（http 被 Image Optimizer 拒） | **T3 定位 + T4 改 `next.config.mjs`** |
| 简介裸 HTML / `<Developer />` 转义 | T3 |
| 主题色 / favicon 丢失 | T3 |
| `next.config.mjs` images 协议 | T4 |
| `Dockerfile` 的 `/api/v2` vs `/api/v3` 决策 | T4（须与 T2 对齐） |
| pnpm / node / 镜像构建链路 | T4 |

---

## 5. 待验证项（附验证方法）

| # | 待验证内容 | 为什么未定论 | 验证方法 |
|---|---|---|---|
| 1 | `/timeline` 500（digest `886154139`）的**精确**触发对象 | 已复现 500 与日志，但实测 `$raw`/`$request`/`$serialized` 均 `enumerable:false` 且 `JSON.stringify` 不触碰；线上 HTML 也搜不到这三个标记 | 本地 `pnpm --filter @shiro/web build` 后用 `NODE_ENV=production` 跑，访问 `/timeline`，在 `timeline/layout.tsx` 临时打印 `dehydrate()` 结果并做 RSC `isPlainObject` 校验；或在部署镜像里给 `app-page.runtime.prod.js:12:139520` 打补丁打印 offending key |
| 2 | `app/feed/route.tsx:49` 的 `agg.$raw.theme` 是否仍能取到 snake_case 的 `noRSS` | `$raw` 挂的是原始信封；若 T2 改动归一化，`$raw` 内容可能变化 | 改完 T2 后在 `feed/route.tsx` 打印 `Object.keys(agg.$raw)` 与 `agg.$raw.theme?.config?.module?.rss` |
| 3 | v14 是否在所有端点都返回「仅 `data` 一键」信封 | `server-time` 已证实**无信封**（`{"t2":...,"t3":...}`），`owner/check_logged` 有信封；需确认全部端点 | 对 §3.8 清单涉及的每个端点跑 `curl -s ... \| head -c 50` 并检查顶层键数 |
| 4 | `theme.config.module` 的完整字段集（`subscription`/`og`/`openpanel`/`signature`/`posts`） | 线上主题只配了 `activity`/`donate`/`bilibili`/`rss` 四项 | 在 mx-admin 里补全主题配置后重新 `curl aggregate?theme=shiro` 对比 |
| 5 | `/api/v3` 是否保留 v2 风格的路径（如 `posts/get-url/:slug`） | 实测 404（`POST_NOT_FOUND`），post 详情页 `(post-detail)/[category]/page.tsx` 依赖它做重定向 | `curl -s -o /dev/null -w '%{http_code}' .../api/v3/posts/get-url/default`；若确为 404 需在 T3 改为直接 `redirect` 或用 category 数据合成 |
| 6 | `comments` / `aggregate/stat` / `options/url` 在**已登录**下的真实形状 | 未登录全部 401（`AUTH_NOT_LOGGED_IN`） | 用 owner token 调 `curl -H "Authorization: Bearer <token>" ...` 再取样本 |
| 7 | `AllowComment` 在 v14 的替代字段 | v14 详情页不返回 `allow_comment`/`comments_index` | 登录后看 `meta` 全量键，或查 mx-server v14 的 DTO 定义 |
| 8 | v14 是否把 `like_count` 改成需单独接口获取 | 详情页返回 `like_count`，但 Shiro 需 `count.like` 可变（点赞自增） | 结合 `activity/like` 端点实测 |
| 9 | `theme.config.module.rss.custom_elements` 的正确键名 | `app.config.d.ts:92` 保留下划线，与 camelCase 管线冲突 | 在主题配置里填一个非空 `custom_elements`，`curl aggregate` 看 v14 实际键名 |
| 10 | 图片优化器放宽 http 后的安全性 | 放宽 `protocol: 'http'` 会引入 SSRF 面 | 改后跑 `curl` 验证 http 头像 200，并评估是否改为数据层升 https（更安全） |
| 11 | 站点头像 URL 是否能稳定走 https | `q1.qlogo.cn` 实测 https 200，但 http 是 v14 返回值 | 数据层升 https 后观察长期可用性 |

---

## 6. 附：可复核的最小复现命令集

```bash
# 0) 准备工作
export SSH_ASKPASS=/data/dsh/home/xiaolin/askpass_nb.sh
export SSH_ASKPASS_REQUIRE=force DISPLAY=:0
SSH="ssh -p 23854 -o StrictHostKeyChecking=no root@156.254.7.90"

# 1) v14 真实响应（信封 + snake_case）
$SSH "curl -s 'http://127.0.0.1:2333/api/v3/aggregate?theme=shiro'"
$SSH "curl -s 'http://127.0.0.1:2333/api/v3/aggregate/timeline?year=2026'"
$SSH "curl -s 'http://127.0.0.1:2333/api/v3/posts?page=1&size=2'"
$SSH "curl -s 'http://127.0.0.1:2333/api/v3/notes/nid/1'"

# 2) shim 转换后的形状（Shiro 实际看到的）
$SSH "curl -s 'http://127.0.0.1:2334/api/v2/aggregate?theme=shiro'"
$SSH "curl -s 'http://127.0.0.1:2334/api/v2/posts?page=1&size=2'"

# 3) 线上故障复现
$SSH "curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:2323/timeline"
$SSH "docker logs shiro --since 20s 2>&1 | head -12"

# 4) 头像 http 被拒
$SSH "curl -s 'http://127.0.0.1:2323/_next/image?url=http%3A%2F%2Fq1.qlogo.cn%2Fg%3Fb%3Dqq%26nk%3D3853125761%26s%3D640&w=640&q=75'"
# -> "url" parameter is not allowed

# 5) 本地跑真实 api-client 管线（证据脚本，非仓库文件）
cd /tmp/recon && node real.mjs && node apitsx.mjs && node pl.mjs && node ser.mjs
```

线上证据快照（Lead 已抓取，与我的抓取 **逐字节一致**，已用 `diff` 校验）：

```
/data/dsh/home/xiaolin/live-evidence/
  v3-aggregate.json        2064B
  v3-aggregate-site.json    227B
  v3-timeline.json          419B
  v3-posts.json              94B
  v3-notes.json             588B
```

校验命令与结果：

```bash
$ for f in aggregate timeline posts notes; do diff <(sed 's/__HTTP_200__$//' /tmp/recon/$f.json) /data/dsh/home/xiaolin/live-evidence/v3-$f.json >/dev/null && echo "$f SAME" || echo "$f DIFFER"; done
# 输出： aggregate SAME / timeline SAME / posts SAME / notes SAME
```
