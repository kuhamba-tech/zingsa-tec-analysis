"""
CORS station status archive — online / degraded / offline / unknown.

Logs state transitions and periodic snapshots so uptime, outages, and
correlation with space-weather metrics can be analysed later.

Uses TimescaleDB when TSDB_DSN is set, else SQLite at
static/data/station_status.sqlite.
"""
from __future__ import annotations

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
_SQLITE_PATH = Path(__file__).resolve().parents[2] / "static" / "data" / "station_status.sqlite"

VALID_STATUSES = frozenset({"online", "degraded", "offline", "unknown"})

_PG_EVENTS_DDL = """
CREATE TABLE IF NOT EXISTS station_status_events (
    time              TIMESTAMPTZ      NOT NULL,
    station_code      TEXT,
    status            TEXT             NOT NULL,
    previous_status   TEXT,
    event_type        TEXT             NOT NULL,
    online_count      INTEGER,
    degraded_count    INTEGER,
    offline_count     INTEGER,
    unknown_count     INTEGER,
    api_reachable     BOOLEAN          NOT NULL DEFAULT TRUE,
    message           TEXT,
    source            TEXT
);
"""
_PG_EVENTS_HYPER = (
    "SELECT create_hypertable('station_status_events','time',if_not_exists=>TRUE);"
)
_PG_SNAPSHOTS_DDL = """
CREATE TABLE IF NOT EXISTS station_status_snapshots (
    time              TIMESTAMPTZ      NOT NULL,
    station_code      TEXT             NOT NULL,
    status            TEXT             NOT NULL,
    api_reachable     BOOLEAN          NOT NULL DEFAULT TRUE,
    source            TEXT
);
"""
_PG_SNAPSHOTS_HYPER = (
    "SELECT create_hypertable('station_status_snapshots','time',if_not_exists=>TRUE);"
)
_PG_IDX = """
CREATE INDEX IF NOT EXISTS st_status_events_time_idx
    ON station_status_events (time DESC);
CREATE INDEX IF NOT EXISTS st_status_events_code_time_idx
    ON station_status_events (station_code, time DESC);
CREATE INDEX IF NOT EXISTS st_status_snap_time_idx
    ON station_status_snapshots (time DESC);
CREATE INDEX IF NOT EXISTS st_status_snap_code_time_idx
    ON station_status_snapshots (station_code, time DESC);
"""

_SQLITE_DDL = """
CREATE TABLE IF NOT EXISTS station_status_events (
    time              TEXT    NOT NULL,
    station_code      TEXT,
    status            TEXT    NOT NULL,
    previous_status   TEXT,
    event_type        TEXT    NOT NULL,
    online_count      INTEGER,
    degraded_count    INTEGER,
    offline_count     INTEGER,
    unknown_count     INTEGER,
    api_reachable     INTEGER NOT NULL DEFAULT 1,
    message           TEXT,
    source            TEXT
);
CREATE TABLE IF NOT EXISTS station_status_snapshots (
    time              TEXT    NOT NULL,
    station_code      TEXT    NOT NULL,
    status            TEXT    NOT NULL,
    api_reachable     INTEGER NOT NULL DEFAULT 1,
    source            TEXT
);
CREATE INDEX IF NOT EXISTS st_status_events_time_idx
    ON station_status_events (time);
CREATE INDEX IF NOT EXISTS st_status_events_code_time_idx
    ON station_status_events (station_code, time);
CREATE INDEX IF NOT EXISTS st_status_snap_time_idx
    ON station_status_snapshots (time);
CREATE INDEX IF NOT EXISTS st_status_snap_code_time_idx
    ON station_status_snapshots (station_code, time);
"""


