#!/usr/bin/env bash
set -u

BINGO_DIR="/home/etech/.gemini/antigravity/scratch/bingo-game"
LOG="$BINGO_DIR/tunnel-3001.log"
ENV_FILE="$BINGO_DIR/.env"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

tc_code() {
    local host ip path="${2:-index.html}"
    host="${1#https://}"; host="${host%%/*}"
    ip="$(dig +short @8.8.8.8 "$host" A 2>/dev/null | grep -Ev '^$' | head -1)"
    [ -n "$ip" ] || ip="$(dig +short @1.1.1.1 "$host" A 2>/dev/null | grep -Ev '^$' | head -1)"
    [ -n "$ip" ] || { echo 000; return; }
    timeout 8 curl -s -o /dev/null -w '%{http_code}' --resolve "$host:443:$ip" \
        -A 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' "https://$host/$path" 2>/dev/null || echo 000
}

LIVE_URL="$(for u in $(grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOG" 2>/dev/null | tail -3); do
    code="$(tc_code "$u" index.html)"
    [ "$code" = "200" ] && printf '%s\n' "$u"
done | tail -1)"

if [ -z "$LIVE_URL" ]; then
    # Tunnel appears dead or not responding, trigger tunnel restart
    systemctl --user restart bingobot-tunnel >/dev/null 2>&1 || true
    exit 0
fi

CUR_URL="$(sed -n 's/^BINGO_APP_URL="\(.*\)"/\1/p' "$ENV_FILE")"

if [ "$CUR_URL" != "$LIVE_URL" ]; then
    printf '%s\n' "  [sync-url] URL changed: $CUR_URL -> $LIVE_URL"
    sed -i "s|^BINGO_APP_URL=.*|BINGO_APP_URL=\"$LIVE_URL\"|" "$ENV_FILE"
    if systemctl --user is-active bingobot >/dev/null 2>&1; then
        systemctl --user restart bingobot >/dev/null 2>&1
    fi
fi
exit 0
