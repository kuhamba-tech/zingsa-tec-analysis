"""
Event log for Extended Kalman Filter deviation alerts.

Uses TimescaleDB when TSDB_DSN is set, otherwise SQLite at
static/data/ekf_alert_log.sqlite — same dual-backend pattern as
SpaceWeatherDB.
"""
from __future__ import annotations

import json
import logging
import os
import sqlite3
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

import pandas as pd

log = logging.getLogger(__name__)

_TSDB_DSN = os.getenv("TSDB_DSN", "")
_SQLITE_PATH = Path(__file__).resolve().parents[2] / "static" / "data" / "ekf_alert_log.sqlite"

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

_SQLITE_DDL = """
CREATE TABLE IF NOT EXISTS ekf_alert_log (
    alert_id            TEXT PRIMARY KEY,
    time                TEXT NOT NULL,
    parameter           TEXT,
    parameter_label     TEXT,
    observed_value      REAL,
    ekf_predicted_value REAL,
    prediction_error    REAL,
    threshold           REAL,
    severity            TEXT,
    related_indicators  TEXT,
    alert_message       TEXT,
    acknowledged_status INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ekf_alert_time_idx ON ekf_alert_log (time);
"""


def _row_to_alert(row: dict[str, Any]) -> dict[str, Any]:
    related = row.get("related_indicators")
    try:
        related = json.loads(related) if isinstance(related, str) else (related or [])
    except (TypeError, ValueError):
        related = []
    return {
        "alert_id": row.get("alert_id"),
        "timestamp": row.get("time"),
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
    def __init__(self, dsn: str = _TSDB_DSN):
        self._dsn = dsn
        self._is_pg = bool(dsn)
        self._conn = None
        self._init()

    def _init(self) -> None:
        if self._is_pg:
            self._init_pg()
        else:
            self._init_sqlite()

    def _init_pg(self) -> None:
        try:
            import psycopg2

            self._conn = psycopg2.connect(self._dsn)
            with self._conn.cursor() as cur:
                cur.execute(_PG_DDL)
                cur.execute(_PG_IDX)
            self._conn.commit()
        except Exception as exc:
            log.error("EkfAlertDB TimescaleDB init failed: %s — using SQLite", exc)
            self._is_pg = False
            self._init_sqlite()

    def _init_sqlite(self) -> None:
        try:
            _SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(_SQLITE_PATH), check_same_thread=False)
        except (OSError, sqlite3.OperationalError):
            # Read-only filesystem (e.g. Vercel) — fall back to an ephemeral
            # temp-dir database rather than crashing the request.
            fallback = Path(tempfile.gettempdir()) / _SQLITE_PATH.name
            self._conn = sqlite3.connect(str(fallback), check_same_thread=False)
        self._conn.executescript(_SQLITE_DDL)
        self._conn.commit()

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
        if self._conn:
            self._conn.close()
