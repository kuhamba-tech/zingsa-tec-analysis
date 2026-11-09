"""Persistence for ZINGSA Space Weather Early Warning events."""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd

from zgiis.db.config import DatabaseUnavailable, checkout, database_dsn, release, schema_init_enabled

log = logging.getLogger(__name__)

_PG_DDL = """
CREATE TABLE IF NOT EXISTS early_warning_alert_log (
    alert_id            TEXT PRIMARY KEY,
    time                TIMESTAMPTZ NOT NULL,
    rule_id             TEXT NOT NULL,
    authority           TEXT NOT NULL,
    category            TEXT NOT NULL,
    severity            TEXT NOT NULL,
    status              TEXT NOT NULL,
    title               TEXT,
    message             TEXT,
    observed_value      DOUBLE PRECISION,
    threshold           DOUBLE PRECISION,
    unit                TEXT,
    duration_minutes    DOUBLE PRECISION,
    observation_time    TIMESTAMPTZ,
    data_age_minutes    DOUBLE PRECISION,
    source              TEXT,
    first_detected      TIMESTAMPTZ,
    last_updated        TIMESTAMPTZ,
    resolved_at         TIMESTAMPTZ,
    related_json        TEXT,
    acknowledged_status BOOLEAN DEFAULT FALSE
);
"""
_PG_IDX = [
    "CREATE INDEX IF NOT EXISTS early_warning_time_idx ON early_warning_alert_log (time DESC);",
    "CREATE INDEX IF NOT EXISTS early_warning_rule_idx ON early_warning_alert_log (rule_id, last_updated DESC);",
    "CREATE INDEX IF NOT EXISTS early_warning_status_idx ON early_warning_alert_log (status, time DESC);",
]


def _clean(value: Any) -> Any:
    if value is None:
        return None
    try:
        if value != value:  # NaN
            return None
    except Exception:
        pass
    if isinstance(value, float) and pd.isna(value):
        return None
    return value


def _row_to_alert(row: dict[str, Any]) -> dict[str, Any]:
    related = row.get("related_json")
    try:
        related = json.loads(related) if isinstance(related, str) else (related or {})
    except (TypeError, ValueError):
        related = {}
    if related is None or (isinstance(related, float) and pd.isna(related)):
        related = {}

    def _ts(value: Any) -> str | None:
        value = _clean(value)
        if value is None:
            return None
        return str(value)

    return {
        "alert_id": str(row.get("alert_id")),
        "rule_id": str(row.get("rule_id")),
        "authority": str(row.get("authority")),
        "category": str(row.get("category")),
        "severity": str(row.get("severity")),
        "status": str(row.get("status")),
        "title": str(row.get("title") or ""),
        "message": str(row.get("message") or ""),
        "observed_value": _clean(row.get("observed_value")),
        "threshold": _clean(row.get("threshold")),
        "unit": _clean(row.get("unit")),
        "duration_minutes": _clean(row.get("duration_minutes")),
        "observation_time": _ts(row.get("observation_time")),
        "data_age_minutes": _clean(row.get("data_age_minutes")),
        "source": str(_clean(row.get("source")) or ""),
        "first_detected": _ts(row.get("first_detected") or row.get("time")) or "",
        "last_updated": _ts(row.get("last_updated") or row.get("time")) or "",
        "resolved_at": _ts(row.get("resolved_at")),
        "related": related if isinstance(related, dict) else {},
        "acknowledged_status": bool(row.get("acknowledged_status")),
    }


