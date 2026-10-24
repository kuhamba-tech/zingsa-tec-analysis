"""Durable Spider Site Status store on Supabase Postgres.

Vercel cold starts lose /tmp and in-memory caches. The last successful Spider
``by_station`` payload is upserted here so every instance can serve real
Spider online/offline instead of the CORS catalog's false 9/25.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

from zgiis.db.config import checkout, database_backend_label, database_dsn, release, schema_init_enabled

log = logging.getLogger(__name__)

_PG_DDL = """
CREATE TABLE IF NOT EXISTS spider_site_status_cache (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    fetched_at    TEXT,
    disk_saved_at DOUBLE PRECISION NOT NULL,
    by_station    JSONB NOT NULL,
    error         TEXT
);
"""

_conn = None


def _connect() -> None:
    global _conn
    if _conn is not None and not getattr(_conn, "closed", 1):
        return
    if _conn is not None:
        release(_conn, close=True)
        _conn = None
    dsn = database_dsn()
    if not dsn:
        log.error("SUPABASE_DATABASE_URL is not configured")
        _conn = None
        return
    try:
        _conn = checkout(dsn)
        if schema_init_enabled():
            with _conn.cursor() as cur:
                cur.execute(_PG_DDL)
        log.info("Spider status store ready (%s)", database_backend_label(dsn))
    except Exception as exc:
        log.error("Spider status Postgres store unavailable: %s", exc)
        if _conn is not None:
            release(_conn, close=True)
        _conn = None


def save_spider_status_payload(payload: dict[str, Any]) -> bool:
    """Upsert the latest successful Spider by_station map."""
    by_station = payload.get("by_station") or {}
    if not isinstance(by_station, dict) or not by_station:
        return False
    try:
        _connect()
        if _conn is None:
            return False
        saved_at = float(payload.get("disk_saved_at") or time.time())
        fetched_at = payload.get("fetched_at")
        error = payload.get("error")
        body = json.dumps(by_station, separators=(",", ":"))
        sql = """
        INSERT INTO spider_site_status_cache (id, fetched_at, disk_saved_at, by_station, error)
        VALUES (1, %s, %s, %s::jsonb, %s)
        ON CONFLICT (id) DO UPDATE SET
            fetched_at = EXCLUDED.fetched_at,
            disk_saved_at = EXCLUDED.disk_saved_at,
            by_station = EXCLUDED.by_station,
            error = EXCLUDED.error
        """
        with _conn.cursor() as cur:
            cur.execute(sql, (fetched_at, saved_at, body, error))
        _conn.commit()
        return True
    except Exception as exc:
        log.warning("Failed to persist Spider status: %s", exc)
        try:
            if _conn is not None:
                _conn.rollback()
        except Exception:
            pass
        return False


def load_spider_status_payload(*, max_age_sec: float) -> dict[str, Any] | None:
    """Load last-good Spider payload if younger than ``max_age_sec``."""
    try:
        _connect()
        if _conn is None:
            return None
        with _conn.cursor() as cur:
            cur.execute(
                "SELECT fetched_at, disk_saved_at, by_station, error "
                "FROM spider_site_status_cache WHERE id = 1"
            )
            row = cur.fetchone()
        if not row:
            return None
        fetched_at, saved_at, by_station_raw, error = row
        saved_at_f = float(saved_at or 0)
        if saved_at_f and (time.time() - saved_at_f) > max_age_sec:
            return None
        if isinstance(by_station_raw, dict):
            by_station = by_station_raw
        else:
            by_station = json.loads(by_station_raw or "{}")
        if not isinstance(by_station, dict) or not by_station:
            return None
        return {
            "fetched_at": fetched_at,
            "by_station": by_station,
            "error": error,
            "disk_saved_at": saved_at_f,
            "from_durable_store": True,
        }
    except Exception as exc:
        log.warning("Failed to load durable Spider status: %s", exc)
        try:
            if _conn is not None:
                _conn.rollback()
        except Exception:
            pass
        return None
