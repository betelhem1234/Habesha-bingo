#!/usr/bin/env bash
set -euo pipefail

export PATH="${HOME}/.fly/bin:${PATH}"

FLY_BIN="$(command -v fly || command -v flyctl || echo "${HOME}/.fly/bin/fly")"
if ! command -v "${FLY_BIN}" >/dev/null 2>&1; then
  echo "Fly CLI not found. Installing..."
  curl -L https://fly.io/install.sh | sh
  export PATH="${HOME}/.fly/bin:${PATH}"
  FLY_BIN="${HOME}/.fly/bin/fly"
fi

echo "Using Fly CLI: $(${FLY_BIN} version)"

# Check authentication
if ! "${FLY_BIN}" auth whoami >/dev/null 2>&1; then
  echo "Not logged into Fly.io. Please run:"
  echo "  fly auth login"
  echo "or set FLY_API_TOKEN environment variable."
  exit 1
fi

APP_NAME="$(grep -E '^app\s*=' fly.toml | head -1 | cut -d'"' -f2)"
if [ -z "${APP_NAME}" ]; then
  APP_NAME="habesha-bingo"
fi
echo "Target Fly app: ${APP_NAME}"

# Ensure app exists on Fly
if ! "${FLY_BIN}" apps list | grep -q "${APP_NAME}"; then
  echo "App ${APP_NAME} not found on Fly.io. Creating..."
  "${FLY_BIN}" apps create "${APP_NAME}"
fi

# Deploy with single machine for long-polling bot
echo "Deploying ${APP_NAME} to Fly.io..."
"${FLY_BIN}" deploy --ha=false

echo ""
echo "=== Deployment Complete ==="
"${FLY_BIN}" status
echo "App URL: https://${APP_NAME}.fly.dev"
