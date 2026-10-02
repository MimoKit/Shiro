# Shiro 构建与部署（Core v14 适配版）

本文档说明：如何从本仓库源码构建出可替换线上旧镜像（`innei/shiro:1.2.3`）的镜像、如何替换线上容器、以及如何回滚。

> **本机无 docker**：本机（开发容器）没有安装 docker，**镜像构建验证由 Lead 在服务器上执行**。
> 本机完成的验证是：`pnpm install` 成功 + `tsc --noEmit` 结果 + 构建链路的静态核查（见文末「已在本机验证 / 未验证」）。
> 服务器为 Debian 13 / x86_64 / docker 29.8.0 / compose v5.5.1，可直连 Docker Hub。

---

## 0. TL;DR — 服务器上直接可复制执行

```bash
# 1) 在服务器上拿到源码（不要用 docker compose build 的旧缓存）
cd /root/mx-space            # 线上 compose 所在目录
git clone https://github.com/<your-fork>/Shiro.git shiro-src   # 或 git -C shiro-src pull
cd shiro-src

# 2) 构建镜像（默认 API 前缀 /api/v3）
export BASE_URL=https://blog.xlinxc.cn
./scripts/build-image.sh --base-url "$BASE_URL" --api-prefix /api/v3 --tag shiro:v14-compat --extra-tag shiro:latest

# 3) 验证镜像能起来（可选但强烈建议）
docker run --rm -d --name shiro-verify -p 12323:2323 \
  -e NEXT_PUBLIC_API_URL="${BASE_URL}/api/v3" \
  -e NEXT_PUBLIC_GATEWAY_URL="${BASE_URL}" \
  shiro:v14-compat
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:12323/    # 期望 200
docker logs --tail 30 shiro-verify
docker rm -f shiro-verify

# 4) 替换线上容器（见 §4）
```

等价的裸 `docker build` 命令（不使用脚本时）：

```bash
docker build \
  --build-arg BASE_URL=https://blog.xlinxc.cn \
  --build-arg API_PREFIX=/api/v3 \
  -t shiro:v14-compat -t shiro:latest \
  .
```

---

## 1. 环境变量清单

这些变量分两类，**生效时机完全不同**，是本次适配最容易踩的坑。

### 1.1 运行时变量（改这些不需要重新构建镜像）

`apps/web/src/constants/env.ts` 通过 `next-runtime-env` 的 `env()` 读取变量：

- **服务端**：直接读 `process.env[key]`（运行时）
- **浏览器**：读 `window.__ENV`，由 `<PublicEnvScript />` 在**运行时**注入（`getPublicEnv()` 收集所有 `NEXT_PUBLIC_*`）

因此下列变量是 **runtime env**，改完只需重启容器：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `NEXT_PUBLIC_API_URL` | **是** | 后端 API 基址。**必须是绝对 URL**。例：`https://blog.xlinxc.cn/api/v3` |
| `NEXT_PUBLIC_GATEWAY_URL` | **是** | Gateway（Socket.IO 实时状态）基址，绝对 URL。例：`https://blog.xlinxc.cn` |
| `PORT` | 否 | 默认 `2323`（standalone server 读 `process.env.PORT`，兜底 3000） |
| `HOSTNAME` | 否 | 默认 `0.0.0.0`（Dockerfile 已设，保证容器外可访问） |

> ⚠️ **致命点**：如果 runner 环境里没有 `NEXT_PUBLIC_API_URL`，`env('NEXT_PUBLIC_API_URL')` 返回 `undefined`，
> 代码里是 `|| '/api/v2'` 兜底 —— 在浏览器侧 `PublicEnvScript` 没注入该 key 时会变成**空串**，
> 表现为前端完全请求不到后端。**上线时必须在 compose 的 `environment:` 里显式传入这两个变量**，
> 不要依赖镜像内的默认值。

> ⚠️ **不要用相对路径**：服务端用 `ofetch` 发请求，相对 URL 会直接抛
> `Failed to parse URL from /api/v3/...`。所以 `NEXT_PUBLIC_API_URL` 必须是 `https://host/api/vN` 这种绝对形式。

### 1.2 构建期变量（改这些必须重新构建镜像）

| 变量 | 默认 | 说明 |
| --- | --- | --- |
| `BASE_URL` | 空 | 站点公网 origin，用于拼出 `NEXT_PUBLIC_*` 的镜像内默认值。不带结尾 `/` |
| `API_PREFIX` | `/api/v3` | API 前缀，拼在 `BASE_URL` 之后 |
| `TMDB_API_KEY` | 空 | `/api/tmdb/*` 代理路由使用 |
| `GH_TOKEN` | 空 | `/api/gh/*` 代理路由使用 |
| `WEBHOOK_SECRET` | 空 | `/api/webhook` 校验用 |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | 空 | 预留 |
| `SHARP_VERSION` | `0.34.5` | 与 `apps/web` 的 `sharp` devDependency 保持一致 |
| `PNPM_VERSION` | `10.27.0` | 与 `package.json#packageManager` 保持一致 |

> `next.config.mjs` 的 `images` 配置会被 **Next 在构建期写进产物**
> （`apps/web/.next/standalone/apps/web/server.js` 里 `const nextConfig = {...}` 是构建时 `JSON.stringify` 的结果，
> 启动时再赋给 `process.env.__NEXT_PRIVATE_STANDALONE_CONFIG`）。
> **结论：修改 `next.config.mjs` 必须重新构建镜像才生效，重启容器没用。**

### 1.3 `NEXT_SHARP_PATH` —— 不再需要（不要设置）

旧镜像设置 `NEXT_SHARP_PATH=/usr/local/lib/node_modules/sharp`。**Next 16.1.6 已经完全不读这个变量**：

```
$ grep -rn "NEXT_SHARP_PATH" apps/web/node_modules/next/dist   # 零命中
```

Next 16 在 `dist/server/image-optimizer.js` 里只做 `require('sharp')`，由 Node 从该文件位置向上查找 `node_modules`。
本项目 standalone 布局下，`next` 位于 `/app/node_modules/next`，因此 **sharp 必须放在 `/app/node_modules/sharp`**。

Dockerfile 已按此处理：用独立 `sharp` 阶段安装 linux/musl/x64 版本，再 `COPY` 到 `/app/node_modules/`。
**请不要再设置 `NEXT_SHARP_PATH`**——它没有作用，只会误导排查。

### 1.4 compose 片段（可直接粘贴）

```yaml
services:
  shiro:
    container_name: shiro
    image: shiro:v14-compat          # 或 shiro:latest
    init: true                       # 代替 tini，便于回收僵尸进程
    environment:
      # 必须显式传入：这两个是 runtime env，缺了会导致前端拿不到 API 地址
      NEXT_PUBLIC_API_URL: https://blog.xlinxc.cn/api/v3
      NEXT_PUBLIC_GATEWAY_URL: https://blog.xlinxc.cn
      PORT: "2323"
      HOSTNAME: 0.0.0.0

      # 可选：服务端路由用到的密钥（缺失时对应接口返回 500）
      # TMDB_API_KEY: ""
      # GH_TOKEN: ""
      # WEBHOOK_SECRET: ""

      # NEXT_SHARP_PATH 不要设置（Next 16 已忽略）
    volumes:
      - ./shiro-public:/app/apps/web/public   # 自定义 favicon 等（可选，见下方警告）
      # 旧写法：用 .env 文件提供上面的变量（仍然有效，但 environment: 优先级更高）
      # - ./.env:/app/apps/web/.env
    restart: always
    ports:
      - 2323:2323
```

> 注意：`volumes` 挂载 `/app/apps/web/public` 会**覆盖镜像内该目录**。旧 compose 用 `./public:/app/apps/web/public`，
> 如果宿主目录是空的，favicon 等静态资源会消失。确认宿主目录内容与镜像一致，或直接不要挂载。

#### 关于挂载 `.env` 文件（旧 compose 的做法）

旧 compose 用 `./.env:/app/apps/web/.env`。Next 在**启动时**会通过 `@next/env` 的 `loadEnvConfig()`
读取 `.env` 文件，所以这种写法**仍然有效**；但要注意优先级：

`@next/env` 的 `populate()` 只在 `process.env` 里**没有**该 key 时才写入（除非显式 `override`）。
也就是说：

- **已有的容器环境变量优先**，`.env` 文件只补充缺失的 key；
- 如果你在 compose 的 `environment:` 里设了 `NEXT_PUBLIC_API_URL`，那么同名的 `.env` 项**不生效**。

两种方式选一种即可，不要两处都配（容易产生「改了 .env 却没生效」的困惑）。
本项目的 compose 采用 `environment:` 方式，因为它更直观、也更容易被 `docker compose config` 校验。

---

## 2. 构建镜像

### 2.1 推荐：用仓库自带脚本

```bash
cd <repo>
export BASE_URL=https://blog.xlinxc.cn
./scripts/build-image.sh --base-url "$BASE_URL" --api-prefix /api/v3 \
  --tag shiro:v14-compat --extra-tag shiro:latest
```

脚本会做参数校验（`BASE_URL` 必需、不能有结尾 `/`、必须有 scheme）、检查 docker 可用性、
检测 lockfile 是否与 manifest 同步（不同步只告警不失败），最后打印镜像 id/大小。

常用参数：

| 参数 | 说明 |
| --- | --- |
| `--base-url URL` | 必需，站点 origin（也可用环境变量 `BASE_URL=`） |
| `--api-prefix PATH` | 默认 `/api/v3`；临时回退可用 `/api/v2`（也可用环境变量 `API_PREFIX=`） |
| `--tag` / `--extra-tag` | 镜像 tag（可多个；`--tag` 也可用环境变量 `TAG=`） |
| `--no-cache` | 不使用层缓存 |
| `--dry-run` | 只打印将执行的 docker 命令（**不校验 docker 是否存在**，便于本地预演） |
| `-h` / `--help` | 显示帮助 |

示例（全部走环境变量）：

```bash
BASE_URL=https://blog.xlinxc.cn API_PREFIX=/api/v3 TAG=shiro:v14-compat \
  ./scripts/build-image.sh
```

加 tag 时会自动附加 OCI label（`revision` / `created` / `title`），便于把线上镜像追回到具体提交。

### 2.2 裸 docker build

```bash
docker build \
  --build-arg BASE_URL=https://blog.xlinxc.cn \
  --build-arg API_PREFIX=/api/v3 \
  -t shiro:v14-compat -t shiro:latest \
  .
```

### 2.3 「无 docker 的机器不要构建」——以及内存要求

`next build` 走 Turbopack，**峰值内存约 3～4GB**。构建机（或 Docker VM）可用内存低于 ~4GB 时，
Node 进程会被内核 OOM killer 杀掉，日志表现为：

```
  Creating an optimized production build ...
Killed
EXIT=137
```

实测证据（本机 4GB / 2 核 / **无 swap**）：`oom_kill` 计数器从 0 涨到 4，
`memory.peak = 3478704128`（约 3.24GiB），且同样条件下 `tsc --noEmit` 也会被杀。

排障手段：

- 增大 docker 可用内存（Docker Desktop → Resources，或宿主机内存）
- 加 swap
- 先在本机 `pnpm install && pnpm turbo run build --filter=@shiro/web` 验证代码能编译，再上服务器构建

> ⚠️ **注意 `NODE_OPTIONS` 不由 Dockerfile 决定**：`apps/web/package.json` 的 build 脚本里写死了
> `NODE_OPTIONS=--max_old_space_size=4096`，`cross-env` 会**覆盖** Dockerfile 中的 ENV。
> 实测（turbo 环境下）：
>
> ```
> @shiro/web:build: > cross-env NODE_ENV=production NODE_OPTIONS=--max_old_space_size=4096 next build
> 外层 NODE_OPTIONS=--max_old_space_size=3072  ->  实际生效 4096
> ```
>
> 所以**不要指望用 `--build-arg NODE_OPTIONS=...` 或 Dockerfile ENV 来降低内存占用**；
> 正确的做法是给构建环境足够内存（建议 ≥5GB 可用）。Dockerfile 里的 ENV 只是给该阶段其它命令的默认值。

### 2.4 镜像内各阶段做了什么

| 阶段 | 关键点 |
| --- | --- |
| `base` | `node:lts-alpine`；只装 `libc6-compat`；`pnpm` 固定为 `10.27.0` |
| `deps` | 装 `python3 make g++`；**`NODE_ENV=development` + `--prod=false` 保证 devDependencies 一定被装上**（`tsc`/`tailwind`/`postcss`/`next` 都在 devDeps）；先复制 manifest 与 `patches/` 以便缓存，且 `patches/` 必须存在，否则 pnpm 报错 |
| `builder` | `NODE_ENV=development`、`NEXT_TELEMETRY_DISABLED=1`；`--build-arg` 注入 `BASE_URL`/`API_PREFIX`；执行 `pnpm turbo run build --filter=@shiro/web`（该脚本自己设置 `NODE_OPTIONS=--max_old_space_size=4096`，见 §2.3） |
| `sharp` | 独立阶段，`npm install --prefix /sharp --os=linux --libc=musl --cpu=x64 sharp@0.34.5` |
| `runner` | 只装 `fontconfig wget curl unzip`；字体下载**失败不致命**；复制 standalone 产物；把 sharp 的 4 个目录复制到 `/app/node_modules/` |

