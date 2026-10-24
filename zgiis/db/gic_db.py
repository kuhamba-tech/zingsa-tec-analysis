"""GIC measurement log — transformer-neutral current time series per station.

Stored in Supabase Postgres. Only real ingested field measurements are
stored; nothing is synthesised.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd

from zgiis.db.config import (
    DatabaseUnavailable,
    checkout,
    database_dsn,
    execute_script,
    release,
    schema_init_enabled,
    transaction,
)

log = logging.getLogger(__name__)

_DDL = """
CREATE TABLE IF NOT EXISTS gic_log (
    time        TIMESTAMPTZ NOT NULL,
    station_id  TEXT NOT NULL,
    gic_a       DOUBLE PRECISION NOT NULL,
    temp_c      DOUBLE PRECISION,
    source      TEXT,
    UNIQUE (time, station_id)
);
CREATE INDEX IF NOT EXISTS gic_log_station_time_idx ON gic_log (station_id, time DESC);
"""


class GicDB:
    def __init__(self, dsn: str | None = None) -> None:
        self._dsn = database_dsn() if dsn is None else dsn
        self._conn = None
        if not self._dsn:
            log.error("SUPABASE_DATABASE_URL is not configured")
            raise DatabaseUnavailable("SUPABASE_DATABASE_URL is not configured")
        try:
            self._conn = checkout(self._dsn)
            if schema_init_enabled():
                with self._conn.cursor() as cur:
                    execute_script(cur, _DDL)
        except Exception as exc:
            log.error("GicDB Postgres init failed: %s", exc)
            raise DatabaseUnavailable("Supabase Postgres init failed") from exc

    def insert_rows(self, rows: list[dict[str, Any]]) -> int:
        """Insert measurement rows; duplicates (same time+station) are skipped."""
        if not rows:
            return 0
        before = self.record_count()
        with transaction(self._conn):
            cur = self._conn.cursor()
            cur.executemany(
                """
                INSERT INTO gic_log (time, station_id, gic_a, temp_c, source)
                VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (time, station_id) DO NOTHING
                """,
                [
                    (
                        str(r["time"]),
                        str(r["station_id"]).upper(),
                        float(r["gic_a"]),
                        r.get("temp_c"),
                        r.get("source", "ingest"),
                    )
                    for r in rows
                ],
            )
        return self.record_count() - before

    def query_dataframe(
        self,
        station_id: str | None = None,
        hours: float | None = 24.0,
        *,
        start: str | None = None,
        end: str | None = None,
        resample: str | None = None,
    ) -> pd.DataFrame:
        sql = "SELECT time, station_id, gic_a, temp_c FROM gic_log WHERE 1=1"
        params: list[Any] = []
        if station_id:
            sql += " AND station_id = %s"
            params.append(station_id.upper())
        if start:
            sql += " AND time >= %s"
            params.append(start)
        elif hours is not None:
            since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
            sql += " AND time >= %s"
            params.append(since)
        if end:
            sql += " AND time <= %s"
            params.append(end)
        sql += " ORDER BY time"

        df = pd.read_sql(sql, self._conn, params=params)
        if df.empty:
            return df

        df["time"] = pd.to_datetime(df["time"], utc=True, errors="coerce")
        df = df.dropna(subset=["time"]).set_index("time").sort_index()

        if resample:
            agg = df.groupby("station_id").resample(resample).agg(
                gic_a=("gic_a", "mean"),
                gic_abs_max=("gic_a", lambda s: s.abs().max() if len(s) else None),
                temp_c=("temp_c", "mean"),
            )
            df = agg.reset_index().dropna(subset=["gic_a"]).set_index("time").sort_index()

        return df.reset_index()

    def station_summaries(self) -> list[dict[str, Any]]:
        with self._conn.cursor() as cur:
            cur.execute(
                """
                SELECT station_id, COUNT(*), MIN(time), MAX(time)
                FROM gic_log GROUP BY station_id ORDER BY station_id
                """
            )
            grouped = cur.fetchall()
        out: list[dict[str, Any]] = []
        for station_id, count, first, last in grouped:
            with self._conn.cursor() as cur:
                cur.execute(
                    "SELECT time, gic_a FROM gic_log WHERE station_id = %s ORDER BY time DESC LIMIT 1",
                    (station_id,),
                )
                latest = cur.fetchone()
            out.append(
                {
                    "station_id": station_id,
                    "count": int(count),
                    "first": first.isoformat() if hasattr(first, "isoformat") else first,
                    "last": last.isoformat() if hasattr(last, "isoformat") else last,
                    "latest_time": (
                        latest[0].isoformat() if latest and hasattr(latest[0], "isoformat") else (latest[0] if latest else None)
                    ),
                    "latest_gic_a": latest[1] if latest else None,
                }
            )
        return out

    def record_count(self) -> int:
        with self._conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM gic_log")
            return int(cur.fetchone()[0])

    def close(self) -> None:
        conn = getattr(self, "_conn", None)
        self._conn = None
        release(conn)

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass
