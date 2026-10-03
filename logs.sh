#!/usr/bin/env bash
set -euo pipefail

SERVICE_ID="srv-da8p9v4s728c73bsblmg"
RENDER_BIN="$(command -v render || echo "${HOME}/bin/render")"

export RENDER_API_KEY="${RENDER_API_KEY:-$(cat "${HOME}/.render/api-key" 2>/dev/null || true)}"
if [ -z "${RENDER_API_KEY}" ]; then
  echo "Missing Render API key. Set RENDER_API_KEY or save it to ~/.render/api-key." >&2
  exit 1
fi

if [ "${1:-}" = "--tail" ]; then
  shift
  exec "${RENDER_BIN}" logs --tail -r "${SERVICE_ID}" "$@"
fi

exec "${RENDER_BIN}" logs -r "${SERVICE_ID}" "$@"