#!/bin/bash
# Start NTRIP collector if it is not already running.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source scripts/lib/local_live_env.sh
local_live_load_env

LOG="${ZGIIS_COLLECTOR_LOG:-/tmp/kwek_collector.log}"
LOCK="$ROOT/static/data/.live_ntrip_collector.lock"

collector_running() {
  if pgrep -f 'live_ntrip_collector.py' >/dev/null 2>&1; then
    return 0
  fi
  if [[ -f "$LOCK" ]]; then
    local owner
    owner="$(tr -d '[:space:]' <"$LOCK" 2>/dev/null || true)"
    if [[ -n "$owner" ]] && kill -0 "$owner" 2>/dev/null; then
      return 0
    fi
  fi
  return 1
}

if collector_running; then
  echo "Collector already running"
  exit 0
fi

nohup .venv/bin/python -u scripts/live_ntrip_collector.py >>"$LOG" 2>&1 &
echo "Collector pid=$! log=$LOG"
