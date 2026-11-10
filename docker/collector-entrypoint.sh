#!/bin/sh
# Start the TEC collector as the unprivileged zgiis user.
# When SUPABASE_DOCKER_DB_HOST is set, the database host in
# SUPABASE_DATABASE_URL is replaced with that Docker service name.
set -eu

mkdir -p /app/static/data
chown -R zgiis:zgiis /app/static/data

if [ -n "${SUPABASE_DOCKER_DB_HOST:-}" ]; then
  SUPABASE_DATABASE_URL="$(python /app/scripts/collector_db_host.py)"
  export SUPABASE_DATABASE_URL
fi

exec runuser -u zgiis -- python /app/scripts/live_ntrip_collector.py
