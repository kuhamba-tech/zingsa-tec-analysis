#!/bin/bash
# Restart NTRIP collector (API is left running).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

pkill -9 -f 'live_ntrip_collector.py' 2>/dev/null || true
sleep 2

exec "$ROOT/scripts/start_collector_kwek.sh"