### 2.5 已修正的既有问题（原 Dockerfile 的真实缺陷）

| # | 问题 | 结论 / 修法 |
| --- | --- | --- |
| 1 | `unzip` 未安装却调用 `unzip /tmp/geist.zip` | **确实会失败**，已补 `unzip` |
| 2 | 从 GitHub Releases 下字体，受限网络会超时；旧写法 `RUN wget ...` 失败即中断构建 | 已改为**全部容错**（`|| echo WARN`），并在结束时清理 0 字节残留文件；`fc-cache` 失败也不致命 |
| 3 | `npm install -g --arch=x64 --platform=linux sharp` + `ENV NEXT_SHARP_PATH=...` | **两者都无效**：Next 16 不读 `NEXT_SHARP_PATH`；且 standalone 从 `/app/node_modules` 解析 sharp，而不是全局目录。已改为独立 `sharp` 阶段 + `COPY` 到 `/app/node_modules/` |
| 4 | `--arch=x64 --platform=linux` 未指定 libc | Alpine 是 musl，必须 `--libc=musl`，否则装到 glibc 变体，运行时报 `Could not load the "sharp" module using the linux-x64 runtime` |
| 5 | `NEXT_PUBLIC_API_URL` 硬编码 `/api/v2` | 已改为 `ARG API_PREFIX`，默认 `/api/v3` |
| 6 | standalone 路径与 `CMD` | 保持 `COPY .../standalone ./` + `CMD ["node","apps/web/server.js"]`，与 monorepo standalone 布局（入口 `apps/web/server.js`）一致 |
| 7 | `COPY --from=builder /app/apps/web/.next/server` | 原文件有，但**建议保留**：standalone 已包含 server，重复复制无害；若删掉，请确认 `/_next/image` 等运行时仍正常 |
| 8 | `NODE_ENV=production` 的位置 | 经实测**不是**构建失败原因：它在 `builder` 阶段（第 29 行），而 `pnpm install` 在 `deps` 阶段（第 15 行），**不同 stage 的 ENV 不互相生效**；且实测 pnpm 10.27 在 `NODE_ENV=production` 下**仍会安装 devDependencies**。仍按最佳实践固定为 development |
| 9 | `npm install --prefix /app ...` 会**清空** standalone 带来的 `node_modules` | 实测：`next`/`react` 被 prune 掉，服务直接起不来。已改为独立阶段 + 精确 COPY |
| 10 | `.dockerignore` 里的 `node_modules/` 与 `.next` **不匹配子目录** | Docker 的 ignore 匹配锚定在**上下文根**，`node_modules` 只排除 `./node_modules`，**不会**排除 `apps/web/node_modules`。必须写成 `**/node_modules`。已修正 |

关于第 9 点，实测输出：

```
=== BEFORE: next react ===
（执行 npm install --prefix /app ... sharp）
=== AFTER: @img detect-libc semver sharp ===
next PRUNED (!!)
react PRUNED (!!)
```

### 2.6 `.dockerignore` 为什么必须用 `**/` 前缀（第 10 点细节）

原 `.dockerignore` 用的是裸 `node_modules/` 和 `.next`。用 moby/patternmatcher 的匹配逻辑实测：

```
--- 原 .dockerignore（裸模式） ---
  EXCLUDED  node_modules/react/index.js
  INCLUDED  apps/web/node_modules/sharp/package.json        <-- 漏了
  INCLUDED  apps/web/node_modules/.bin/next                 <-- 漏了
  INCLUDED  packages/types/node_modules/tsdown/package.json <-- 漏了
  INCLUDED  apps/web/.next/BUILD_ID                          <-- 漏了
  INCLUDED  apps/web/.next/server/app/page.js                <-- 漏了

--- 修正后（**/node_modules, **/.next） ---
  以上全部 EXCLUDED
```

后果（真实体积）：宿主的 `apps/web/.next` 有 **116MB**，`apps/web/node_modules` 有 **86 个 symlink**
指向 `../../../node_modules/.pnpm/...`。这些内容一旦进入构建上下文：

1. 上下文从 ~几 MB 膨胀到 **123MB**；
2. builder 阶段的 `COPY . .` 会用宿主的 `apps/web/node_modules` **覆盖** deps 阶段刚装好的那份，
   而那 86 个 symlink 指向的 `node_modules/.pnpm` 并没有被复制进去 —— 全变成**悬空链接**，
   构建会以莫名其妙的模块解析错误失败。

