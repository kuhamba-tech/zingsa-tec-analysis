"""
VTEC observation database.

Uses TimescaleDB (PostgreSQL) when TSDB_DSN env-var is set,
falls back to SQLite for development/offline use.

TimescaleDB hypertable gives automatic time-partitioning so queries
over the 24-station, multi-constellation stream stay fast.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import tempfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd

log = logging.getLogger(__name__)

_TSDB_DSN = (
    os.getenv("TSDB_DSN")
    or os.getenv("POSTGRES_URL")
    or os.getenv("DATABASE_URL")
    or ""
)
_SQLITE_PATH = Path(__file__).resolve().parents[2] / "static" / "data" / "vtec_live.db"

# ── TimescaleDB schema ────────────────────────────────────────────────────────
_PG_DDL = """
CREATE TABLE IF NOT EXISTS vtec_obs (
    time           TIMESTAMPTZ      NOT NULL,
    station        TEXT             NOT NULL,
    constellation  TEXT             NOT NULL,
    prn            TEXT             NOT NULL,
    stec_tecu      DOUBLE PRECISION,
    vtec_tecu      DOUBLE PRECISION,
    elevation_deg  DOUBLE PRECISION,
    cnr_dbhz       DOUBLE PRECISION
);
"""
_PG_HYPER = """
SELECT create_hypertable('vtec_obs','time',if_not_exists=>TRUE);
"""
_PG_IDX = """
CREATE INDEX IF NOT EXISTS vtec_obs_station_time ON vtec_obs (station, time DESC);
"""

# ── SQLite schema ─────────────────────────────────────────────────────────────
_SQLITE_DDL = """
CREATE TABLE IF NOT EXISTS vtec_obs (
    time           TEXT    NOT NULL,
    station        TEXT    NOT NULL,
    constellation  TEXT    NOT NULL,
    prn            TEXT    NOT NULL,
    stec_tecu      REAL,
    vtec_tecu      REAL,
    elevation_deg  REAL,
    cnr_dbhz       REAL
);
CREATE INDEX IF NOT EXISTS vtec_obs_station_time
    ON vtec_obs (station, time);
