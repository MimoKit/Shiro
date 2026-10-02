# syntax=docker/dockerfile:1
#
# Shiro (Mix Space Web) production image.
#
# Design notes — see docs/build-deploy.md for the full rationale and evidence:
#   1. devDependencies are required to build this app (tsc, tailwind, postcss all
#      live in devDependencies), so the install/build stages never run with
#      NODE_ENV=production. Only the runner stage does.
#   2. The public API prefix is configurable via ARG API_PREFIX (default /api/v3).
#   3. Font installation is strictly best-effort: fonts only affect text
#      rendering, so a failed download must never fail the image build.
#   4. Next 16 ignores NEXT_SHARP_PATH (it just calls require('sharp')). sharp is
#      installed for linux/musl/x64 into /app/node_modules, which is where the
#      standalone server resolves it from.
#
# Build host requirement: next build (Turbopack) needs roughly 3-4 GB of free
# memory. A machine with less than ~4 GB free (or a Docker VM with a low memory
# ceiling) will get the Node process OOM-killed mid-build.

# ---------------------------------------------------------------------------
# base: shared toolchain
# ---------------------------------------------------------------------------
FROM node:lts-alpine AS base

# Keep the package manager pinned to the version in package.json#packageManager
# so the image resolves the same dependency graph as local/CI installs.
ARG PNPM_VERSION=10.27.0

RUN apk add --no-cache libc6-compat \
  && npm install -g "pnpm@${PNPM_VERSION}"

# ---------------------------------------------------------------------------
# deps: full dependency tree, INCLUDING devDependencies
# ---------------------------------------------------------------------------
FROM base AS deps

# Toolchain for optional native modules (sharp, @swc/core, esbuild, ...).
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy manifests first so the install layer is cached independently of the source.
# `patches/` is required: pnpm fails if a patchedDependencies entry is missing.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY patches ./patches
COPY apps/web/package.json ./apps/web/package.json
COPY packages/types/package.json ./packages/types/package.json

# Explicit non-production install. pnpm 10 does not skip devDependencies on
# NODE_ENV=production, but being explicit protects against a leaked build arg
# or a parent image default.
#
# --no-frozen-lockfile: the lockfile committed right after the upstream
# "@haklex/* 0.0.105" bump is out of sync with apps/web/package.json, so a
# frozen install fails on an untouched checkout. See docs/build-deploy.md
# ("Lockfile") for how to switch back to --frozen-lockfile once upstream fixes it.
ENV NODE_ENV=development
RUN pnpm install --no-frozen-lockfile --prod=false
# Fix Next.js CSS compiler (LightningCSS) failing on ::highlight() pseudo-element in @haklex/rich-editor
RUN find node_modules -name "rich-editor.css" -exec sed -i -E 's/::highlight\([^)]+\)/.dummy-highlight/g' {} +

# ---------------------------------------------------------------------------
# builder: full source + production build
# ---------------------------------------------------------------------------
FROM base AS builder

RUN apk add --no-cache git

WORKDIR /app

# Reuse the resolved dependency tree from deps.
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules

COPY . .

ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
# NOTE: this ENV is a default for anything else running in this stage, but it
# does NOT control the Next build's heap: apps/web/package.json's build script
# sets NODE_OPTIONS=--max_old_space_size=4096 itself and cross-env overrides
# this value (verified). Raise memory on the build host instead of relying on
# this variable. See docs/build-deploy.md "Memory requirement".
ENV NODE_OPTIONS=--max_old_space_size=3072

ARG BASE_URL
# Public API prefix, overridable per build:
#   --build-arg API_PREFIX=/api/v2   (legacy, needs the old v2 compatibility layer)
#   --build-arg API_PREFIX=/api/v3   (default: Core v14 native)
ARG API_PREFIX=/api/v3

# Optional build-time secrets. Pass with --build-arg (or --secret) and never commit.
ARG S3_ACCESS_KEY
ARG S3_SECRET_KEY
ARG WEBHOOK_SECRET
ARG TMDB_API_KEY
ARG GH_TOKEN

