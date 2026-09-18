"""Durable Spider Site Status store (Postgres/SQLite).

Vercel cold starts lose /tmp and in-memory caches. The last successful Spider
``by_station`` payload is upserted here so every instance can serve real
Spider online/offline instead of the CORS catalog's false 9/25.
"""
from __future__ import annotations

import json
import logging
import sqlite3
import tempfile
import time
from pathlib import Path
from typing import Any

from zgiis.db.config import database_backend_label, database_dsn

log = logging.getLogger(__name__)

_DSN = database_dsn()
_SQLITE_PATH = Path(__file__).resolve().parents[2] / "static" / "data" / "spider_site_status_cache.sqlite"

_PG_DDL = """
CREATE TABLE IF NOT EXISTS spider_site_status_cache (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    fetched_at    TEXT,
    disk_saved_at DOUBLE PRECISION NOT NULL,
    by_station    JSONB NOT NULL,
    error         TEXT
);
"""

_SQLITE_DDL = """
CREATE TABLE IF NOT EXISTS spider_site_status_cache (
    id            INTEGER PRIMARY KEY CHECK (id = 1),
    fetched_at    TEXT,
    disk_saved_at REAL NOT NULL,
    by_station    TEXT NOT NULL,
    error         TEXT
);
"""

_conn = None
_is_pg = False
_init_attempted = False


def _connect() -> None:
    global _conn, _is_pg, _init_attempted
    if _init_attempted and _conn is not None:
        return
    _init_attempted = True
    dsn = database_dsn()
    if dsn:
        try:
            import psycopg2

            _conn = psycopg2.connect(dsn)
            _is_pg = True
            with _conn.cursor() as cur:
                cur.execute(_PG_DDL)
            _conn.commit()
            log.info("Spider status store ready (%s)", database_backend_label(dsn))
            return
        except Exception as exc:
            log.warning("Spider status Postgres store unavailable: %s", exc)
            _conn = None
            _is_pg = False

    try:
        _SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
        path = _SQLITE_PATH
        _conn = sqlite3.connect(str(path), check_same_thread=False)
    except (OSError, sqlite3.OperationalError):
        path = Path(tempfile.gettempdir()) / "spider_site_status_cache.sqlite"
        _conn = sqlite3.connect(str(path), check_same_thread=False)
    _conn.executescript(_SQLITE_DDL)
    _conn.commit()
    _is_pg = False
    log.info("Spider status store ready (SQLite:%s)", path)


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

        if _is_pg:
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
        else:
            sql = """
            INSERT INTO spider_site_status_cache (id, fetched_at, disk_saved_at, by_station, error)
            VALUES (1, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                fetched_at = excluded.fetched_at,
                disk_saved_at = excluded.disk_saved_at,
                by_station = excluded.by_station,
                error = excluded.error
            """
            _conn.execute(sql, (fetched_at, saved_at, body, error))
            _conn.commit()
        return True
    except Exception as exc:
        log.warning("Failed to persist Spider status: %s", exc)
        try:
            if _conn is not None and _is_pg:
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
        if _is_pg:
            with _conn.cursor() as cur:
                cur.execute(
                    "SELECT fetched_at, disk_saved_at, by_station, error "
                    "FROM spider_site_status_cache WHERE id = 1"
                )
                row = cur.fetchone()
        else:
            row = _conn.execute(
                "SELECT fetched_at, disk_saved_at, by_station, error "
                "FROM spider_site_status_cache WHERE id = 1"
            ).fetchone()
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
            if _conn is not None and _is_pg:
                _conn.rollback()
        except Exception:
            pass
        return None
