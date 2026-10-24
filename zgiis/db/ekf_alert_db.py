"""
Event log for Extended Kalman Filter deviation alerts.

Stored in Supabase Postgres.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import pandas as pd

from zgiis.db.config import DatabaseUnavailable, checkout, database_dsn, release, schema_init_enabled

log = logging.getLogger(__name__)

# Don't write a duplicate alert row for the same parameter while the
# deviation condition is still active — only log a fresh entry once this
# many minutes have passed since the last one for that parameter.
DEDUPE_MINUTES = 5

_PG_DDL = """
CREATE TABLE IF NOT EXISTS ekf_alert_log (
    alert_id            TEXT PRIMARY KEY,
    time                TIMESTAMPTZ NOT NULL,
    parameter           TEXT,
    parameter_label     TEXT,
    observed_value      DOUBLE PRECISION,
    ekf_predicted_value DOUBLE PRECISION,
    prediction_error    DOUBLE PRECISION,
    threshold           DOUBLE PRECISION,
    severity            TEXT,
    related_indicators  TEXT,
    alert_message       TEXT,
    acknowledged_status BOOLEAN DEFAULT FALSE
);
"""
_PG_IDX = "CREATE INDEX IF NOT EXISTS ekf_alert_time_idx ON ekf_alert_log (time DESC);"


def _row_to_alert(row: dict[str, Any]) -> dict[str, Any]:
    related = row.get("related_indicators")
    try:
        related = json.loads(related) if isinstance(related, str) else (related or [])
    except (TypeError, ValueError):
        related = []
    # Pandas reads TIMESTAMPTZ back as a Timestamp. Normalize so
    # EkfAlertOut.timestamp stays a string.
    time_value = row.get("time")
    return {
        "alert_id": row.get("alert_id"),
        "timestamp": str(time_value) if time_value is not None else None,
        "parameter": row.get("parameter"),
        "parameter_label": row.get("parameter_label"),
        "observed_value": row.get("observed_value"),
        "ekf_predicted_value": row.get("ekf_predicted_value"),
        "prediction_error": row.get("prediction_error"),
        "threshold": row.get("threshold"),
        "severity": row.get("severity"),
        "related_indicators": related,
        "alert_message": row.get("alert_message"),
        "acknowledged_status": bool(row.get("acknowledged_status")),
    }


class EkfAlertDB:
    def __init__(self, dsn: str | None = None):
        self._dsn = database_dsn() if dsn is None else dsn
        self._is_pg = False
        self._conn = None
        if not self._dsn:
            log.error("SUPABASE_DATABASE_URL is not configured")
            raise DatabaseUnavailable("SUPABASE_DATABASE_URL is not configured")
        self._init_pg()

    def _init_pg(self) -> None:
        try:
            self._conn = checkout(self._dsn)
            self._is_pg = True
            if schema_init_enabled():
                with self._conn.cursor() as cur:
                    cur.execute(_PG_DDL)
                    cur.execute(_PG_IDX)
        except Exception as exc:
            log.error("EkfAlertDB Postgres init failed: %s", exc)
            raise DatabaseUnavailable("Supabase Postgres init failed") from exc

    def _latest_for_parameter(self, parameter: str, *, since_iso: str) -> Optional[dict[str, Any]]:
        sql = """
        SELECT * FROM ekf_alert_log
        WHERE parameter = ? AND time >= ?
        ORDER BY time DESC LIMIT 1
        """
        if self._is_pg:
            df = pd.read_sql(sql.replace("?", "%s"), self._conn, params=[parameter, since_iso])
        else:
            df = pd.read_sql_query(sql, self._conn, params=[parameter, since_iso])
        if df.empty:
            return None
        return df.iloc[0].to_dict()

    def insert_if_new(self, alert: dict[str, Any]) -> dict[str, Any]:
        """Insert a new alert row unless one for this parameter was already
        logged within DEDUPE_MINUTES — in that case the existing row is
        returned so the dashboard keeps showing a stable alert_id while the
        condition persists."""
        since = (
            datetime.now(tz=timezone.utc) - timedelta(minutes=DEDUPE_MINUTES)
        ).isoformat()
        existing = self._latest_for_parameter(alert["parameter"], since_iso=since)
        if existing is not None:
            return _row_to_alert(existing)

        sql = """
        INSERT INTO ekf_alert_log (
            alert_id, time, parameter, parameter_label, observed_value,
            ekf_predicted_value, prediction_error, threshold, severity,
            related_indicators, alert_message, acknowledged_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        params = (
            alert["alert_id"],
            alert["timestamp"],
            alert["parameter"],
            alert["parameter_label"],
            alert.get("observed_value"),
            alert.get("ekf_predicted_value"),
            alert.get("prediction_error"),
            alert.get("threshold"),
            alert.get("severity"),
            json.dumps(alert.get("related_indicators") or []),
            alert.get("alert_message"),
            False,
        )
        if self._is_pg:
            sql_pg = sql.replace("?", "%s")
            with self._conn.cursor() as cur:
                cur.execute(sql_pg, params)
            self._conn.commit()
        else:
            self._conn.execute(sql, params)
            self._conn.commit()
        return alert

    def list_alerts(self, hours: float = 24.0) -> list[dict[str, Any]]:
        since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
        sql = "SELECT * FROM ekf_alert_log WHERE time >= ? ORDER BY time DESC"
        if self._is_pg:
            df = pd.read_sql(sql.replace("?", "%s"), self._conn, params=[since])
        else:
            df = pd.read_sql_query(sql, self._conn, params=[since])
        if df.empty:
            return []
        return [_row_to_alert(r) for r in df.to_dict(orient="records")]

    def acknowledge(self, alert_id: str) -> bool:
        sql = "UPDATE ekf_alert_log SET acknowledged_status = ? WHERE alert_id = ?"
        if self._is_pg:
            with self._conn.cursor() as cur:
                cur.execute(sql.replace("?", "%s"), (True, alert_id))
                updated = cur.rowcount > 0
            self._conn.commit()
        else:
            cur = self._conn.execute(sql, (1, alert_id))
            self._conn.commit()
            updated = cur.rowcount > 0
        return updated

    def close(self) -> None:
        conn = self._conn
        self._conn = None
        release(conn)

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass
