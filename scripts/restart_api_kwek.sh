#!/bin/bash
# Restart local API with SQLite ingest (does not stop the NTRIP collector).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

lsof -tiTCP:8000 -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true
pkill -9 -f 'uvicorn backend.main' 2>/dev/null || true
sleep 2

exec "$ROOT/scripts/start_api_kwek.sh"
