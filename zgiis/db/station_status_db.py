"""
CORS station status archive — online / offline / unknown.
Legacy "linked" / "degraded" rows are normalized to online on read/write.

Logs state transitions and periodic snapshots so uptime, outages, and
correlation with space-weather metrics can be analysed later.

Uses Supabase/PostgreSQL when SUPABASE_DATABASE_URL or DATABASE_URL is set, else SQLite at
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

from zgiis.db.config import database_backend_label, database_dsn

log = logging.getLogger(__name__)

_TSDB_DSN = database_dsn()
_SQLITE_PATH = Path(__file__).resolve().parents[2] / "static" / "data" / "station_status.sqlite"

VALID_STATUSES = frozenset({"online", "offline", "unknown"})
_LEGACY_STATUSES = frozenset({"degraded", "linked", "connected"})  # folded into online


def _normalize_stored_status(status: str) -> str:
    s = (status or "").lower()
    if s in VALID_STATUSES:
        return s
    if s in _LEGACY_STATUSES:
        return "online"
    return "unknown"

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
            database_backend_label(self._dsn) if self._is_pg else f"SQLite:{_SQLITE_PATH}",
        )

    def _init_pg(self) -> None:
        try:
            import psycopg2

            self._conn = psycopg2.connect(self._dsn)
            if os.getenv("VERCEL"):
                return
            with self._conn.cursor() as cur:
                cur.execute(_PG_EVENTS_DDL)
                cur.execute(_PG_SNAPSHOTS_DDL)
            self._conn.commit()
            for stmt in (_PG_EVENTS_HYPER, _PG_SNAPSHOTS_HYPER):
                try:
                    with self._conn.cursor() as cur:
                        cur.execute(stmt)
                    self._conn.commit()
                except Exception as exc:
                    self._conn.rollback()
                    log.warning("Station status hypertable setup skipped: %s", exc)
            with self._conn.cursor() as cur:
                cur.execute(_PG_IDX)
            self._conn.commit()
        except Exception as exc:
            log.error("StationStatusDB Postgres init failed: %s - using SQLite", exc)
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

    def _with_reconnect(self, fn):
        """Run fn(); on a Postgres connection error, reconnect once and retry.

        Vercel's serverless containers can stay warm and reuse this same
        StationStatusDB instance across requests. If the pooler drops an
        idle connection in between, every read on this warm container would
        otherwise fail forever (insert_snapshots/log_streams already
        recovers by discarding the whole DB object on failure, but reads
        like event_count/snapshot_count/query_events/query_snapshots had no
        equivalent recovery) — reconnect transparently instead.
        """
        try:
            return fn()
        except Exception:
            if not self._is_pg:
                raise
            log.warning("StationStatusDB connection appears stale; reconnecting")
            self._init_pg()
            return fn()

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
            _normalize_stored_status(str(row.get("status") or "")),
            (
                _normalize_stored_status(str(row["previous_status"]))
                if row.get("previous_status")
                else None
            ),
            row["event_type"],
            row.get("online_count"),
            0,  # degraded_count retired — no-stream is offline
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
                _normalize_stored_status(str(r.get("status") or "")),
                bool(r.get("api_reachable", True)),
                r.get("source", "poll"),
            )
            for r in rows
        ]

        def _do() -> None:
            if self._is_pg:
                pg_sql = sql.replace("?", "%s")
                with self._conn.cursor() as cur:
                    cur.executemany(pg_sql, params)
                self._conn.commit()
            else:
                self._conn.executemany(sql, params)
                self._conn.commit()

        self._with_reconnect(_do)
        return len(params)

    def _exec(self, sql: str, params: tuple) -> None:
        def _do() -> None:
            if self._is_pg:
                pg_sql = sql.replace("?", "%s")
                with self._conn.cursor() as cur:
                    cur.execute(pg_sql, params)
                self._conn.commit()
            else:
                self._conn.execute(sql, params)
                self._conn.commit()

        self._with_reconnect(_do)

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
        def _do() -> pd.DataFrame:
            if self._is_pg:
                pg_sql = sql.replace("?", "%s")
                return pd.read_sql(pg_sql, self._conn, params=params)
            return pd.read_sql_query(sql, self._conn, params=params)

        df = self._with_reconnect(_do)
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
        def _do() -> pd.DataFrame:
            if self._is_pg:
                pg_sql = sql.replace("?", "%s")
                return pd.read_sql(pg_sql, self._conn, params=params)
            return pd.read_sql_query(sql, self._conn, params=params)

        return self._with_reconnect(_do)

    def latest_snapshots(self, hours: float = 1.0) -> dict[str, dict[str, Any]]:
        """Latest archived live status for each station within the freshness window."""
        df = self.query_snapshots(hours=hours)
        if df.empty or "station_code" not in df.columns:
            return {}
        latest = df.sort_values("time").groupby("station_code").tail(1)
        out: dict[str, dict[str, Any]] = {}
        for _, row in latest.iterrows():
            code = str(row.get("station_code") or "").lower().rstrip("_")
            status = _normalize_stored_status(str(row.get("status") or ""))
            if code and status in VALID_STATUSES:
                out[code] = {
                    "time": str(row.get("time") or ""),
                    "status": status,
                    "api_reachable": bool(row.get("api_reachable", True)),
                    "source": str(row.get("source") or "station_status_archive"),
                }
        return out

    @staticmethod
    def default_bucket_minutes(hours: float) -> int:
        """Choose a sensible aggregation bucket for chart payloads."""
        if hours <= 24:
            return 30
        if hours <= 168:
            return 60
        if hours <= 720:
            return 360
        return 1440

    def uptime_summary(
        self,
        hours: float = 168.0,
        *,
        station_code: str | None = None,
    ) -> list[dict[str, Any]]:
        """Fraction of snapshots in each status per station (all registered CORS sites)."""
        from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

        code_filter = station_code.lower().rstrip("_") if station_code else None
        df = self.query_snapshots(hours=hours, station_code=code_filter)
        by_code: dict[str, dict[str, Any]] = {}

        if not df.empty:
            for code, grp in df.groupby("station_code"):
                total = len(grp)
                counts = grp["status"].map(_normalize_stored_status).value_counts().to_dict()
                key = str(code).lower().rstrip("_")
                by_code[key] = {
                    "station_code": key,
                    "samples": int(total),
                    "online_pct": round(100.0 * counts.get("online", 0) / total, 1),
                    "degraded_pct": 0.0,
                    "offline_pct": round(100.0 * counts.get("offline", 0) / total, 1),
                    "unknown_pct": round(100.0 * counts.get("unknown", 0) / total, 1),
                }

        stations = ZIMBABWE_CORS_STATIONS
        if code_filter:
            stations = [s for s in stations if s.code.lower().rstrip("_") == code_filter]

        out: list[dict[str, Any]] = []
        for station in stations:
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

    def uptime_timeline(
        self,
        hours: float = 168.0,
        *,
        station_code: str | None = None,
        bucket_minutes: int | None = None,
    ) -> list[dict[str, Any]]:
        """Bucketed online-% series for one station or the whole network.

        Network mode: within each bucket, take the latest sample per station,
        then online_pct = 100 * online_stations / stations_seen.
        Station mode: online_pct = 100 * online_samples / samples in the bucket.
        """
        code = station_code.lower().rstrip("_") if station_code else None
        bucket = max(1, int(bucket_minutes or self.default_bucket_minutes(hours)))
        df = self.query_snapshots(hours=hours, station_code=code)
        if df.empty:
            return []

        work = df.copy()
        work["status"] = work["status"].map(_normalize_stored_status)
        work["station_code"] = work["station_code"].map(
            lambda c: str(c).lower().rstrip("_") if c is not None else ""
        )
        work["time"] = pd.to_datetime(work["time"], utc=True, errors="coerce")
        work = work.dropna(subset=["time"])
        if work.empty:
            return []

        work = work.sort_values("time")
        work["bucket"] = work["time"].dt.floor(f"{bucket}min")

        points: list[dict[str, Any]] = []
        for bucket_ts, grp in work.groupby("bucket", sort=True):
            if code:
                statuses = grp["status"].tolist()
            else:
                # Latest status per station inside the bucket.
                latest = grp.sort_values("time").groupby("station_code", sort=False).tail(1)
                statuses = latest["status"].tolist()
            samples = len(statuses)
            online_n = sum(1 for s in statuses if s == "online")
            offline_n = sum(1 for s in statuses if s == "offline")
            unknown_n = sum(1 for s in statuses if s == "unknown")
            online_pct = round(100.0 * online_n / samples, 1) if samples else 0.0
            ts = pd.Timestamp(bucket_ts)
            if ts.tzinfo is None:
                ts = ts.tz_localize("UTC")
            else:
                ts = ts.tz_convert("UTC")
            points.append(
                {
                    "time": ts.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
                    "online_pct": online_pct,
                    "online_count": int(online_n),
                    "offline_count": int(offline_n),
                    "unknown_count": int(unknown_n),
                    "samples": int(samples),
                }
            )
        return points

    def uptime_analysis(
        self,
        hours: float = 168.0,
        *,
        station_code: str | None = None,
        bucket_minutes: int | None = None,
    ) -> dict[str, Any]:
        """Summary metrics + timeline + per-station rows for dashboard analysis."""
        from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

        code = station_code.lower().rstrip("_") if station_code else None
        bucket = max(1, int(bucket_minutes or self.default_bucket_minutes(hours)))
        stations = self.uptime_summary(hours=hours, station_code=None)
        timeline = self.uptime_timeline(
            hours=hours, station_code=code, bucket_minutes=bucket
        )

        station_name: str | None = None
        if code:
            match = next(
                (s for s in ZIMBABWE_CORS_STATIONS if s.code.lower().rstrip("_") == code),
                None,
            )
            station_name = match.name if match else code.upper()
            focus = next((r for r in stations if r["station_code"] == code), None)
            if focus is None:
                focus = {
                    "station_code": code,
                    "station_name": station_name or code,
                    "samples": 0,
                    "online_pct": 0.0,
                    "degraded_pct": 0.0,
                    "offline_pct": 0.0,
                    "unknown_pct": 0.0,
                }
            samples = int(focus["samples"])
            online_pct = float(focus["online_pct"])
            offline_pct = float(focus["offline_pct"])
            unknown_pct = float(focus["unknown_pct"])
        else:
            with_samples = [r for r in stations if int(r["samples"]) > 0]
            samples = sum(int(r["samples"]) for r in stations)
            if with_samples:
                online_pct = round(
                    sum(float(r["online_pct"]) for r in with_samples) / len(with_samples), 1
                )
                offline_pct = round(
                    sum(float(r["offline_pct"]) for r in with_samples) / len(with_samples), 1
                )
                unknown_pct = round(
                    sum(float(r["unknown_pct"]) for r in with_samples) / len(with_samples), 1
                )
            else:
                online_pct = offline_pct = unknown_pct = 0.0

        events = self.query_events(hours=hours, station_code=code, limit=2000)
        outage_events = 0
        if not events.empty:
            status = events["status"].map(_normalize_stored_status)
            outage_mask = (events["event_type"] == "status_change") & (status == "offline")
            outage_events = int(outage_mask.sum())

        network_with = [r for r in stations if int(r["samples"]) > 0]
        network_online_pct = (
            round(sum(float(r["online_pct"]) for r in network_with) / len(network_with), 1)
            if network_with
            else 0.0
        )

        return {
            "hours": float(hours),
            "bucket_minutes": bucket,
            "station_code": code,
            "station_name": station_name,
            "samples": samples,
            "online_pct": online_pct,
            "offline_pct": offline_pct,
            "unknown_pct": unknown_pct,
            "outage_events": outage_events,
            "network_online_pct": network_online_pct,
            "stations": stations,
            "timeline": timeline,
        }

    def event_count(self) -> int:
        def _do() -> int:
            cur = self._conn.cursor()
            cur.execute("SELECT COUNT(*) FROM station_status_events")
            return int(cur.fetchone()[0])

        return self._with_reconnect(_do)

    def snapshot_count(self) -> int:
        def _do() -> int:
            cur = self._conn.cursor()
            cur.execute("SELECT COUNT(*) FROM station_status_snapshots")
            return int(cur.fetchone()[0])

        return self._with_reconnect(_do)

    def close(self) -> None:
        if self._conn:
            self._conn.close()
