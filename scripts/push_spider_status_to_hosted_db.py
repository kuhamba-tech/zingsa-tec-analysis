#!/usr/bin/env python3
"""Fetch Spider Site Status locally and upsert into the hosted DB Vercel reads.

Vercel IPs are often blocked (HTTP 403) by the ZINGSA SBC reverse proxy.
The persistent collector (or this one-shot) must write the last-good Spider
payload to Supabase Postgres so serverless map requests can use a durable fallback.
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.env_bootstrap import load_runtime_env


def main() -> int:
    load_runtime_env()

    from zgiis.live.spider_site_status import fetch_spider_site_statuses
    from zgiis.live.spider_status_store import save_spider_status_payload

    payload = fetch_spider_site_statuses(timeout=25)
    by = payload.get("by_station") or {}
    if not by:
        print(f"Spider fetch failed: {payload.get('error')}", file=sys.stderr)
        return 1

    ok = save_spider_status_payload(
        {
            "fetched_at": payload.get("fetched_at"),
            "by_station": by,
            "disk_saved_at": time.time(),
            "error": None,
        }
    )
    online = sum(1 for row in by.values() if row.get("status") == "online")
    from zgiis.db.config import configured_database_env_key

    print(f"Saved {len(by)} stations ({online} online) via {configured_database_env_key()} ok={ok}")
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
