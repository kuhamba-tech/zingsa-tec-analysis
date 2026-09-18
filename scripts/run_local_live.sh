#!/bin/bash
# One-shot: start API, collector, and background watchdog (no launchd required).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

chmod +x "$ROOT/scripts/start_api_kwek.sh" \
  "$ROOT/scripts/start_collector_kwek.sh" \
  "$ROOT/scripts/watch_local_live.sh"

"$ROOT/scripts/start_api_kwek.sh"
"$ROOT/scripts/start_collector_kwek.sh"

if pgrep -f 'watch_local_live.sh' >/dev/null 2>&1; then
  echo "Watchdog already running"
else
  nohup "$ROOT/scripts/watch_local_live.sh" >>/tmp/zgiis_watchdog.log 2>&1 &
  echo "Watchdog pid=$!"
fi

echo "Local live VTEC stack started. Logs: /tmp/zgiis_api_kwek.log /tmp/kwek_collector.log /tmp/zgiis_watchdog.log"
