"""Record of automatic ZESA power-grid threshold alerts.

One open row means that trigger set has already been sent. A new Slack
message is issued only when the crossed parameters change or clear.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from zgiis.db.config import DatabaseUnavailable, checkout, database_dsn, release

log = logging.getLogger(__name__)

_DDL = """
CREATE TABLE IF NOT EXISTS power_grid_alert_log (
    alert_id     TEXT PRIMARY KEY,
    issued_at    TIMESTAMPTZ NOT NULL,
    level        TEXT NOT NULL,
    signature    TEXT NOT NULL,
    status       TEXT NOT NULL,
    triggers_json TEXT NOT NULL
);
"""


class PowerGridAlertDB:
    def __init__(self, dsn: str | None = None):
        self._dsn = database_dsn() if dsn is None else dsn
        self._conn = None
        if not self._dsn:
            raise DatabaseUnavailable("SUPABASE_DATABASE_URL is not configured")
        try:
            self._conn = checkout(self._dsn)
            with self._conn.cursor() as cur:
                cur.execute(_DDL)
            self._conn.commit()
        except Exception as exc:
            log.error("Power-grid alert log init failed: %s", exc)
            raise DatabaseUnavailable("Supabase Postgres init failed") from exc

    def close(self) -> None:
        if self._conn is not None:
            release(self._conn)
            self._conn = None

    def latest_open(self) -> dict[str, Any] | None:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT alert_id, level, signature, status
                FROM power_grid_alert_log
                WHERE status = 'open'
                ORDER BY issued_at DESC
                LIMIT 1
                """
            )
            row = cur.fetchone()
        if not row:
            return None
        return {"alert_id": row[0], "level": row[1], "signature": row[2], "status": row[3]}

    def count_for_day(self, day_key: str) -> int:
        with self._conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) FROM power_grid_alert_log WHERE alert_id LIKE %s",
                [f"ZINGSA-GIC-{day_key}-%"],
            )
            row = cur.fetchone()
        return int(row[0] if row else 0)

    def resolve_open(self) -> None:
        with self._conn.cursor() as cur:
            cur.execute("UPDATE power_grid_alert_log SET status = 'resolved' WHERE status = 'open'")
        self._conn.commit()

    def insert_open(self, *, alert_id: str, issued_at: str, level: str, signature: str, triggers: list[str]) -> None:
        self.resolve_open()
        with self._conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO power_grid_alert_log
                    (alert_id, issued_at, level, signature, status, triggers_json)
                VALUES (%s, %s, %s, %s, 'open', %s)
                """,
                [alert_id, issued_at, level, signature, json.dumps(triggers)],
            )
        self._conn.commit()