class EarlyWarningDB:
    def __init__(self, dsn: str | None = None):
        self._dsn = database_dsn() if dsn is None else dsn
        self._conn = None
        if not self._dsn:
            raise DatabaseUnavailable("SUPABASE_DATABASE_URL is not configured")
        self._init_pg()

    def _init_pg(self) -> None:
        try:
            self._conn = checkout(self._dsn)
            # Always ensure this feature table exists. IF NOT EXISTS is safe when
            # the shared schema-init flag is off for long-running collectors.
            with self._conn.cursor() as cur:
                cur.execute(_PG_DDL)
                for stmt in _PG_IDX:
                    cur.execute(stmt)
            self._conn.commit()
            if not schema_init_enabled():
                log.debug("early_warning_alert_log ensured without global schema init")
        except Exception as exc:
            log.error("EarlyWarningDB init failed: %s", exc)
            raise DatabaseUnavailable("Supabase Postgres init failed") from exc

    def close(self) -> None:
        if self._conn is not None:
            release(self._conn)
            self._conn = None

    def latest_for_rule(self, rule_id: str) -> dict[str, Any] | None:
        sql = """
        SELECT * FROM early_warning_alert_log
        WHERE rule_id = %s
        ORDER BY last_updated DESC NULLS LAST, time DESC
        LIMIT 1
        """
        df = pd.read_sql(sql, self._conn, params=[rule_id])
        if df.empty:
            return None
        return _row_to_alert(df.iloc[0].to_dict())

    def insert_alert(self, alert: dict[str, Any]) -> None:
        sql = """
        INSERT INTO early_warning_alert_log (
            alert_id, time, rule_id, authority, category, severity, status,
            title, message, observed_value, threshold, unit, duration_minutes,
            observation_time, data_age_minutes, source, first_detected,
            last_updated, resolved_at, related_json, acknowledged_status
        ) VALUES (
            %s,%s,%s,%s,%s,%s,%s,
            %s,%s,%s,%s,%s,%s,
            %s,%s,%s,%s,
            %s,%s,%s,%s
        )
        ON CONFLICT (alert_id) DO NOTHING
        """
        related = alert.get("related") or {}
        with self._conn.cursor() as cur:
            cur.execute(
                sql,
                [
                    alert.get("alert_id"),
                    alert.get("first_detected") or alert.get("last_updated"),
                    alert.get("rule_id"),
                    alert.get("authority"),
                    alert.get("category"),
                    alert.get("severity"),
                    alert.get("status"),
                    alert.get("title"),
                    alert.get("message"),
                    alert.get("observed_value"),
                    alert.get("threshold"),
                    alert.get("unit"),
                    alert.get("duration_minutes"),
                    alert.get("observation_time"),
                    alert.get("data_age_minutes"),
                    alert.get("source"),
                    alert.get("first_detected"),
                    alert.get("last_updated"),
                    alert.get("resolved_at"),
                    json.dumps(related),
                    bool(alert.get("acknowledged_status")),
                ],
            )
        self._conn.commit()

    def touch_active(self, rule_id: str, *, last_updated: str, observed_value: float | None = None) -> None:
        sql = """
        UPDATE early_warning_alert_log
        SET last_updated = %s,
            observed_value = COALESCE(%s, observed_value)
        WHERE alert_id = (
            SELECT alert_id FROM early_warning_alert_log
            WHERE rule_id = %s AND status IN ('active', 'watch')
            ORDER BY last_updated DESC NULLS LAST
            LIMIT 1
        )
        """
        with self._conn.cursor() as cur:
            cur.execute(sql, [last_updated, observed_value, rule_id])
        self._conn.commit()

    def resolve_missing(self, active_rule_ids: set[str], *, resolved_at: str) -> int:
        sql = """
        UPDATE early_warning_alert_log
        SET status = 'resolved', resolved_at = %s, last_updated = %s
        WHERE status IN ('active', 'watch')
          AND NOT (rule_id = ANY(%s))
        """
        with self._conn.cursor() as cur:
            cur.execute(sql, [resolved_at, resolved_at, list(active_rule_ids)])
            count = cur.rowcount
        self._conn.commit()
        return int(count or 0)

    def list_alerts(self, *, hours: float = 168.0, status: str | None = None) -> list[dict[str, Any]]:
        since = datetime.now(timezone.utc) - timedelta(hours=hours)
        if status:
            sql = """
            SELECT * FROM early_warning_alert_log
            WHERE time >= %s AND status = %s
            ORDER BY time DESC
            """
            df = pd.read_sql(sql, self._conn, params=[since.isoformat(), status])
        else:
            sql = """
            SELECT * FROM early_warning_alert_log
            WHERE time >= %s
            ORDER BY time DESC
            """
            df = pd.read_sql(sql, self._conn, params=[since.isoformat()])
        return [_row_to_alert(row) for row in df.to_dict(orient="records")]

    def active_alerts(self) -> list[dict[str, Any]]:
        sql = """
        SELECT * FROM early_warning_alert_log
        WHERE status IN ('active', 'watch')
        ORDER BY last_updated DESC NULLS LAST
        """
        df = pd.read_sql(sql, self._conn)
        return [_row_to_alert(row) for row in df.to_dict(orient="records")]
