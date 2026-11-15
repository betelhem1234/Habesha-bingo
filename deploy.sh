#!/usr/bin/env bash
set -euo pipefail

TARGET="render"
CLEAN=0
MSG_ARGS=()

for arg in "$@"; do
  case "$arg" in
    --fly) TARGET="fly" ;;
    --render) TARGET="render" ;;
    --all) TARGET="all" ;;
    --clean) CLEAN=1 ;;
    -h|--help)
      cat <<'EOF'
Usage: ./deploy.sh [--fly | --render | --all] [--clean] [message...]

  --fly     deploy only to Fly.io
  --render  deploy only to Render (default)
  --all     deploy to both Render and Fly.io
  --clean   force a clear-cache deploy on Render
  message   commit message for git push (default: "Deploy <timestamp>")

Examples:
  ./deploy.sh --fly "Deploy update to Fly.io"
  ./deploy.sh --render
  ./deploy.sh --all
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

echo "Target platform: ${TARGET}"

# Commit and push changes
git add -A
git commit -q -m "${MSG}" || echo "Nothing new to commit."
git push -q origin main

LATEST_COMMIT="$(git rev-parse HEAD)"

deploy_to_render() {
  echo "=== Deploying to Render ==="
  SERVICE_ID="${RENDER_SERVICE_ID:-srv-db0kfiad0e5s73c1f690}"
  RENDER_BIN="$(command -v render || echo "${HOME}/bin/render")"

  export RENDER_API_KEY="${RENDER_API_KEY:-$(cat "${HOME}/.render/api-key" 2>/dev/null || true)}"
  if [ -z "${RENDER_API_KEY}" ]; then
    echo "Missing Render API key. Set RENDER_API_KEY or save it to ~/.render/api-key." >&2
    return 1
  fi

  EXPECTED_BOT_PREFIX="8942533525"
  EXPECTED_BOT_NAME="@PlayMyBingoBot"
  APP_URL="${RENDER_APP_URL:-https://habesha-bingo-17p0.onrender.com}"

  BOT_PREFIX="$(curl -s --max-time 15 \
    "https://api.render.com/v1/services/${SERVICE_ID}/env-vars" \
    -H "Authorization: Bearer ${RENDER_API_KEY}" | \
    grep -oP '"key":"BOT_TOKEN","value":"\K[0-9]+' | head -1 || true)"

  if [ -z "${BOT_PREFIX}" ]; then
    echo "Warning: Cannot read BOT_TOKEN from Render (service may be suspended)." >&2
  elif [ "${BOT_PREFIX}" != "${EXPECTED_BOT_PREFIX}" ]; then
    echo "ABORT: Render BOT_TOKEN prefix ${BOT_PREFIX} is not ${EXPECTED_BOT_NAME} (${EXPECTED_BOT_PREFIX})." >&2
    return 2
  fi

  echo "Releasing to Render: ${APP_URL}"
  if [ "${CLEAN}" -eq 1 ]; then
    echo "Triggering clean (clear-cache) deploy..."
    "${RENDER_BIN}" deploys create "${SERVICE_ID}" --clear-cache --wait
  else
    echo "Waiting for commit ${LATEST_COMMIT:0:7} deploy to go live on Render..."
    for _ in $(seq 1 40); do
      STATUS="$("${RENDER_BIN}" deploys list "${SERVICE_ID}" -o json 2>/dev/null | node -e '
        try {
          const deploys = JSON.parse(require("fs").readFileSync(0, "utf-8"));
          const target = deploys.find(d => d.commit && d.commit.id === process.argv[1]);
          console.log((target && target.status) || "waiting_to_start");
        } catch(e) { console.log("unknown"); }
      ' "${LATEST_COMMIT}")"

      if [ "${STATUS}" = "live" ]; then
        echo "Render deploy live."
        return 0
      elif [ "${STATUS}" = "update_failed" ] || [ "${STATUS}" = "build_failed" ] || [ "${STATUS}" = "canceled" ]; then
        echo "Render deploy failed with status: ${STATUS}. Check ./logs.sh for details." >&2
        return 1
      fi
      echo "Current Render status: ${STATUS}... waiting 5s"
      sleep 5
    done
  fi
}

deploy_to_fly() {
  echo "=== Deploying to Fly.io ==="
  ./deploy-fly.sh
}

case "${TARGET}" in
  render)
    deploy_to_render
    ;;
  fly)
    deploy_to_fly
    ;;
  all)
    deploy_to_render || echo "Render deploy step failed or skipped."
    deploy_to_fly
    ;;
esac
