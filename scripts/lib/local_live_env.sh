#!/bin/bash
# Shared env for local FastAPI + NTRIP collector (SQLite live VTEC).
local_live_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd
}

local_live_load_env() {
  set -a
  # shellcheck disable=SC1091
  source backend/.env 2>/dev/null || true
  set +a

  unset TSDB_DSN DATABASE_URL DATABASE_URL_UNPOOLED POSTGRES_URL POSTGRES_URL_NON_POOLING SUPABASE_DATABASE_URL
  unset ZGIIS_LOAD_VERCEL_ENV ZGIIS_DISABLE_API_INGEST

  export ZGIIS_FORCE_SQLITE=1
  export ZGIIS_EXTERNAL_COLLECTOR=1
  export ZGIIS_BACKGROUND_SERVICES=1
  export NTRIP_LIVE_MAX_CONCURRENT="${NTRIP_LIVE_MAX_CONCURRENT:-12}"
  export NTRIP_LIVE_SESSION_S="${NTRIP_LIVE_SESSION_S:-480}"
  export ZGIIS_DB_FLUSH_N="${ZGIIS_DB_FLUSH_N:-40}"
  export NTRIP_LIVE_PRIORITY_STATIONS="${NTRIP_LIVE_PRIORITY_STATIONS:-kwek,lupa,hara,zinh,beit,tsho,cent,gokw,muta,masv}"
  export STATUS_SNAPSHOT_PUSH_URL=""
  export ZGIIS_SKIP_DB_SCHEMA_INIT=1
}
