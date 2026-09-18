#!/bin/bash
# Start local FastAPI if it is not already healthy on :8000.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source scripts/lib/local_live_env.sh
local_live_load_env

LOG="${ZGIIS_API_LOG:-/tmp/zgiis_api_kwek.log}"

api_healthy() {
  curl -sf -m 5 http://127.0.0.1:8000/health >/dev/null 2>&1
}

if api_healthy; then
  echo "API already healthy on :8000"
  exit 0
fi

if lsof -tiTCP:8000 -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Port 8000 hung — restarting API"
  lsof -tiTCP:8000 -sTCP:LISTEN | xargs kill -9 2>/dev/null || true
  sleep 2
fi

nohup .venv/bin/uvicorn backend.main:app --host 127.0.0.1 --port 8000 >>"$LOG" 2>&1 &
echo "API pid=$! log=$LOG"
