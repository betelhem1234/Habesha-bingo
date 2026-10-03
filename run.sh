#!/usr/bin/env bash
# Habesha Bingo — check & fix the systemd-managed stack.
#
# Architecture:
#   bingobot.service        → runs src/bot.ts on port 3001 (.env PORT)
#   bingobot-tunnel.service → cloudflared quick tunnel → localhost:3001, logs to tunnel-3001.log
#   deploy/sync-url.sh      → keeps .env BINGO_APP_URL equal to the live tunnel URL
#
# Usage: bash run.sh          (check & fix only what's down)
#        bash run.sh --force  (restart both services even if healthy)
#        bash run.sh --status (just show status, don't change anything)
#        bash run.sh --dev    (run the local bot in the foreground; stops bingobot.service)
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$DIR"

export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
export DBUS_SESSION_BUS_ADDRESS="${DBUS_SESSION_BUS_ADDRESS:-unix:path=${XDG_RUNTIME_DIR}/bus}"

PORT="$(grep -E '^PORT=' "$DIR/.env" 2>/dev/null | cut -d'"' -f2 || echo "3001")"
[ -z "$PORT" ] && PORT="3001"
TUNNEL_LOG="$DIR/tunnel-3001.log"

say()  { printf '\033[1;36m%s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m  %s\033[0m\n' "OK  $*"; }
warn() { printf '\033[1;33m  %s\033[0m\n' "WARN $*"; }
fail() { printf '\033[1;31m  %s\033[0m\n' "FAIL $*"; }
sep()  { printf -- '----------------------------------------\n'; }

MODE="${1:-auto}"

latest_tunnel_url() {
    grep -aoE 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" 2>/dev/null | tail -1
}

# DNS-resilient HTTP probe
tc_code() {
    local host ip path="${2:-index.html}"
    host="${1#https://}"; host="${host%%/*}"
    ip="$(dig +short @8.8.8.8 "$host" A 2>/dev/null | grep -Ev '^$' | head -1)"
    [ -n "$ip" ] || ip="$(dig +short @1.1.1.1 "$host" A 2>/dev/null | grep -Ev '^$' | head -1)"
    [ -n "$ip" ] || { echo 000; return; }
    timeout 8 curl -s -o /dev/null -w '%{http_code}' --resolve "$host:443:$ip" \
        -A 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)' "https://$host/$path" 2>/dev/null || echo 000
}

bot_healthy() {
    timeout 3 bash -c "cat < /dev/null > /dev/tcp/127.0.0.1/$PORT" 2>/dev/null || return 1
    local code
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PORT/index.html" 2>/dev/null || echo 000)"
    [[ "$code" == "200" ]]
}

tunnel_healthy() {
    local url code
    url="$(grep -E '^BINGO_APP_URL=' "$DIR/.env" 2>/dev/null | cut -d'"' -f2)"
    [ -z "$url" ] && url="$(latest_tunnel_url)"
    [ -z "$url" ] && return 1
    code="$(tc_code "$url" index.html)"
    [[ "$code" == "200" ]]
}

unit_active() { systemctl --user is-active --quiet "$1" 2>/dev/null; }

restart_unit() {
    systemctl --user restart "$1" 2>/dev/null
}

local_bot_name() {
    echo "@PlayMyBingoBot (Habesha Bingo)"
}

if [[ "$MODE" == "--dev" ]]; then
    if unit_active bingobot; then
        warn "Stopping bingobot.service so it cannot double-poll the same bot"
        systemctl --user stop bingobot
    fi
    say "Running locally as $(local_bot_name). Ctrl-C to exit, then 'bash run.sh' to restore the systemd stack."
    [[ -d node_modules ]] || { say "Installing deps..."; npm ci >/dev/null; }
    exec npx tsx src/bot.ts
fi

wait_for_bot() {
    for _ in $(seq 1 12); do
        bot_healthy && return 0
        sleep 2
    done
    return 1
}

wait_for_tunnel() {
    local before="${1:-$(latest_tunnel_url)}" url
    for _ in $(seq 1 15); do
        sleep 3
        url="$(latest_tunnel_url)"
        if [ -n "$url" ]; then
            local code
            code="$(tc_code "$url" index.html)"
            if [[ "$code" == "200" ]]; then
                printf '%s' "$url"
                return 0
            fi
        fi
    done
    return 1
}

print_status() {
    say "== Current status =="
    say "Identity: $(local_bot_name)"
    if unit_active bingobot; then ok "systemd:  bingobot.service active"; else fail "systemd:  bingobot.service NOT active"; fi
    if unit_active bingobot-tunnel; then ok "systemd:  bingobot-tunnel.service active"; else fail "systemd:  bingobot-tunnel.service NOT active"; fi
    if bot_healthy; then ok "Bot:      running (port $PORT responds)"; else fail "Bot:      DOWN or not responding on port $PORT"; fi
    if tunnel_healthy; then ok "Tunnel:   reachable ($(grep -E '^BINGO_APP_URL=' "$DIR/.env" | cut -d'"' -f2))"; else fail "Tunnel:   DOWN or unreachable"; fi
}

if [[ "$MODE" == "--status" ]]; then
    print_status
    exit 0
fi

say "== Habesha Bingo Stack restart =="
sep

NEED_BOT=0
NEED_TUNNEL=0
if [[ "$MODE" == "--force" ]]; then
    NEED_BOT=1; NEED_TUNNEL=1
else
    unit_active bingobot || NEED_BOT=1
    bot_healthy          || NEED_BOT=1
    unit_active bingobot-tunnel || NEED_TUNNEL=1
    tunnel_healthy              || NEED_TUNNEL=1
fi

if [[ "$NEED_BOT" == "1" ]]; then
    say "== Restarting bot =="
    restart_unit bingobot
    if wait_for_bot; then ok "Bot restarted and healthy"; else fail "Bot still not responding (journalctl --user -u bingobot -n 30)"; fi
else
    ok "Bot is healthy - no restart needed"
fi

if [[ "$NEED_TUNNEL" == "1" ]]; then
    say "== Restarting tunnel =="
    BEFORE_URL="$(latest_tunnel_url)"
    restart_unit bingobot-tunnel
    NEW_URL="$(wait_for_tunnel "$BEFORE_URL")" || NEW_URL=""
    if [ -n "$NEW_URL" ]; then
        ok "Tunnel up: $NEW_URL"
        say "== Syncing app URL =="
        sed -i "s|^BINGO_APP_URL=.*|BINGO_APP_URL=\"$NEW_URL\"|" "$DIR/.env"
        systemctl --user restart bingobot     # re-read .env so buttons carry the new URL
        sleep 3
        bot_healthy && ok "Bot reloaded with new URL" || warn "Bot may need a moment"
    else
        fail "Tunnel still unreachable (journalctl --user -u bingobot-tunnel -n 30)"
    fi
else
    ok "Tunnel is healthy - no restart needed"
fi

sep
print_status
