#!/bin/bash
# Block Barrage localnet: one chain (id 2, its own root), 500ms blocks, the barrage plugin. Uses this project's own
# core build (chain/setup.sh) and keeps everything, plugin socket included, under chain/data.
# Usage: chain/localnet.sh {init|start|stop|status|logs [n]|reset}
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP="$(cd "$HERE/.." && pwd)"
DATA="${BARRAGE_DATA:-$HERE/data}"
BIN="$HERE/bin/canopy"
SRC="$HERE/canopy"
KEY="$HERE/.arcade-key.json"
PW_FILE="$HERE/.localnet-password"
LOG="$DATA/node.log"
export CANOPY_PLUGIN_SOCKET_DIR="$DATA/plugin"

arcade() { python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['address'])" "$KEY"; }
node_pids() { pgrep -f "$BIN --data-dir $DATA" || true; }

ensure() {
    [ -x "$BIN" ] || { echo "no core at $BIN: run chain/setup.sh first"; exit 1; }
    [ -f "$APP/plugin/dist/main.js" ] || (cd "$APP/plugin" && npm ci && npm run build:all)
    # localnet-only throwaway keystore password, never committed
    [ -f "$PW_FILE" ] || { openssl rand -hex 16 > "$PW_FILE"; chmod 600 "$PW_FILE"; }
    mkdir -p "$DATA" "$CANOPY_PLUGIN_SOCKET_DIR"
}

run_node() {
    # canopy resolves plugin/<name>/pluginctl.sh relative to cwd, so run from the core checkout
    (cd "$SRC" && CANOPY_DATA_DIR="$DATA" BARRAGE_CHAIN_ID=2 BARRAGE_PLUGIN_RPC=127.0.0.1:31010 \
        BARRAGE_ARCADE_AUTHORITY="$(arcade)" nohup "$BIN" --data-dir "$DATA" --password "$(cat "$PW_FILE")" \
        --nickname barrage start >> "$LOG" 2>&1 < /dev/null &)
}

stop_node() {
    local pids; pids="$(node_pids)"
    if [ -n "$pids" ]; then
        kill $pids 2>/dev/null || true
        for _ in $(seq 1 30); do [ -z "$(node_pids)" ] && break; sleep 0.5; done
        pids="$(node_pids)"; [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
    fi
    (cd "$APP/plugin" && ./pluginctl.sh stop >/dev/null 2>&1) || true
}

case "${1:-}" in
    init)
        [ -f "$DATA/genesis.json" ] && { echo "already initialised ($DATA); reset first"; exit 1; }
        ensure
        (cd "$APP" && node server/keygen.js "$KEY" >/dev/null)
        # first boot writes config, keystore and genesis; stop once the keystore exists
        run_node
        for _ in $(seq 1 60); do grep -q "keystore" "$LOG" 2>/dev/null && [ -f "$DATA/genesis.json" ] && break; sleep 1; done
        sleep 3; stop_node
        python3 "$HERE/make-chain.py" "$DATA" "$(arcade)"
        # the first boot already built state from the default genesis: start from the edited one
        rm -rf "$DATA/canopy" "$DATA/logs" "$LOG"
        ;;
    start)
        ensure; run_node
        for _ in $(seq 1 60); do curl -sf -X POST http://127.0.0.1:31002/v1/query/height -d '{}' >/dev/null && break; sleep 1; done
        echo "chain 2: http://127.0.0.1:31002 · plugin RPC: http://127.0.0.1:31010 · log: $LOG"
        ;;
    stop) stop_node; echo stopped ;;
    status) p="$(node_pids)"; [ -n "$p" ] && echo "running pid $p" || echo "not running" ;;
    logs) sed 's/\x1b\[[0-9;]*m//g' "$LOG" | tail -n "${2:-40}" ;;
    reset) stop_node; rm -rf "$DATA" ;;
    *) echo "usage: $0 {init|start|stop|status|logs [n]|reset}"; exit 1 ;;
esac
