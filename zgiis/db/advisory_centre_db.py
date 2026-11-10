"""Archive for ZINGSA Space Weather Advisory Centre issuances."""
from __future__ import annotations

import json
import logging
from typing import Any

from zgiis.db.config import database_dsn

log = logging.getLogger(__name__)

DDL = """
CREATE TABLE IF NOT EXISTS space_weather_advisory_log (
    advisory_id     TEXT PRIMARY KEY,
    issued_utc      TIMESTAMPTZ NOT NULL,
    level           TEXT NOT NULL,
    state           TEXT NOT NULL DEFAULT 'draft',
    payload         JSONB NOT NULL,
    approved_by     TEXT,
    approved_at     TIMESTAMPTZ,
    published_at    TIMESTAMPTZ,
    withdrawn_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS space_weather_advisory_issued_idx
    ON space_weather_advisory_log (issued_utc DESC);
CREATE INDEX IF NOT EXISTS space_weather_advisory_level_idx
    ON space_weather_advisory_log (level, issued_utc DESC);
CREATE INDEX IF NOT EXISTS space_weather_advisory_state_idx
    ON space_weather_advisory_log (state, issued_utc DESC);
"""


class AdvisoryCentreDB:
    def __init__(self) -> None:
        self._ready = False
        try:
            import psycopg2

            dsn = database_dsn()
            if not dsn:
                return
            conn = psycopg2.connect(dsn, connect_timeout=5)
            conn.autocommit = True
            with conn.cursor() as cur:
                for stmt in DDL.strip().split(";"):
                    text = stmt.strip()
                    if text:
                        cur.execute(text)
            conn.close()
            self._ready = True
        except Exception as exc:
            log.error("AdvisoryCentreDB init failed: %s", exc)

    @property
    def ready(self) -> bool:
        return self._ready

    def _conn(self):
        import psycopg2
        from psycopg2.extras import RealDictCursor

        dsn = database_dsn()
        if not dsn:
            raise RuntimeError("database unavailable")
        conn = psycopg2.connect(dsn, connect_timeout=5)
        conn.autocommit = True
        return conn, RealDictCursor

    def save_draft(self, assessment: dict[str, Any]) -> None:
        conn, _ = self._conn()
        try:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO space_weather_advisory_log (advisory_id, issued_utc, level, state, payload)
                    VALUES (%s, %s, %s, 'draft', %s::jsonb)
                    ON CONFLICT (advisory_id) DO UPDATE SET
                        payload = EXCLUDED.payload,
                        level = EXCLUDED.level
                    """,
                    (
                        assessment["advisory_id"],
                        assessment["issued_utc"],
                        assessment["advisory_level"],
                        json.dumps(assessment),
                    ),
                )
        finally:
            conn.close()

    def set_state(
        self,
        advisory_id: str,
        state: str,
        *,
        approved_by: str | None = None,
    ) -> dict[str, Any] | None:
        conn, cursor_factory = self._conn()
        try:
            with conn.cursor(cursor_factory=cursor_factory) as cur:
                if state == "approved":
                    cur.execute(
                        """
                        UPDATE space_weather_advisory_log
                        SET state = 'approved', approved_by = %s, approved_at = NOW()
                        WHERE advisory_id = %s AND state IN ('draft', 'approved')
                        RETURNING *
                        """,
                        (approved_by, advisory_id),
                    )
                elif state == "published":
                    cur.execute(
                        """
                        UPDATE space_weather_advisory_log
                        SET state = 'published', published_at = NOW()
                        WHERE advisory_id = %s AND state = 'approved'
                        RETURNING *
                        """,
                        (advisory_id,),
                    )
                elif state == "withdrawn":
                    cur.execute(
                        """
                        UPDATE space_weather_advisory_log
                        SET state = 'withdrawn', withdrawn_at = NOW()
                        WHERE advisory_id = %s AND state IN ('draft', 'approved', 'published')
                        RETURNING *
                        """,
                        (advisory_id,),
                    )
                else:
                    return None
                row = cur.fetchone()
                return dict(row) if row else None
        finally:
            conn.close()

    def latest_published(self) -> dict[str, Any] | None:
        conn, cursor_factory = self._conn()
        try:
            with conn.cursor(cursor_factory=cursor_factory) as cur:
                cur.execute(
                    """
                    SELECT * FROM space_weather_advisory_log
                    WHERE state = 'published'
                    ORDER BY published_at DESC NULLS LAST, issued_utc DESC
                    LIMIT 1
                    """
                )
                row = cur.fetchone()
                return dict(row) if row else None
        finally:
            conn.close()

    def history(self, *, limit: int = 50, level: str | None = None) -> list[dict[str, Any]]:
        conn, cursor_factory = self._conn()
        try:
            with conn.cursor(cursor_factory=cursor_factory) as cur:
                if level:
                    cur.execute(
                        """
                        SELECT advisory_id, issued_utc, level, state, approved_by, approved_at, published_at, payload
                        FROM space_weather_advisory_log
                        WHERE level = %s
                        ORDER BY issued_utc DESC
                        LIMIT %s
                        """,
                        (level, limit),
                    )
                else:
                    cur.execute(
                        """
                        SELECT advisory_id, issued_utc, level, state, approved_by, approved_at, published_at, payload
                        FROM space_weather_advisory_log
                        ORDER BY issued_utc DESC
                        LIMIT %s
                        """,
                        (limit,),
                    )
                return [dict(row) for row in cur.fetchall()]
        finally:
            conn.close()