# Fail fast on a malformed public URL instead of shipping an image whose
# frontend silently cannot reach the backend. The API URL is consumed by ofetch
# on the server, which throws on relative URLs, and by the browser via
# window.__ENV — an empty value breaks the whole app.
RUN set -eu; \
    if [ -n "${BASE_URL:-}" ]; then \
      case "${API_PREFIX}" in \
        /*) ;; \
        *) echo "ERROR: API_PREFIX must start with '/' (got '${API_PREFIX}')" >&2; exit 1 ;; \
      esac; \
      case "${BASE_URL}" in \
        */) echo "ERROR: BASE_URL must not end with '/' (got '${BASE_URL}')" >&2; exit 1 ;; \
        http://*|https://*) ;; \
        *) echo "ERROR: BASE_URL must start with http:// or https:// (got '${BASE_URL}')" >&2; exit 1 ;; \
      esac; \
      echo "INFO: NEXT_PUBLIC_API_URL=${BASE_URL}${API_PREFIX}"; \
      echo "INFO: NEXT_PUBLIC_GATEWAY_URL=${BASE_URL}"; \
    else \
      echo "WARN: BASE_URL was not provided. The image will fall back to the" >&2; \
      echo "WARN: runner-stage defaults; you MUST set NEXT_PUBLIC_API_URL and" >&2; \
      echo "WARN: NEXT_PUBLIC_GATEWAY_URL in the container environment." >&2; \
    fi

ENV BASE_URL=${BASE_URL:-}
ENV NEXT_PUBLIC_API_URL=${BASE_URL:-}${API_PREFIX}
ENV NEXT_PUBLIC_GATEWAY_URL=${BASE_URL:-}

ENV S3_ACCESS_KEY=${S3_ACCESS_KEY}
ENV S3_SECRET_KEY=${S3_SECRET_KEY}
ENV TMDB_API_KEY=${TMDB_API_KEY}
ENV WEBHOOK_SECRET=${WEBHOOK_SECRET}
ENV GH_TOKEN=${GH_TOKEN}

RUN pnpm turbo run build --filter=@shiro/web

# Assert the standalone layout the runner stage depends on. If Next resolves a
# different tracing root (it normally picks the pnpm workspace root), the server
# entry would land somewhere else and the runner's COPY/CMD would silently
# produce an image that cannot start. Fail here with a clear message instead.
RUN set -eu; \
    entry=/app/apps/web/.next/standalone/apps/web/server.js; \
    if [ ! -f "$entry" ]; then \
      echo "ERROR: expected standalone entry not found: $entry" >&2; \
      echo "---- actual standalone tree (first 60 entries) ----" >&2; \
      find /app/apps/web/.next/standalone -maxdepth 4 2>/dev/null | head -60 >&2 || true; \
      echo "---- server.js files found ----" >&2; \
      find /app/apps/web/.next/standalone -maxdepth 5 -name server.js 2>/dev/null >&2 || true; \
      exit 1; \
    fi; \
    echo "INFO: standalone entry OK -> $entry"; \
    du -sh /app/apps/web/.next/standalone 2>/dev/null || true

# ---------------------------------------------------------------------------
# sharp: prebuilt sharp for the runner's linux/musl runtime.
#
# Installed in its own stage on purpose: `npm install --prefix /app` would PRUNE
# the node_modules that the standalone copy brings in (next, react, ...), which
# silently breaks the server. Here we install into an isolated prefix and the
# runner COPYs only the four resulting directories.
# ---------------------------------------------------------------------------
FROM base AS sharp

ARG SHARP_VERSION=0.34.5
# BuildKit provides TARGETARCH/TARGETPLATFORM. Map them so the right prebuilt
# sharp binary is installed for the image being produced (amd64 -> x64).
ARG TARGETARCH

RUN set -eu; \
    case "${TARGETARCH:-amd64}" in \
      amd64) NPM_CPU=x64; HOST_MATCH=x86_64 ;; \
      arm64) NPM_CPU=arm64; HOST_MATCH=aarch64 ;; \
      *) echo "ERROR: unsupported TARGETARCH '${TARGETARCH:-}'" >&2; exit 1 ;; \
    esac; \
    echo "INFO: installing sharp for linux/musl/${NPM_CPU}"; \
    mkdir -p /sharp; \
    npm install --prefix /sharp --no-save --no-package-lock --no-audit --no-fund \
      --os=linux --libc=musl --cpu="${NPM_CPU}" "sharp@${SHARP_VERSION}"; \
    ls -1 /sharp/node_modules/@img; \
    if [ "$(uname -m)" = "${HOST_MATCH}" ]; then \
      node -e "const s=require('/sharp/node_modules/sharp');console.log('INFO: staged sharp',s.versions.sharp,'libvips',s.versions.vips)"; \
    else \
      echo "WARN: cross-building (host $(uname -m) != target ${TARGETARCH}); skipping the smoke load test" >&2; \
      test -f /sharp/node_modules/@img/sharp-linuxmusl-${NPM_CPU}/lib/sharp-linuxmusl-${NPM_CPU}.node \
        || { echo "ERROR: prebuilt sharp binary missing for ${NPM_CPU}" >&2; exit 1; }; \
    fi

