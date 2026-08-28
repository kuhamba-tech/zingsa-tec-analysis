#!/bin/bash
# Restart live NTRIP collector with Tsholotsho prioritized into concurrent slots.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
pkill -f 'scripts/live_ntrip_collector.py' 2>/dev/null || true
sleep 2
export NTRIP_LIVE_MAX_CONCURRENT="${NTRIP_LIVE_MAX_CONCURRENT:-12}"
export NTRIP_LIVE_SESSION_S="${NTRIP_LIVE_SESSION_S:-300}"
export ZGIIS_DB_FLUSH_N="${ZGIIS_DB_FLUSH_N:-50}"
export NTRIP_LIVE_PRIORITY_STATIONS="${NTRIP_LIVE_PRIORITY_STATIONS:-kwek,lupa,hara,zinh,beit,tsho,cent,gokw,muta,masv}"

exec .venv/bin/python -u scripts/live_ntrip_collector.py
