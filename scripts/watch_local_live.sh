#!/bin/bash
# Keep local API + NTRIP collector alive. Run in background or via launchd.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

INTERVAL="${ZGIIS_WATCH_INTERVAL_S:-30}"
LOG="${ZGIIS_WATCHDOG_LOG:-/tmp/zgiis_watchdog.log}"

log() {
  printf '%s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >>"$LOG"
}

api_healthy() {
  curl -sf -m 8 http://127.0.0.1:8000/health >/dev/null 2>&1
}

collector_running() {
  pgrep -f 'live_ntrip_collector.py' >/dev/null 2>&1
}

log "watchdog started interval=${INTERVAL}s root=$ROOT"

while true; do
  if ! api_healthy; then
    log "API unhealthy — starting"
    if ! "$ROOT/scripts/start_api_kwek.sh" >>"$LOG" 2>&1; then
      log "API start failed"
    fi
  fi

  if ! collector_running; then
    log "collector down — starting"
    if ! "$ROOT/scripts/start_collector_kwek.sh" >>"$LOG" 2>&1; then
      log "collector start failed"
    fi
  fi

  sleep "$INTERVAL"
done
