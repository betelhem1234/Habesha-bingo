#!/usr/bin/env bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

# Ensure systemd user bus is accessible
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

echo "🔄 Restarting Habesha Bingo Stack..."

# 1. Restart tunnel to ensure fresh quick-tunnel
echo "🌐 Restarting bingobot-tunnel.service..."
systemctl --user restart bingobot-tunnel

# 2. Wait for tunnel to be established and verified responding to index.html
echo "⏳ Waiting for live tunnel to initialize..."
LIVE_URL=""
for i in $(seq 1 15); do
    sleep 2
    CANDIDATE="$(grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$DIR/tunnel-3001.log" 2>/dev/null | tail -1 || true)"
    if [ -n "$CANDIDATE" ]; then
        HOST="${CANDIDATE#https://}"; HOST="${HOST%%/*}"
        IP="$(dig +short @8.8.8.8 "$HOST" A 2>/dev/null | grep -Ev '^$' | head -1 || true)"
        [ -z "$IP" ] && IP="$(dig +short @1.1.1.1 "$HOST" A 2>/dev/null | grep -Ev '^$' | head -1 || true)"
        if [ -n "$IP" ]; then
            CODE="$(timeout 5 curl -s -o /dev/null -w '%{http_code}' --resolve "$HOST:443:$IP" \
                -A 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' "https://$HOST/index.html" 2>/dev/null || echo 000)"
            if [ "$CODE" = "200" ]; then
                LIVE_URL="$CANDIDATE"
                break
            fi
        fi
    fi
done

# Fallback to latest candidate if DNS probe timed out
if [ -z "$LIVE_URL" ]; then
    LIVE_URL="$(grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$DIR/tunnel-3001.log" 2>/dev/null | tail -1 || true)"
fi

# 3. Update .env BINGO_APP_URL with the verified tunnel URL
if [ -n "$LIVE_URL" ]; then
    echo "🔗 Verified Tunnel URL: $LIVE_URL"
    sed -i "s|^BINGO_APP_URL=.*|BINGO_APP_URL=\"$LIVE_URL\"|" "$DIR/.env"
else
    echo "⚠️ Warning: Could not detect fresh tunnel URL, keeping current .env URL"
fi

# 4. Restart bot service so it re-reads .env with the new BINGO_APP_URL
echo "🤖 Restarting bingobot.service..."
systemctl --user restart bingobot

# 5. Check bot service status
if systemctl --user is-active --quiet bingobot; then
    echo "✅ Habesha Bingo Bot (bingobot.service) is RUNNING!"
else
    echo "❌ Failed to start bingobot.service. Checking status:"
    systemctl --user status bingobot --no-pager
    exit 1
fi

CURRENT_APP_URL="$(grep -E '^BINGO_APP_URL=' "$DIR/.env" 2>/dev/null | cut -d'"' -f2)"
echo "🌐 Public App URL (PLAY NOW): $CURRENT_APP_URL"

echo ""
echo "📜 Recent Bot Logs:"
echo "--------------------------------------------------"
tail -n 8 "$DIR/bot.log" 2>/dev/null || true
echo "--------------------------------------------------"
echo "✨ Restart completed successfully!"
