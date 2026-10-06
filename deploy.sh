#!/usr/bin/env bash
set -euo pipefail

SERVICE_ID="${RENDER_SERVICE_ID:-srv-db0kfiad0e5s73c1f690}"
RENDER_BIN="$(command -v render || echo "${HOME}/bin/render")"

export RENDER_API_KEY="${RENDER_API_KEY:-$(cat "${HOME}/.render/api-key" 2>/dev/null || true)}"
if [ -z "${RENDER_API_KEY}" ]; then
  echo "Missing Render API key. Set RENDER_API_KEY or save it to ~/.render/api-key." >&2
  exit 1
fi

render() { "${RENDER_BIN}" "$@"; }

EXPECTED_BOT_PREFIX="8942533525"
EXPECTED_BOT_NAME="@PlayMyBingoBot"
APP_URL="${RENDER_APP_URL:-https://habesha-bingo-17p0.onrender.com}"

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

Verifies Render's BOT_TOKEN is @PlayMyBingoBot (8942533525) before
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

LATEST_COMMIT="$(git rev-parse HEAD)"

if [ "${CLEAN}" -eq 1 ]; then
  echo "Triggering clean (clear-cache) deploy..."
  render deploys create "${SERVICE_ID}" --clear-cache --wait
else
  echo "Waiting for commit ${LATEST_COMMIT:0:7} deploy to go live..."
  for _ in $(seq 1 40); do
    STATUS="$(render deploys list "${SERVICE_ID}" -o json 2>/dev/null | node -e '
      try {
        const deploys = JSON.parse(require("fs").readFileSync(0, "utf-8"));
        const target = deploys.find(d => d.commit && d.commit.id === process.argv[1]) || deploys[0];
        console.log((target && target.status) || "unknown");
      } catch(e) { console.log("unknown"); }
    ' "${LATEST_COMMIT}")"

    if [ "${STATUS}" = "live" ]; then
      echo "Deploy live."
      exit 0
    elif [ "${STATUS}" = "update_failed" ] || [ "${STATUS}" = "build_failed" ] || [ "${STATUS}" = "canceled" ]; then
      echo "Deploy failed with status: ${STATUS}. Check ./logs.sh for details." >&2
      exit 1
    fi
    echo "Current status: ${STATUS}... waiting 5s"
    sleep 5
  done
  echo "Still deploying after 200s - check ./logs.sh --tail or the dashboard." >&2
  exit 1
fi