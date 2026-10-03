#!/usr/bin/env bash
set -euo pipefail

BINGO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$BINGO_DIR"

CLOUDFLARED="$BINGO_DIR/cloudflared-linux-amd64"
LOG="$BINGO_DIR/tunnel.log"
# File holding the current live tunnel URL (written by the watchdog on restart)
URL_FILE="$BINGO_DIR/tunnel.url"

exec "$CLOUDFLARED" tunnel --url http://localhost:3001 --protocol http2 --logfile "$LOG" --no-autoupdate &
CF_PID=$!

printf '%s\n' "$$" > "$BINGO_DIR/tunnel.pid"
printf '%s\n' "$CF_PID" > "$BINGO_DIR/cloudflared.pid"

# Wait for the URL to appear, then record it.
for i in $(seq 1 30); do
    if grep -q 'trycloudflare.com' "$LOG" 2>/dev/null; then
        URL="$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" | tail -1)"
        printf '%s\n' "$URL" > "$URL_FILE"
        exit 0
    fi
    sleep 1
done
exit 1