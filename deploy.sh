#!/usr/bin/env bash
set -euo pipefail

SERVICE_ID="srv-da8p9v4s728c73bsblmg"
RENDER_BIN="$(command -v render || echo "${HOME}/bin/render")"

export RENDER_API_KEY="${RENDER_API_KEY:-$(cat "${HOME}/.render/api-key" 2>/dev/null || true)}"
if [ -z "${RENDER_API_KEY}" ]; then
  echo "Missing Render API key. Set RENDER_API_KEY or save it to ~/.render/api-key." >&2
  exit 1
fi

render() { "${RENDER_BIN}" "$@"; }

EXPECTED_BOT_PREFIX="8761631255"
EXPECTED_BOT_NAME="@BetysNewGamebot"
APP_URL="https://play-with-me-b19n.onrender.com"

current_bot_prefix() {
  curl -s --max-time 15 \
    "https://api.render.com/v1/services/${SERVICE_ID}/env-vars" \
    -H "Authorization: Bearer ${RENDER_API_KEY}" | \
    grep -oP '"key":"BOT_TOKEN","value":"\K[0-9]+' | head -1
}

BOT_PREFIX="$(current_bot_prefix)"
if [ -z "${BOT_PREFIX}" ]; then
  echo "Cannot read BOT_TOKEN from Render - aborting." >&2
  exit 1
fi
if [ "${BOT_PREFIX}" != "${EXPECTED_BOT_PREFIX}" ]; then
  echo "ABORT: Render BOT_TOKEN is prefix ${BOT_PREFIX}, not ${EXPECTED_BOT_NAME} (${EXPECTED_BOT_PREFIX})." >&2
  echo "Releasing to the wrong bot is not allowed. Fix the token on the Render dashboard (Environment) first." >&2
  exit 2
fi
echo "Releasing to ${EXPECTED_BOT_NAME} -> ${APP_URL}"

CLEAN=0
MSG_ARGS=()
for arg in "$@"; do
  case "$arg" in
    --clean) CLEAN=1 ;;
    -h|--help)
      cat <<'EOF'
Usage: ./deploy.sh [--clean] [message...]

  --clean   force a clear-cache deploy (skips the build cache)
  message   commit message for the push (default: "Deploy <timestamp>")

Verifies Render's BOT_TOKEN is @BetysNewGamebot (8761631255) before
deploying, and aborts otherwise.
EOF
      exit 0
      ;;
    *) MSG_ARGS+=("$arg") ;;
  esac
done
if [ "${#MSG_ARGS[@]}" -gt 0 ]; then
  MSG="${MSG_ARGS[*]}"
else
  MSG="Deploy $(date '+%Y-%m-%d %H:%M')"
fi

git add -A
git commit -q -m "${MSG}" || echo "Nothing to commit."
git push -q origin main

if [ "${CLEAN}" -eq 1 ]; then
  echo "Triggering clean (clear-cache) deploy..."
  render deploys create "${SERVICE_ID}" --clear-cache --wait
else
  echo "Waiting for auto-deploy to go live..."
  for _ in $(seq 1 30); do
    if render deploys list "${SERVICE_ID}" -o json 2>/dev/null | grep -q '"live"'; then
      echo "Deploy live."
      exit 0
    fi
    sleep 5
  done
  echo "Still deploying after 150s - check ./logs.sh --tail or the dashboard." >&2
  exit 1
fi