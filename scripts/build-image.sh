#!/usr/bin/env bash
#
# Build the Shiro production image.
#
# Usage:
#   BASE_URL=https://blog.xlinxc.cn ./scripts/build-image.sh
#
#   # or with an explicit prefix / tag
#   ./scripts/build-image.sh --base-url https://blog.xlinxc.cn --api-prefix /api/v3 --tag shiro:v14-compat
#
# Common options:
#   --base-url URL      (required) Public site origin, embedded in the baked
#                       NEXT_PUBLIC_* defaults. No trailing slash.
#   --api-prefix PATH   API prefix appended to BASE_URL. Default: /api/v3
#                       Use /api/v2 only if you still run the legacy v2
#                       compatibility layer in front of Core.
#   --tag TAG           Image tag. Default: shiro:v14-compat
#   --extra-tag TAG     Additional tag (repeatable), e.g. shiro:latest
#   --no-cache          Build without the Docker layer cache.
#   --dry-run           Print the docker command without running it.
#   -h | --help         Show this help.
#
# Secrets (optional, passed through only if set in the environment; they are
# baked into the build for the TMDB/GitHub/webhook proxy routes):
#   TMDB_API_KEY, GH_TOKEN, WEBHOOK_SECRET, S3_ACCESS_KEY, S3_SECRET_KEY
#
# NOTE: each --build-arg VALUE is visible in `docker history` of the resulting
# image. Prefer server-side .env / compose environment for anything sensitive
# that the runtime can read instead.

set -euo pipefail

API_PREFIX="${API_PREFIX:-/api/v3}"
TAG="${TAG:-shiro:v14-compat}"
EXTRA_TAGS=()
# Preserve an existing environment value: `BASE_URL=... ./build-image.sh` works.
BASE_URL="${BASE_URL:-}"
NO_CACHE=0
DRY_RUN=0

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

usage() {
  sed -n '2,29p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
}

log()  { printf '\033[1;34m[build-image]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[build-image] WARN:\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[build-image] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --base-url)    BASE_URL="${2:-}"; shift 2 ;;
    --api-prefix)  API_PREFIX="${2:-}"; shift 2 ;;
    --tag)         TAG="${2:-}"; shift 2 ;;
    --extra-tag)   EXTRA_TAGS+=("${2:-}"); shift 2 ;;
    --no-cache)    NO_CACHE=1; shift ;;
    --dry-run)     DRY_RUN=1; shift ;;
    -h|--help)     usage; exit 0 ;;
    *)             die "unknown argument: $1 (try --help)" ;;
  esac
done

# --------------------------------------------------------------------------
# Preflight
# --------------------------------------------------------------------------
[ -n "${BASE_URL}" ] || die "--base-url (or BASE_URL=...) is required.
  It must be the public origin, e.g. https://blog.xlinxc.cn
  Rationale: the runtime reads NEXT_PUBLIC_API_URL with next-runtime-env, and
  the server side fetches it with ofetch, which CANNOT resolve a relative URL
  ('Failed to parse URL from /api/v3/...'). So the in-image default must be an
  absolute URL."

case "${BASE_URL}" in
  */) die "--base-url must not end with a slash (got '${BASE_URL}')" ;;
  http://*|https://*) ;;
  *)  die "--base-url must start with http:// or https:// (got '${BASE_URL}')" ;;
esac

case "${API_PREFIX}" in
  /*) ;;
  *)  die "--api-prefix must start with '/' (got '${API_PREFIX}')" ;;
esac
case "${API_PREFIX}" in
  */) die "--api-prefix must not end with a slash (got '${API_PREFIX}')" ;;
esac

[ -f "${REPO_ROOT}/Dockerfile" ] || die "Dockerfile not found at ${REPO_ROOT}/Dockerfile"