"""


class TecDB:
    """
    Unified VTEC database client.

    Connect with TimescaleDB:
        TecDB(dsn="postgresql://user:pass@host:5432/zgiis")
    or simply:
        TecDB()           # uses TSDB_DSN env-var, or SQLite fallback
    """

    def __init__(self, dsn: str = _TSDB_DSN):
        self._dsn    = dsn
        self._is_pg  = bool(dsn)
        self._conn   = None
        self._init()

    # ── Initialisation ────────────────────────────────────────────────────────

    def _init(self) -> None:
        if self._is_pg:
            self._init_pg()
        else:
            self._init_sqlite()
        log.info("TecDB ready (%s)", "TimescaleDB" if self._is_pg else f"SQLite:{_SQLITE_PATH}")

    def _init_pg(self) -> None:
        try:
            import psycopg2
            self._conn = psycopg2.connect(self._dsn)
            with self._conn.cursor() as cur:
                cur.execute(_PG_DDL)
            self._conn.commit()
            try:
                with self._conn.cursor() as cur:
                    cur.execute(_PG_HYPER)
                self._conn.commit()
            except Exception as exc:
                self._conn.rollback()
                log.warning("Timescale hypertable setup skipped: %s", exc)
            with self._conn.cursor() as cur:
                cur.execute(_PG_IDX)
            self._conn.commit()
        except ImportError:
            log.error("psycopg2 not installed — pip install psycopg2-binary")
            self._is_pg = False
            self._init_sqlite()
        except Exception as exc:
            log.error("TimescaleDB init failed: %s — falling back to SQLite", exc)
            self._is_pg = False
            self._init_sqlite()

    @property
    def backend(self) -> str:
        return "timescaledb" if self._is_pg else "sqlite"

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

    # ── Write ─────────────────────────────────────────────────────────────────

    def insert_vtec(self, records: list[dict]) -> int:
        """Bulk-insert VTEC records. Returns count inserted."""
        if not records:
            return 0

        rows = [
            (
                (r["epoch"].isoformat()
                 if isinstance(r["epoch"], datetime) else str(r["epoch"])),
                r.get("station", ""),
                r.get("constellation", "GPS"),
                r.get("prn", ""),
                r.get("stec_tecu"),
                r.get("vtec_tecu"),
                r.get("elevation_deg"),
                r.get("cnr_dbhz"),
            )
            for r in records
        ]

        sql = """
        INSERT INTO vtec_obs
            (time, station, constellation, prn, stec_tecu, vtec_tecu, elevation_deg, cnr_dbhz)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """
        if self._is_pg:
            sql = sql.replace("?", "%s")
            with self._conn.cursor() as cur:
                cur.executemany(sql, rows)
            self._conn.commit()
        else:
            self._conn.executemany(sql, rows)
            self._conn.commit()
        return len(rows)

    # ── Read ──────────────────────────────────────────────────────────────────

    def query_recent(
        self,
        hours: float = 24.0,
        station: Optional[str] = None,
        constellation: Optional[str] = None,
    ) -> pd.DataFrame:
        """VTEC observations from the last N hours."""
        since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
        clauses = ["time >= ?"]
        params: list = [since]
        if station:
            clauses.append("station = ?")
            params.append(station)
        if constellation:
            clauses.append("constellation = ?")
            params.append(constellation)

        sql = f"SELECT * FROM vtec_obs WHERE {' AND '.join(clauses)} ORDER BY time"
        if self._is_pg:
            sql = sql.replace("?", "%s")
            return pd.read_sql(sql, self._conn, params=params)
        return pd.read_sql_query(sql, self._conn, params=params)

    def mean_vtec_timeseries(
        self,
        hours: float = 24.0,
        resample: str = "15min",
        station: Optional[str] = None,
    ) -> pd.Series:
        """
        Mean VTEC across all satellites per 15-min epoch for the last N hours.
        Returns a pd.Series with datetime index, suitable for CNN-GRU input.
        """
        df = self.query_recent(hours=hours, station=station)
        if df.empty:
            return pd.Series(dtype=float, name="vtec_tecu")
        df["time"] = pd.to_datetime(df["time"], utc=True)
        return (
            df.set_index("time")["vtec_tecu"]
            .resample(resample)
            .mean()
            .interpolate(limit=4)
            .dropna()
            .rename("vtec_tecu")
        )

    def station_summary(self, hours: float = 1.0) -> pd.DataFrame:
        """Mean/max VTEC and observation count per station over last N hours."""
        df = self.query_recent(hours=hours)
        if df.empty:
            return pd.DataFrame(columns=["station", "mean_vtec", "max_vtec", "obs_count"])
        return (
            df.groupby("station")["vtec_tecu"]
            .agg(mean_vtec="mean", max_vtec="max", obs_count="count")
            .reset_index()
        )

    def record_count(self) -> int:
        """Total rows in the database."""
        cur = (
            self._conn.cursor() if self._is_pg
            else self._conn.cursor()
        )
        cur.execute("SELECT COUNT(*) FROM vtec_obs")
        return cur.fetchone()[0]

    # ── Housekeeping ──────────────────────────────────────────────────────────

    def prune_older_than(self, days: int = 90) -> int:
        """Delete records older than N days. Returns rows deleted."""
        cutoff = (datetime.now(tz=timezone.utc) - timedelta(days=days)).isoformat()
        sql = "DELETE FROM vtec_obs WHERE time < ?"
        if self._is_pg:
            sql = sql.replace("?", "%s")
            with self._conn.cursor() as cur:
                cur.execute(sql, (cutoff,))
                deleted = cur.rowcount
            self._conn.commit()
        else:
            cur = self._conn.execute(sql, (cutoff,))
            deleted = cur.rowcount
            self._conn.commit()
        return deleted

    def close(self) -> None:
        if self._conn:
            self._conn.close()