所以 `.dockerignore` 里所有「任意深度」的排除都必须写 `**/` 前缀。
当前文件已按此修正，并加了断言测试（见 §8）。

> 另外注意：`.dockerignore` 里**不能**排除 `patches/`、`.npmrc`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`，
> 否则 `pnpm install` 会失败或丢失 overrides/patches。当前文件末尾有显式注释提醒。

---

## 3. Lockfile 说明（重要）

**当前 committed lockfile 与 manifest 不同步**，`--frozen-lockfile` 在未改动的 HEAD（`891bb24`）上就会失败：

```
$ pnpm install --frozen-lockfile
ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile" because pnpm-lock.yaml is not up to date with <ROOT>/apps/web/package.json
  Failure reason:
  specifiers in the lockfile don't match specifiers in package.json:
* 2 dependencies are mismatched:
  - @haklex/rich-editor (lockfile: 0.0.85, manifest: 0.0.105)
  - @haklex/rich-kit-shiro (lockfile: 0.0.74, manifest: 0.0.105)
```

原因：上游那次 `chore(deps): bump @haklex/* to 0.0.105` 提交忘了同步 lockfile。

因此 **Dockerfile 使用 `pnpm install --no-frozen-lockfile`**。等上游修好（或本 fork 提交一份同步后的 lockfile）后，可以切回更可复现的写法：

```dockerfile
RUN pnpm install --frozen-lockfile --prod=false
```

切换前请先确认：

```bash
pnpm install --frozen-lockfile --lockfile-only && echo "lockfile 已同步，可以切回 frozen"
```

> 补充：工作区当前的 `pnpm-lock.yaml` 已被更新为与 manifest 同步的版本（`pnpm install` 后 lockfile 内容不再变化）。
> 是否提交这份 lockfile 由 Lead 决定。

### 3.1 pnpm 10 忽略 `package.json#pnpm` 字段

pnpm 10.27 会打印：

```
[WARN] The "pnpm" field in package.json is no longer read by pnpm. The following keys were ignored:
"pnpm.onlyBuiltDependencies", "pnpm.overrides", "pnpm.patchedDependencies".
```

即 `overrides` / `patchedDependencies` / `onlyBuiltDependencies` 的新家应该是 `pnpm-workspace.yaml`。
**但实际安装仍然生效**，因为这两项已经写进了 `pnpm-lock.yaml` 的 `overrides:` 与 `patchedDependencies:` 段，
pnpm 从 lockfile 读取它们（实测 `@nolyfill/*` 覆盖与 `patch_hash=` 补丁依赖都真实落地）。

因此：**不要删除 `pnpm-lock.yaml`**，否则这些 overrides/patches 会丢失。
Dockerfile 里 `COPY patches ./patches` 也是必需的 —— 缺了它 pnpm 直接报
`ENOENT: no such file or directory, open '.../patches/@innei__markdown-to-jsx-yet.patch'`。

### 3.2 必须固定 pnpm 版本（pnpm 11 会让安装阶段直接失败）

Dockerfile 把 pnpm 固定为 `10.27.0`（与 `package.json#packageManager` 一致）。**这不是可选项**：

| pnpm 版本 | 有 build script 被忽略时的退出码 |
| --- | --- |
| 10.27.0 | `0`（只打印 `Ignored build scripts: sharp@0.34.5.` 提示） |
| 11.x | **`1`**（`ERR_PNPM_IGNORED_BUILDS`） |

实测：

```
# packageManager: pnpm@10.27.0
$ pnpm install ; echo $?
Ignored build scripts: sharp@0.34.5.
0

# 无 pin（本机全局 pnpm 11.7.0）
$ pnpm install ; echo $?
[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: sharp@0.34.5
1
```

本仓库 `package.json#pnpm.onlyBuiltDependencies` 已经不再被 pnpm 10 读取（见 §3.1），
所以「哪些包的构建脚本被允许执行」在安装时会被忽略并给出上述提示。
若镜像里用 pnpm 11 构建，`pnpm install` 会以退出码 1 结束，**镜像构建在 deps 阶段就失败**。

> 补充：即使 build script 被忽略，`sharp` 仍然可用 —— 因为它的二进制是以 `optionalDependencies`
> （`@img/sharp-*`）形式随包提供的，不依赖 postinstall 编译。实测 `require('sharp')` 正常返回
> `0.34.5 / libvips 8.17.3`。

若将来要升级 pnpm，请同步更新 `package.json#packageManager` 与 Dockerfile 的 `ARG PNPM_VERSION`，
并在升级后确认 `pnpm install` 退出码为 0。

---

## 4. 替换线上容器

线上是 docker compose（`/root/mx-space/docker-compose.yml`），`shiro` 服务当前用 `innei/shiro:latest`。

### 4.1 先备份现状（回滚依据）

```bash
cd /root/mx-space
cp docker-compose.yml docker-compose.yml.bak.$(date +%F-%H%M)
docker inspect shiro --format '{{.Config.Image}} {{.Image}}'    # 记录当前镜像
docker images | grep -E 'innei/shiro|shiro' | head
```

### 4.2 把新镜像送到服务器（二选一）

```bash
# A) 在构建机导出、服务器导入（无需 registry）
docker save shiro:v14-compat | gzip -1 | ssh <user>@<server> 'gunzip | docker load'

# B) 推到 registry（服务器可拉取时）
docker tag shiro:v14-compat <registry>/shiro:v14-compat
docker push <registry>/shiro:v14-compat
```

### 4.3 切换

```bash
cd /root/mx-space
# 把 shiro 服务的 image 改成 shiro:v14-compat
$EDITOR docker-compose.yml

# 先只重建 shiro 服务
docker compose up -d --no-deps shiro

# 观察
docker compose logs -f --tail=50 shiro
docker compose ps
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:2323/
```

### 4.4 上线后验证清单

```bash
# 容器在跑且端口通
docker compose ps shiro
curl -sSI http://127.0.0.1:2323/ | head -3

# 关键页面不再 500
for p in / /posts /notes /timeline /friends /says; do
  printf '%-12s %s\n' "$p" "$(curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:2323$p)"
done

# 运行时 env 真的注入进去了（浏览器读 window.__ENV）
curl -sS http://127.0.0.1:2323/ | grep -o '__ENV[^<]*' | head -2

# 头像这类 http 远端图不再 400（T5 修的是 remotePatterns）
curl -sS -o /dev/null -w '%{http_code}\n' \
  'http://127.0.0.1:2323/_next/image?url=http%3A%2F%2Fq1.qlogo.cn%2Fg%3Fb%3Dqq%26nk%3D3853125761%26s%3D640&w=640&q=75'
```

通过域名（nginx）再验证一遍：`curl -sSI https://blog.xlinxc.cn/`。

---

## 5. 回滚

### 5.1 最快：切回旧镜像

```bash
cd /root/mx-space
cp docker-compose.yml.bak.<时间戳> docker-compose.yml   # 或手动把 image 改回 innei/shiro:latest
docker compose up -d --no-deps shiro
docker compose logs -f --tail=50 shiro
```

旧镜像 `innei/shiro:1.2.3` 仍在本地时切换是秒级的；若已被清理，先 `docker pull innei/shiro:1.2.3`。

> ⚠️ 回滚到旧镜像时，**必须把 nginx 的 `/api/v2/` 兼容层恢复**（见 §6），因为旧前端只用 v2。

### 5.2 只回滚 API 前缀（不换镜像）

如果新镜像整体正常、只是前缀写错了，改 compose 的 `environment` 并重启即可 ——
`NEXT_PUBLIC_API_URL` 是 runtime env，**不需要重新构建**：

```yaml
environment:
  NEXT_PUBLIC_API_URL: https://blog.xlinxc.cn/api/v2
```

```bash
docker compose up -d --no-deps shiro
```

### 5.3 回滚判定信号

| 现象 | 可能原因 | 动作 |
| --- | --- | --- |
| 容器起来但首页 500 | API 地址错 / 后端不可达 | 查 `docker compose logs shiro`；核对 `NEXT_PUBLIC_API_URL` |
| 页面渲染但数据空白 | `NEXT_PUBLIC_*` 未注入 | 确认 `environment` 里有这两个变量并重启 |
| 图片全 400 | `next.config.mjs` 的 `images` 未生效 | 确认镜像是**改过 config 之后**重新构建的（config 构建期烘焙） |
| 头像/图片 500 且日志有 sharp 报错 | sharp 未正确放入 `/app/node_modules` | 检查镜像内 `node_modules/sharp`；不要设 `NEXT_SHARP_PATH` |
| 容器反复重启 | 端口/内存 | `docker inspect shiro --format '{{.State.OOMKilled}}'` |

---

## 6. API 前缀与 v2 兼容层下线

### 6.1 背景

- 线上 nginx 目前把 `/api/v2/` 指向一个**临时兼容层**（`/root/mx-space/v2-compat.mjs` + `systemd mx-v2-compat`，监听 2334），
  `/api/v3/` 指向真实 Core（2333）。
- 新前端是**原生适配 Core v14**，应当直连 `/api/v3`，不再依赖任何转换层。

### 6.2 镜像构建参数

| 前缀 | 何时用 |
| --- | --- |
| `/api/v3`（默认） | 正常上线，直连 Core v14 |
| `/api/v2` | 仅在兼容层仍然存在、需要临时回退时 |

因为 `NEXT_PUBLIC_API_URL` 是 runtime env，**日常切换只需改环境变量**；
`--build-arg API_PREFIX` 只决定**镜像内的默认值**（在没有显式传环境变量时兜底）。

### 6.3 兼容层下线顺序（务必按序，先切后删）

```bash
# 1) 确认新前端已直连 v3 且稳定（观察一个周期，建议 ≥1 天）
#    确认 shiro 容器环境变量是 /api/v3
docker compose exec shiro printenv NEXT_PUBLIC_API_URL

# 2) 确认没有流量再打到兼容层（nginx access log 里 /api/v2/ 应为 0）
grep -c '/api/v2/' /var/log/nginx/access.log

# 3) 备份并注释 nginx 的 /api/v2/ location，reload
cp /etc/nginx/conf.d/<shiro>.conf /root/mx-space/nginx-shiro.conf.bak.$(date +%F)
#   注释掉 location /api/v2/ { proxy_pass http://127.0.0.1:2334; }
nginx -t && systemctl reload nginx

# 4) 停用并删除临时兼容层
systemctl stop mx-v2-compat && systemctl disable mx-v2-compat
rm -f /etc/systemd/system/mx-v2-compat.service && systemctl daemon-reload
rm -f /root/mx-space/v2-compat.mjs

# 5) 再次全站验证
curl -sS -o /dev/null -w '%{http_code}\n' https://blog.xlinxc.cn/
```

> 回滚点：第 3 步的 nginx 备份文件 + 第 4 步之前 systemd 单元仍可恢复。建议在删文件前先 `stop` 观察一天。

---

## 7. 本地（无 docker）验证

```bash
cd <repo>
pnpm install                     # 见 §3 关于 lockfile 的说明
pnpm --filter @shiro/web exec tsc --noEmit
# 内存足够时（≥4GB 可用）：
pnpm turbo run build --filter=@shiro/web
```

构建产物位置（standalone 模式，monorepo）：

```
apps/web/.next/standalone/apps/web/server.js     # 服务器入口（容器内 /app/apps/web/server.js）
apps/web/.next/standalone/node_modules/          # 被 trace 的依赖
apps/web/.next/static/                           # 静态资源
apps/web/public/                                 # 公共静态文件
```

容器内最终布局与 `CMD` 的对应关系：

```
/app/apps/web/server.js   <-- CMD ["node", "apps/web/server.js"]
/app/node_modules/next    <-- sharp 从这里的 next 向上解析
/app/node_modules/sharp   <-- Dockerfile 用 COPY 放入（独立 sharp 阶段）
```

---

## 8. 已在本机验证 / 未验证

### 已在本机真实验证

- `pnpm install`：**成功**（exit 0）。**lockfile 内容未变化** —— 执行前后 sha256 一致：
  `96eee3af1d19ff38ff8f2fb3e7ac741e38beeb0e410b4f4363e76af3c3a1bf67`。
  注意工作区里的 `pnpm-lock.yaml` 在本次任务开始前就已被更新过（`git diff` 显示 699 插入/474 删除），
  但本次 `pnpm install` **没有产生新的改动**。
- `tsc --noEmit`：**通过**（exit 0），`apps/web` 下执行，全量非增量（`--incremental false`）20.2s。
  并用哨兵文件验证过它**真的在做类型检查**（临时插入 `const x: number = "..."` 后报
  `error TS2322`、exit 2；随后已删除该哨兵文件）。
  > 说明：早期在内存被队友 dev server 占用时，`tsc` 也曾被杀（exit 137）；内存释放后通过。
- `pnpm install --frozen-lockfile` **失败**，证明 §3 的 lockfile 结论（`ERR_PNPM_OUTDATED_LOCKFILE`）。
- docker deps 阶段等价模拟：在仅有 manifest + `patches/` + `.npmrc`（无 `.git`）的目录执行
  `pnpm install --no-frozen-lockfile --prod=false`，退出码 0；`overrides`（`@nolyfill/*`）与
  `patchedDependencies`（`patch_hash=`）都真实落地；用冷 store 再跑一次同样 exit 0。
- pnpm 版本差异（§3.2）：`packageManager: pnpm@10.27.0` 时 `pnpm install` exit 0；
  不 pin（走全局 pnpm 11.7.0）时同样场景 exit 1（`ERR_PNPM_IGNORED_BUILDS`）。
- `patches/` 缺失时 `pnpm install` 直接失败（`ENOENT ... patches/@innei__markdown-to-jsx-yet.patch`）。
- sharp 解析路径：构造与镜像一致的目录结构，验证 `require('sharp')` 从 `next/dist/server/` 出发时
  **只在 `/app/node_modules/sharp` 命中**；放在 `apps/web/node_modules` 会 `MODULE_NOT_FOUND`。
- `npm install --prefix /app` 会 **prune** 掉 standalone 的 `node_modules`（实测 `next`/`react` 消失）。
- Next 16 **完全不读 `NEXT_SHARP_PATH`**（`grep` 整个 `next/dist` 零命中）；Next 16 只做 `require('sharp')`。
- `next.config.mjs` 的 `images` 配置被**构建期烘焙**进 `standalone/.../server.js`
  （源码级证据：`const nextConfig = ${JSON.stringify(nextConfig)}`，启动时读 `__NEXT_PRIVATE_STANDALONE_CONFIG`）。
- 构建脚本会**覆盖** `NODE_OPTIONS`：`apps/web/package.json` 的 build 脚本写死
  `NODE_OPTIONS=--max_old_space_size=4096`，实测在 turbo 下外层 `3072` 被覆盖为 `4096`。
- `.dockerignore` 匹配语义（§2.6）：用 moby/patternmatcher 的匹配逻辑做了断言测试，
  修正后覆盖 11 个「必须排除」+ 19 个「必须保留」路径，全部通过。
- `scripts/build-image.sh`：`bash -n` 通过；`--help` / `--dry-run` 实测；
  5 条参数校验路径（缺 `--base-url`、结尾 `/`、无 scheme、前缀不以 `/` 开头、前缀结尾 `/`）均按预期报错。
- T5（头像 400）：用 Next 自带的 `ImageOptimizerCache.validateParams`，对真实 URL
  `http://q1.qlogo.cn/g?b=qq&nk=3853125761&s=640` 做「HEAD 版 config vs 修改后 config」对比：

  ```
  case                       BEFORE(HEAD)                              AFTER(working tree)
  owner avatar (http)        REJECTED: "url" parameter is not allowed   ACCEPTED
  owner avatar (https)       ACCEPTED                                  ACCEPTED
  ```

- 远端可达性：`http://q1.qlogo.cn/...` 与 `https://…` 均返回 200 / `image/jpeg` / 115761 字节。

### 未在本机验证（声明清楚，避免误判）

- **`next build` 整包构建未在本机跑通**：本机 4GB / 2 核 / **无 swap**，多次被 OOM killer 杀掉
  （`oom_kill` 计数 0→4，`memory.peak = 3478704128` 约 3.24GiB，日志结尾 `Killed` / `EXIT=137`），
  连 `tsc --noEmit` 在内存紧张时也会被杀。因此
  **「应用整包能编译通过」与「镜像能构建成功」这两件事未在本机得到证据**。
- **`docker build` 未在本机执行**（本机没有 docker）。
  Dockerfile 的所有 `COPY` 源路径、`apk` 包可用性（已核 Alpine v3.21/v3.22 的 main+community）、
  sharp 的 libc 变体都已按实际布局核对，但构建本身需在服务器确认。
- 字体下载在服务器网络下的实际耗时/成功率（已做成「失败不致命」，但成功与否未验证）。
- compose 文件未用 `docker compose config` 校验（本机无 docker/compose）。

### 服务器构建时的重点观察项

1. `pnpm install` 阶段是否出现 `ERR_PNPM_*`；确认使用的是 pnpm `10.27.0`（见 §3.2）。
2. `next build` 是否完成（内存不足会 `Killed`；建议构建机 ≥5GB 可用内存）。
3. runner 阶段 `INFO: ttf fonts installed: N` 的数量（0 也可接受，仅影响字体渲染）。
4. `COPY --from=sharp` 是否成功（若 musl 产物缺失会在此报错）。
5. 容器启动日志有无 `Cannot find module 'sharp'` / `Cannot find module 'next'`。
6. 起容器后浏览器侧 `window.__ENV` 是否包含 `NEXT_PUBLIC_API_URL`（见 §4.4）。