if [ "${DRY_RUN}" -eq 0 ]; then
  command -v docker >/dev/null 2>&1 \
    || die "docker not found on PATH. This script must run on the Docker host
  (the image build is verified there; see docs/build-deploy.md)."
  docker info >/dev/null 2>&1 \
    || die "cannot talk to the Docker daemon (is it running / do you have permission?)"
fi

# Warn (do not fail) if the lockfile is out of sync with the manifests: the
# upstream "@haklex/* 0.0.105" bump commit did not refresh pnpm-lock.yaml, so
# the Dockerfile installs with --no-frozen-lockfile on purpose.
if command -v pnpm >/dev/null 2>&1 && [ -f "${REPO_ROOT}/pnpm-lock.yaml" ]; then
  if ! (cd "${REPO_ROOT}" && pnpm install --frozen-lockfile --lockfile-only >/dev/null 2>&1); then
    warn "pnpm-lock.yaml is NOT in sync with the manifests (known upstream issue).
  The Dockerfile uses --no-frozen-lockfile, so the build will still work, but the
  resolved dependency graph may differ slightly from the committed lockfile."
  fi
fi

# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------
REV="$(cd "${REPO_ROOT}" && { git rev-parse --short HEAD 2>/dev/null || echo nogit; })"
BUILD_DATE="$(date -u +%Y%m%d-%H%M%S)"

ARGS=(
  build
  --build-arg "BASE_URL=${BASE_URL}"
  --build-arg "API_PREFIX=${API_PREFIX}"
  --tag "${TAG}"
)

for t in ${EXTRA_TAGS+"${EXTRA_TAGS[@]}"}; do
  [ -n "${t}" ] && ARGS+=(--tag "${t}")
done

# Optional build-time secrets: forward only when present.
for secret in TMDB_API_KEY GH_TOKEN WEBHOOK_SECRET S3_ACCESS_KEY S3_SECRET_KEY; do
  if [ -n "${!secret:-}" ]; then
    ARGS+=(--build-arg "${secret}=${!secret}")
    log "forwarding build arg ${secret} (present)"
  fi
done

if [ "${NO_CACHE}" -eq 1 ]; then
  ARGS+=(--no-cache)
fi

# Label the build so the running container can be traced back to a revision.
ARGS+=(
  --label "org.opencontainers.image.revision=${REV}"
  --label "org.opencontainers.image.created=${BUILD_DATE}"
  --label "org.opencontainers.image.title=shiro"
)

log "repo      : ${REPO_ROOT}"
log "revision  : ${REV}"
log "BASE_URL  : ${BASE_URL}"
log "API_PREFIX: ${API_PREFIX}"
log "tags      : ${TAG} ${EXTRA_TAGS[*]:-}"
log "validating the Dockerfile parses ..."

if [ "${DRY_RUN}" -eq 1 ]; then
  log "DRY RUN — command that would be executed:"
  printf '  cd %q && docker' "${REPO_ROOT}"
  printf ' %q' "${ARGS[@]}"
  printf ' .\n'
  exit 0
fi

cd "${REPO_ROOT}"
docker "${ARGS[@]}" .

log "build finished"
docker image inspect "${TAG}" \
  --format 'image      : {{.RepoTags}}
id         : {{.Id}}
size       : {{.Size}} bytes
created    : {{.Created}}' || true

cat <<EOF

$(log "done")
Next steps (details in docs/build-deploy.md):
  1) Verify the image locally:
       docker run --rm -e NEXT_PUBLIC_API_URL=${BASE_URL}${API_PREFIX} \\
         -e NEXT_PUBLIC_GATEWAY_URL=${BASE_URL} -p 2323:2323 ${TAG}
       curl -sS -o /dev/null -w '%{http_code}\\n' http://127.0.0.1:2323/
  2) Ship it to the server (pick one):
       docker save ${TAG} | gzip | ssh <host> 'gunzip | docker load'
       # or push to a registry the server can pull from
  3) Deploy: docs/build-deploy.md -> "Replace the running container"
EOF
