"""GIC measurement log — transformer-neutral current time series per station.

SQLite at static/data/gic_log.sqlite (temp-dir fallback on read-only
filesystems, matching the other ZGIIS loggers). Only real ingested field
measurements are stored; nothing is synthesised.
"""
from __future__ import annotations

import sqlite3
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd

_SQLITE_PATH = Path(__file__).resolve().parents[2] / "static" / "data" / "gic_log.sqlite"

_DDL = """
CREATE TABLE IF NOT EXISTS gic_log (
    time        TEXT NOT NULL,
    station_id  TEXT NOT NULL,
    gic_a       REAL NOT NULL,
    temp_c      REAL,
    source      TEXT,
    UNIQUE (time, station_id)
);
CREATE INDEX IF NOT EXISTS gic_log_station_time_idx ON gic_log (station_id, time);
"""


class GicDB:
    def __init__(self) -> None:
        try:
            _SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(_SQLITE_PATH), check_same_thread=False)
        except (OSError, sqlite3.OperationalError):
            fallback = Path(tempfile.gettempdir()) / _SQLITE_PATH.name
            self._conn = sqlite3.connect(str(fallback), check_same_thread=False)
        self._conn.executescript(_DDL)
        self._conn.commit()

    def insert_rows(self, rows: list[dict[str, Any]]) -> int:
        """Insert measurement rows; duplicates (same time+station) are skipped."""
        if not rows:
            return 0
        before = self.record_count()
        self._conn.executemany(
            "INSERT OR IGNORE INTO gic_log (time, station_id, gic_a, temp_c, source)"
            " VALUES (?, ?, ?, ?, ?)",
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
        self._conn.commit()
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
            sql += " AND station_id = ?"
            params.append(station_id.upper())
        if start:
            sql += " AND time >= ?"
            params.append(start)
        elif hours is not None:
            since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
            sql += " AND time >= ?"
            params.append(since)
        if end:
            sql += " AND time <= ?"
            params.append(end)
        sql += " ORDER BY time"

        df = pd.read_sql_query(sql, self._conn, params=params)
        if df.empty:
            return df

        df["time"] = pd.to_datetime(df["time"], utc=True, errors="coerce")
        df = df.dropna(subset=["time"]).set_index("time").sort_index()

        if resample:
            # Preserve signed mean but also the peak magnitude within each bin,
            # which is what matters for transformer stress.
            agg = df.groupby("station_id").resample(resample).agg(
                gic_a=("gic_a", "mean"),
                gic_abs_max=("gic_a", lambda s: s.abs().max() if len(s) else None),
                temp_c=("temp_c", "mean"),
            )
            df = agg.reset_index().dropna(subset=["gic_a"]).set_index("time").sort_index()

        return df.reset_index()

    def station_summaries(self) -> list[dict[str, Any]]:
        cur = self._conn.cursor()
        cur.execute(
            """
            SELECT station_id, COUNT(*), MIN(time), MAX(time)
            FROM gic_log GROUP BY station_id ORDER BY station_id
            """
        )
        out: list[dict[str, Any]] = []
        for station_id, count, first, last in cur.fetchall():
            latest = self._conn.execute(
                "SELECT time, gic_a FROM gic_log WHERE station_id = ? ORDER BY time DESC LIMIT 1",
                (station_id,),
            ).fetchone()
            out.append(
                {
                    "station_id": station_id,
                    "count": int(count),
                    "first": first,
                    "last": last,
                    "latest_time": latest[0] if latest else None,
                    "latest_gic_a": latest[1] if latest else None,
                }
            )
        return out

    def record_count(self) -> int:
        cur = self._conn.cursor()
        cur.execute("SELECT COUNT(*) FROM gic_log")
        return int(cur.fetchone()[0])

    def close(self) -> None:
        self._conn.close()