# ---------------------------------------------------------------------------
# runner: minimal runtime image
# ---------------------------------------------------------------------------
FROM node:lts-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=2323
ENV HOSTNAME=0.0.0.0
ENV NEXT_TELEMETRY_DISABLED=1

# fontconfig provides fc-cache. unzip is required by the Geist font step below
# (the previous image was missing it). curl/wget for the downloads.
# `tini` is intentionally not installed here — use `init: true` in compose
# instead, so the image build does not depend on the community repository.
RUN apk add --no-cache fontconfig wget curl unzip

# --- Fonts (best effort, never fatal) --------------------------------------
# Fonts only improve text rendering quality. A slow/blocked GitHub release, a
# rate limit or a moved asset must not fail the build, so every step is
# tolerated and the result is verified instead of assumed.
# Note: GNU wget (apk `wget`) leaves a 0-byte file behind when a download fails,
# so each file is size-checked and removed if it is not plausible.
RUN mkdir -p /usr/share/fonts/truetype/chinese /usr/share/fonts/truetype/english \
  && fetch_font() { \
       url="$1"; dest="$2"; \
       wget -q -T 60 -t 2 -O "$dest" "$url" || true; \
       size=$(wc -c < "$dest" 2>/dev/null || echo 0); \
       if [ "$size" -lt 10240 ]; then \
         echo "WARN: $url failed or too small (${size}B) - ignored"; \
         rm -f "$dest"; \
       else \
         echo "INFO: got $(basename "$dest") (${size}B)"; \
       fi; \
     }; \
     for f in LXGWWenKai-Regular.ttf LXGWWenKai-Medium.ttf LXGWWenKai-Light.ttf; do \
       fetch_font "https://github.com/lxgw/LxgwWenKai/releases/download/v1.520/${f}" \
                  "/usr/share/fonts/truetype/chinese/${f}"; \
     done; \
     fetch_font "https://github.com/vercel/geist-font/releases/download/1.5.0/geist-font-1.5.0.zip" \
                /tmp/geist.zip; \
     if [ -s /tmp/geist.zip ]; then \
       if unzip -o -q /tmp/geist.zip -d /tmp/geist; then \
         find /tmp/geist -name '*.ttf' -exec cp {} /usr/share/fonts/truetype/english/ \; ; \
       else \
         echo "WARN: geist unzip failed (ignored)"; \
       fi; \
     fi; \
     rm -rf /tmp/geist.zip /tmp/geist; \
     fc-cache -f >/dev/null 2>&1 || echo "WARN: fc-cache failed (ignored)"; \
     echo "INFO: ttf fonts installed: $(find /usr/share/fonts/truetype -name '*.ttf' | wc -l) (0 is acceptable; fonts are cosmetic only)"

# --- Application -----------------------------------------------------------
# Standalone output of this pnpm monorepo puts the server entry at
# /app/apps/web/server.js, so the standalone tree is copied to /app and CMD
# must stay in sync with this layout.
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/.next/server ./apps/web/.next/server
COPY --from=builder /app/apps/web/public ./apps/web/public

# --- sharp for next/image ---------------------------------------------------
# Next 16 removed NEXT_SHARP_PATH and simply calls require('sharp') from
# `next/dist/server/image-optimizer.js`. Node resolves that by walking up from
# the requiring file, so sharp must be found in /app/node_modules — NOT in
# /app/apps/web/node_modules.
#
# Verified: copying these four directories keeps the standalone's own
# node_modules intact and makes require('sharp') resolve from next's location.
COPY --from=sharp /sharp/node_modules/sharp        ./node_modules/sharp
COPY --from=sharp /sharp/node_modules/@img         ./node_modules/@img
COPY --from=sharp /sharp/node_modules/detect-libc  ./node_modules/detect-libc
COPY --from=sharp /sharp/node_modules/semver       ./node_modules/semver

# Runtime defaults for the public env vars. These are read at RUNTIME by
# next-runtime-env (server: process.env, browser: window.__ENV injected by
# <PublicEnvScript/>), so they must exist in the container environment and can
# be changed without rebuilding — but they must be ABSOLUTE URLs, because the
# server side fetches through ofetch, which cannot resolve a relative URL
# (`Failed to parse URL from /api/v3/...`). compose/`docker run -e` overrides
# these; if BASE_URL is not passed at build time they fall back to a relative
# prefix that only works in the browser.
ARG BASE_URL
ARG API_PREFIX=/api/v3
ENV NEXT_PUBLIC_API_URL=${BASE_URL}${API_PREFIX}
ENV NEXT_PUBLIC_GATEWAY_URL=${BASE_URL}

EXPOSE 2323

CMD ["node", "apps/web/server.js"]