class StationStatusDB:
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
        log.info(
            "StationStatusDB ready (%s)",
            "TimescaleDB" if self._is_pg else f"SQLite:{_SQLITE_PATH}",
        )

    def _init_pg(self) -> None:
        try:
            import psycopg2

            self._conn = psycopg2.connect(self._dsn)
            with self._conn.cursor() as cur:
                cur.execute(_PG_EVENTS_DDL)
                cur.execute(_PG_SNAPSHOTS_DDL)
                for stmt in (_PG_EVENTS_HYPER, _PG_SNAPSHOTS_HYPER):
                    try:
                        cur.execute(stmt)
                    except Exception:
                        pass
                cur.execute(_PG_IDX)
            self._conn.commit()
        except Exception as exc:
            log.error("StationStatusDB TimescaleDB init failed: %s — using SQLite", exc)
            self._is_pg = False
            self._init_sqlite()

    def _init_sqlite(self) -> None:
        try:
            _SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(_SQLITE_PATH), check_same_thread=False)
        except OSError:
            # Read-only filesystem (e.g. Vercel) — fall back to an ephemeral
            # temp-dir database rather than crashing the request.
            fallback = Path(tempfile.gettempdir()) / _SQLITE_PATH.name
            self._conn = sqlite3.connect(str(fallback), check_same_thread=False)
        self._conn.executescript(_SQLITE_DDL)
        self._conn.commit()

    def insert_event(self, row: dict[str, Any]) -> None:
        sql = """
        INSERT INTO station_status_events (
            time, station_code, status, previous_status, event_type,
            online_count, degraded_count, offline_count, unknown_count,
            api_reachable, message, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        params = (
            str(row["time"]),
            row.get("station_code"),
            row["status"],
            row.get("previous_status"),
            row["event_type"],
            row.get("online_count"),
            row.get("degraded_count"),
            row.get("offline_count"),
            row.get("unknown_count"),
            bool(row.get("api_reachable", True)),
            row.get("message"),
            row.get("source", "poll"),
        )
        self._exec(sql, params)

    def insert_snapshots(self, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        sql = """
        INSERT INTO station_status_snapshots (time, station_code, status, api_reachable, source)
        VALUES (?, ?, ?, ?, ?)
        """
        params = [
            (
                str(r["time"]),
                r["station_code"],
                r["status"],
                bool(r.get("api_reachable", True)),
                r.get("source", "poll"),
            )
            for r in rows
        ]
        if self._is_pg:
            sql = sql.replace("?", "%s")
            with self._conn.cursor() as cur:
                cur.executemany(sql, params)
            self._conn.commit()
        else:
            self._conn.executemany(sql, params)
            self._conn.commit()
        return len(params)

    def _exec(self, sql: str, params: tuple) -> None:
        if self._is_pg:
            sql = sql.replace("?", "%s")
            with self._conn.cursor() as cur:
                cur.execute(sql, params)
            self._conn.commit()
        else:
            self._conn.execute(sql, params)
            self._conn.commit()

    def query_events(
        self,
        hours: float = 168.0,
        *,
        station_code: str | None = None,
        event_type: str | None = None,
        limit: int = 500,
    ) -> pd.DataFrame:
        since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
        clauses = ["time >= ?"]
        params: list[Any] = [since]
        if station_code:
            clauses.append("station_code = ?")
            params.append(station_code.lower())
        if event_type:
            clauses.append("event_type = ?")
            params.append(event_type)
        sql = f"""
        SELECT time, station_code, status, previous_status, event_type,
               online_count, degraded_count, offline_count, unknown_count,
               api_reachable, message, source
        FROM station_status_events
        WHERE {' AND '.join(clauses)}
        ORDER BY time DESC
        LIMIT ?
        """
        params.append(limit)
        if self._is_pg:
            sql = sql.replace("?", "%s")
            df = pd.read_sql(sql, self._conn, params=params)
        else:
            df = pd.read_sql_query(sql, self._conn, params=params)
        if not df.empty:
            df = df.sort_values("time").reset_index(drop=True)
        return df

    def query_snapshots(
        self,
        hours: float = 24.0,
        *,
        station_code: str | None = None,
    ) -> pd.DataFrame:
        since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
        clauses = ["time >= ?"]
        params: list[Any] = [since]
        if station_code:
            clauses.append("station_code = ?")
            params.append(station_code.lower())
        sql = f"""
        SELECT time, station_code, status, api_reachable, source
        FROM station_status_snapshots
        WHERE {' AND '.join(clauses)}
        ORDER BY time
        """
        if self._is_pg:
            sql = sql.replace("?", "%s")
            return pd.read_sql(sql, self._conn, params=params)
        return pd.read_sql_query(sql, self._conn, params=params)

    def uptime_summary(self, hours: float = 168.0) -> list[dict[str, Any]]:
        """Fraction of snapshots in each status per station (all registered CORS sites)."""
        from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

        df = self.query_snapshots(hours=hours)
        by_code: dict[str, dict[str, Any]] = {}

        if not df.empty:
            for code, grp in df.groupby("station_code"):
                total = len(grp)
                counts = grp["status"].value_counts().to_dict()
                key = str(code).lower().rstrip("_")
                by_code[key] = {
                    "station_code": key,
                    "samples": int(total),
                    "online_pct": round(100.0 * counts.get("online", 0) / total, 1),
                    "degraded_pct": round(100.0 * counts.get("degraded", 0) / total, 1),
                    "offline_pct": round(100.0 * counts.get("offline", 0) / total, 1),
                    "unknown_pct": round(100.0 * counts.get("unknown", 0) / total, 1),
                }

        out: list[dict[str, Any]] = []
        for station in ZIMBABWE_CORS_STATIONS:
            code = station.code.lower().rstrip("_")
            row = by_code.get(code)
            if row:
                out.append({**row, "station_name": station.name})
            else:
                out.append(
                    {
                        "station_code": code,
                        "station_name": station.name,
                        "samples": 0,
                        "online_pct": 0.0,
                        "degraded_pct": 0.0,
                        "offline_pct": 0.0,
                        "unknown_pct": 0.0,
                    }
                )
        return out

    def event_count(self) -> int:
        cur = self._conn.cursor()
        cur.execute("SELECT COUNT(*) FROM station_status_events")
        return int(cur.fetchone()[0])

    def snapshot_count(self) -> int:
        cur = self._conn.cursor()
        cur.execute("SELECT COUNT(*) FROM station_status_snapshots")
        return int(cur.fetchone()[0])

    def close(self) -> None:
        if self._conn:
            self._conn.close()
