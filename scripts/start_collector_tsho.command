#!/bin/bash
cd "/Users/timothykuhamba/Documents/TRL SPACE /Travels/Space science/National Space Weather" || exit 1
pkill -f 'scripts/live_ntrip_collector.py' 2>/dev/null || true
sleep 2
export NTRIP_LIVE_MAX_CONCURRENT=12
export NTRIP_LIVE_SESSION_S=300
export ZGIIS_DB_FLUSH_N=50
export NTRIP_LIVE_PRIORITY_STATIONS=lupa,hara,zinh,beit,kwek,tsho,masv,muta
exec .venv/bin/python -u scripts/live_ntrip_collector.py
