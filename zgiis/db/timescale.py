"""
VTEC observation database.

Uses Supabase/PostgreSQL when SUPABASE_DATABASE_URL or DATABASE_URL is set,
falls back to SQLite for development/offline use.

If TimescaleDB is available the time-series tables are promoted to hypertables.
"""
from __future__ import annotations

import logging
import math
import os
import sqlite3
import tempfile
import threading
import time
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd

from zgiis.db.config import database_backend_label, database_dsn

log = logging.getLogger(__name__)

_TSDB_DSN = database_dsn()
_SQLITE_PATH = Path(__file__).resolve().parents[2] / "static" / "data" / "vtec_live.db"
# Serialize SQLite writers inside a process. Cross-process contention (API +
# live_ntrip_collector) is handled with WAL + busy_timeout + insert retries.
_SQLITE_WRITE_LOCK = threading.RLock()
_SHARED_SQLITE_CONN: sqlite3.Connection | None = None
_SQLITE_BUSY_TIMEOUT_MS = 8_000
_SQLITE_CONNECT_TIMEOUT_SEC = 15.0
_SQLITE_INSERT_ATTEMPTS = 6


def _sqlite_busy(exc: BaseException) -> bool:
    msg = str(exc).lower()
    return "locked" in msg or "busy" in msg


def _configure_sqlite(conn: sqlite3.Connection) -> None:
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(f"PRAGMA busy_timeout={_SQLITE_BUSY_TIMEOUT_MS}")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA temp_store=MEMORY")
    except sqlite3.Error as exc:
        log.debug("SQLite PRAGMA setup skipped: %s", exc)

# Set once the first TecDB() in this process has confirmed the Postgres
# schema (DDL/audit-columns/hypertable/index) exists, so later instances
# skip re-running it — see _init_pg().
_PG_SCHEMA_READY = False

# Postgres schema
_PG_DDL = """
CREATE TABLE IF NOT EXISTS vtec_obs (
    time           TIMESTAMPTZ      NOT NULL,
    station        TEXT             NOT NULL,
    constellation  TEXT             NOT NULL,
    prn            TEXT             NOT NULL,
    tecg_tecu      DOUBLE PRECISION,
    tecp_tecu      DOUBLE PRECISION,
    stec_tecu      DOUBLE PRECISION,
    vtec_tecu      DOUBLE PRECISION,
    elevation_deg  DOUBLE PRECISION,
    cnr_dbhz       DOUBLE PRECISION,
    tec_method     TEXT,
    bias_method    TEXT
);
"""
_PG_HYPER = """
SELECT create_hypertable('vtec_obs','time',if_not_exists=>TRUE);
"""
_PG_IDX = """
CREATE INDEX IF NOT EXISTS vtec_obs_station_time ON vtec_obs (station, time DESC);
CREATE INDEX IF NOT EXISTS vtec_obs_time_idx ON vtec_obs (time DESC);
"""

# ── SQLite schema ─────────────────────────────────────────────────────────────
_SQLITE_DDL = """
CREATE TABLE IF NOT EXISTS vtec_obs (
    time           TEXT    NOT NULL,
    station        TEXT    NOT NULL,
    constellation  TEXT    NOT NULL,
    prn            TEXT    NOT NULL,
    tecg_tecu      REAL,
    tecp_tecu      REAL,
    stec_tecu      REAL,
    vtec_tecu      REAL,
    elevation_deg  REAL,
    cnr_dbhz       REAL,
    tec_method     TEXT,
    bias_method    TEXT
);
CREATE INDEX IF NOT EXISTS vtec_obs_station_time
    ON vtec_obs (station, time);
CREATE INDEX IF NOT EXISTS vtec_obs_time_idx
    ON vtec_obs (time);
"""


class TecDB:
    """
    Unified VTEC database client.

    Connect with Supabase/PostgreSQL:
        TecDB(dsn="postgresql://postgres:pass@db.project.supabase.co:5432/postgres")
    or simply:
        TecDB()           # uses SUPABASE_DATABASE_URL/DATABASE_URL, or SQLite fallback
    """

    def __init__(self, dsn: str | None = None):
        # Resolve DSN at construction time so env bootstrap in main/collector
        # is visible (module-level default would freeze a pre-bootstrap empty DSN).
        self._dsn = database_dsn() if dsn is None else dsn
        self._is_pg = bool(self._dsn)
        self._conn = None
        self._init()

    # ── Initialisation ────────────────────────────────────────────────────────

    def _init(self) -> None:
        if self._is_pg:
            self._init_pg()
        else:
            self._init_sqlite()
        label = database_backend_label(self._dsn) if self._is_pg else f"SQLite:{_SQLITE_PATH}"
        log.info("TecDB ready (%s)", label)

    def _init_pg(self) -> None:
        global _PG_SCHEMA_READY
        try:
            import psycopg2
            self._conn = psycopg2.connect(self._dsn)
            if os.getenv("VERCEL") or os.getenv("ZGIIS_SKIP_DB_SCHEMA_INIT") == "1":
                # Production schema is provisioned by migrations. Running DDL
                # through the serverless pooler delays requests and can also
                # block the external live collector when it loads Vercel's
                # production environment.
                _PG_SCHEMA_READY = True
                return
            if _PG_SCHEMA_READY:
                # Schema (DDL/audit-columns/hypertable/index) was already
                # ensured once by an earlier TecDB() instance in this
                # process. Re-running that full sequence on every single
                # instantiation (this class has no connection pooling —
                # every call site does a fresh TecDB()) turns any Supabase
                # pooler slowness into request-time latency that compounds
                # across every DB-backed endpoint. Just connect.
                return
            with self._conn.cursor() as cur:
                cur.execute(_PG_DDL)
            self._conn.commit()
            self._ensure_vtec_obs_audit_columns()
            try:
                with self._conn.cursor() as cur:
                    cur.execute(_PG_HYPER)
                self._conn.commit()
            except Exception as exc:
                self._conn.rollback()
                log.warning("Postgres hypertable setup skipped: %s", exc)
            with self._conn.cursor() as cur:
                cur.execute(_PG_IDX)
            self._conn.commit()
            _PG_SCHEMA_READY = True
        except ImportError:
            log.error("psycopg2 not installed — pip install psycopg2-binary")
            self._is_pg = False
            self._init_sqlite()
        except Exception as exc:
            log.error("Postgres init failed: %s - falling back to SQLite", exc)
            self._is_pg = False
            self._init_sqlite()

    @property
    def backend(self) -> str:
        if not self._is_pg:
            return "sqlite"
        return "supabase" if "supabase" in self._dsn.lower() else "postgres"

    def _init_sqlite(self) -> None:
        global _SHARED_SQLITE_CONN
        with _SQLITE_WRITE_LOCK:
            if _SHARED_SQLITE_CONN is not None:
                self._conn = _SHARED_SQLITE_CONN
                self._ensure_vtec_obs_audit_columns()
                return
            try:
                _SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
                self._conn = sqlite3.connect(
                    str(_SQLITE_PATH),
                    check_same_thread=False,
                    timeout=_SQLITE_CONNECT_TIMEOUT_SEC,
                )
            except (OSError, sqlite3.OperationalError):
                # Read-only filesystem (e.g. Vercel) — fall back to an ephemeral
                # temp-dir database rather than crashing the request.
                fallback = Path(tempfile.gettempdir()) / _SQLITE_PATH.name
                self._conn = sqlite3.connect(
                    str(fallback),
                    check_same_thread=False,
                    timeout=_SQLITE_CONNECT_TIMEOUT_SEC,
                )
            _configure_sqlite(self._conn)
            self._conn.executescript(_SQLITE_DDL)
            self._conn.commit()
            self._ensure_vtec_obs_audit_columns()
            _SHARED_SQLITE_CONN = self._conn

    def _ensure_vtec_obs_audit_columns(self) -> None:
        columns = {
            "tecg_tecu": "DOUBLE PRECISION" if self._is_pg else "REAL",
            "tecp_tecu": "DOUBLE PRECISION" if self._is_pg else "REAL",
            "tec_method": "TEXT",
            "bias_method": "TEXT",
        }
        try:
            if self._is_pg:
                with self._conn.cursor() as cur:
                    for name, sql_type in columns.items():
                        cur.execute(f"ALTER TABLE vtec_obs ADD COLUMN IF NOT EXISTS {name} {sql_type}")
                self._conn.commit()
                return

            existing = {
                str(row[1])
                for row in self._conn.execute("PRAGMA table_info(vtec_obs)").fetchall()
            }
            for name, sql_type in columns.items():
                if name not in existing:
                    self._conn.execute(f"ALTER TABLE vtec_obs ADD COLUMN {name} {sql_type}")
            self._conn.commit()
        except Exception as exc:
            # Without a rollback, a failed statement here leaves the
            # connection's transaction aborted, so every later statement in
            # _init_pg() (e.g. the hypertable/index setup) fails immediately
            # with "current transaction is aborted" instead of the real
            # error, and _init_pg()'s own broad except then treats THAT as
            # a fresh failure — cascading one transient error into the
            # entire schema-setup sequence failing.
            try:
                self._conn.rollback()
            except Exception:
                pass
            log.debug("vtec_obs audit-column migration skipped: %s", exc)

    # ── Write ─────────────────────────────────────────────────────────────────

    def insert_vtec(self, records: list[dict]) -> int:
        """Bulk-insert VTEC records. Returns count inserted."""
        global _SHARED_SQLITE_CONN
        if not records:
            return 0

        rows = [
            (
                (r["epoch"].isoformat()
                 if isinstance(r["epoch"], datetime) else str(r["epoch"])),
                r.get("station", ""),
                r.get("constellation", "GPS"),
                r.get("prn", ""),
                r.get("tecg_tecu"),
                r.get("tecp_tecu"),
                r.get("stec_tecu"),
                r.get("vtec_tecu"),
                r.get("elevation_deg"),
                r.get("cnr_dbhz"),
                r.get("tec_method"),
                r.get("bias_method"),
            )
            for r in records
        ]

        sql = """
        INSERT INTO vtec_obs
            (time, station, constellation, prn, tecg_tecu, tecp_tecu, stec_tecu, vtec_tecu,
             elevation_deg, cnr_dbhz, tec_method, bias_method)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        if self._is_pg:
            try:
                pg_sql = sql.replace("?", "%s")
                with self._conn.cursor() as cur:
                    cur.executemany(pg_sql, rows)
                self._conn.commit()
                return len(rows)
            except Exception as exc:
                log.warning("insert_vtec failed (%s)", exc)
                try:
                    self._conn.rollback()
                except Exception:
                    pass
                self._is_pg = False
                self._init_sqlite()
                return self.insert_vtec(records)

        last_exc: Exception | None = None
        for attempt in range(_SQLITE_INSERT_ATTEMPTS):
            try:
                with _SQLITE_WRITE_LOCK:
                    if self._conn is None or (
                        _SHARED_SQLITE_CONN is not None and self._conn is not _SHARED_SQLITE_CONN
                    ):
                        self._conn = _SHARED_SQLITE_CONN
                    if self._conn is None:
                        self._init_sqlite()
                    self._conn.execute("BEGIN IMMEDIATE")
                    try:
                        self._conn.executemany(sql, rows)
                        self._conn.commit()
                    except Exception:
                        self._conn.rollback()
                        raise
                return len(rows)
            except Exception as exc:
                last_exc = exc
                try:
                    if self._conn is not None:
                        self._conn.rollback()
                except Exception:
                    pass
                if attempt < _SQLITE_INSERT_ATTEMPTS - 1:
                    # Never close the shared SQLite handle on insert errors —
                    # other NTRIP/API threads still use it (closing caused segfaults).
                    time.sleep(0.05 * (2 ** attempt))
                    continue
                log.warning("insert_vtec failed (%s)", exc)
                break

        if last_exc is not None:
            log.warning("insert_vtec gave up after %d attempt(s) (%s)", _SQLITE_INSERT_ATTEMPTS, last_exc)
        return 0

    def _read_sql(self, sql: str, params: list | tuple) -> pd.DataFrame:
        """Run a parameterised SELECT without pandas mangling LIKE '%' wildcards.

        ``pd.read_sql_query`` treats ``%code_live%`` as a pyformat specifier
        (``%c``), which raises SQLite ``bad parameter or other API misuse`` and
        drops live NTRIP VTEC from the map and station cards.
        """
        if self._is_pg:
            return pd.read_sql(sql, self._conn, params=list(params))
        with _SQLITE_WRITE_LOCK:
            if self._conn is None:
                self._init_sqlite()
            elif _SHARED_SQLITE_CONN is not None and self._conn is not _SHARED_SQLITE_CONN:
                # Prefer the live shared handle after another writer re-bound it.
                self._conn = _SHARED_SQLITE_CONN
            cur = self._conn.cursor()
            cur.execute(sql, tuple(params))
            cols = [d[0] for d in cur.description] if cur.description else []
            rows = cur.fetchall()
            return pd.DataFrame.from_records(rows, columns=cols)

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
        try:
            if self._is_pg:
                sql = sql.replace("?", "%s")
            return self._read_sql(sql, params)
        except Exception as exc:
            # Never block map/station endpoints forever on a locked SQLite file.
            log.warning("query_recent failed (%s)", exc)
            return pd.DataFrame()

    def query_prn_observations(
        self,
        hours: float = 168.0,
        station: Optional[str] = None,
        constellation: Optional[str] = None,
        prns: Optional[list[str]] = None,
        elev_min: float = 0.0,
        limit: int = 10000,
    ) -> pd.DataFrame:
        """Per-satellite VTEC rows from the live database (excludes empty PRNs)."""
        since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
        clauses = ["time >= ?", "prn IS NOT NULL", "prn != ''", "UPPER(prn) != 'ALL'"]
        params: list = [since]
        if station:
            clauses.append("LOWER(station) = LOWER(?)")
            params.append(station)
        if constellation:
            clauses.append("UPPER(constellation) = UPPER(?)")
            params.append(constellation)
        if elev_min > 0:
            clauses.append("(elevation_deg IS NULL OR elevation_deg >= ?)")
            params.append(elev_min)
        if prns:
            placeholders = ", ".join(["?"] * len(prns))
            clauses.append(f"prn IN ({placeholders})")
            params.extend(prns)

        sql = (
            f"SELECT time AS timestamp, station, constellation, prn, "
            f"tecg_tecu, tecp_tecu, stec_tecu AS stec, vtec_tecu AS vtec, "
            f"elevation_deg, cnr_dbhz, tec_method, bias_method "
            f"FROM vtec_obs WHERE {' AND '.join(clauses)} "
            f"ORDER BY time DESC LIMIT ?"
        )
        params.append(int(limit))
        if self._is_pg:
            sql = sql.replace("?", "%s")
        df = self._read_sql(sql, params)
        if df.empty:
            return df
        return df.sort_values("timestamp").reset_index(drop=True)

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
        """Mean/max VTEC and observation count per station over last N hours.

        Aggregates in SQL so map/station endpoints do not pull hundreds of
        thousands of raw observation rows into pandas on every refresh.
        """
        since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
        sql = """
        SELECT station,
               AVG(vtec_tecu) AS mean_vtec,
               MAX(vtec_tecu) AS max_vtec,
               COUNT(*) AS obs_count
        FROM vtec_obs
        WHERE time >= ?
          AND vtec_tecu IS NOT NULL
          AND vtec_tecu > 0
          AND (tec_method IS NULL OR tec_method NOT LIKE 'dlr_%')
        GROUP BY station
        """
        try:
            if self._is_pg:
                sql = sql.replace("?", "%s")
            return self._read_sql(sql, [since])
        except Exception as exc:
            log.warning("station_summary failed (%s)", exc)
            return pd.DataFrame(columns=["station", "mean_vtec", "max_vtec", "obs_count"])

    def recent_station_vtec(
        self,
        *,
        minutes: float = 10.0,
        code_live_only: bool = True,
    ) -> pd.DataFrame:
        """Latest live NTRIP VTEC per station from a short lookback.

        Uses a robust per-station median (MAD spike clip) instead of AVG so
        one bad PRN cannot push Gokwe/similar sites to 100+ TECU while peers
        stay near 15–25 TECU.
        """
        since = (datetime.now(tz=timezone.utc) - timedelta(minutes=max(0.25, float(minutes)))).isoformat()
        if self._is_pg:
            method_clause = " AND tec_method LIKE '%%code_live%%'" if code_live_only else ""
            sql = f"""
            SELECT time, station, prn, vtec_tecu
            FROM vtec_obs
            WHERE time >= %s
              AND vtec_tecu IS NOT NULL
              AND vtec_tecu > 0
              AND vtec_tecu < 200
              AND (tec_method IS NULL OR tec_method NOT LIKE 'dlr_%%')
              {method_clause}
            """
            params: list = [since]
        else:
            method_clause = " AND tec_method LIKE '%code_live%'" if code_live_only else ""
            sql = f"""
            SELECT time, station, prn, vtec_tecu
            FROM vtec_obs
            WHERE time >= ?
              AND vtec_tecu IS NOT NULL
              AND vtec_tecu > 0
              AND vtec_tecu < 200
              AND (tec_method IS NULL OR tec_method NOT LIKE 'dlr_%')
              {method_clause}
            """
            params = [since]
        try:
            raw = self._read_sql(sql, params)
        except Exception as exc:
            log.warning("recent_station_vtec failed (%s)", exc)
            return pd.DataFrame(columns=["station", "mean_vtec", "obs_count"])

        if raw.empty and code_live_only:
            return self.recent_station_vtec(minutes=minutes, code_live_only=False)
        if raw.empty:
            return pd.DataFrame(columns=["station", "mean_vtec", "obs_count"])

        from zgiis.maps.heatmap_data import _fresh_station_vtec_from_group

        rows: list[dict] = []
        work = raw.copy()
        work["station"] = work["station"].astype(str).str.lower().str.rstrip("_")
        for code, group in work.groupby("station"):
            vtec = _fresh_station_vtec_from_group(group)
            if vtec is None:
                continue
            rows.append(
                {
                    "station": str(code),
                    "mean_vtec": float(vtec),
                    "obs_count": int(len(group)),
                }
            )
        return pd.DataFrame(rows, columns=["station", "mean_vtec", "obs_count"])

    def station_mean_vtec(self, hours: float = 2.0) -> dict[str, float]:
        """Fast station → mean VTEC map for CORS markers / heat-map overlays."""
        summary = self.station_summary(hours=hours)
        if summary is None or getattr(summary, "empty", True):
            return {}
        out: dict[str, float] = {}
        for _, row in summary.iterrows():
            code = str(row["station"]).lower().rstrip("_")
            try:
                mean = float(row["mean_vtec"])
            except (TypeError, ValueError):
                continue
            if math.isfinite(mean) and mean > 0:
                out[code] = round(mean, 2)
        return out

    def station_vtec_timeseries_binned(
        self,
        hours: float = 6.0,
        resample_minutes: int = 2,
        *,
        code_live_only: bool = True,
    ) -> pd.DataFrame:
        """Per-station live NTRIP VTEC time series, aggregated in SQL.

        Dashboard charts previously called ``query_recent(hours=6)`` and
        resampled in pandas — with continuous NTRIP ingest that loads
        hundreds of thousands of PRN samples and stalls the API. Binning in
        SQL keeps Observed (NTRIP) charts responsive.
        """
        since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
        step = max(1, int(resample_minutes))
        # Absolute code TEC from the live NTRIP pipeline (not DLR/archive).
        # Postgres uses %s params — escape LIKE wildcards as %%.
        if self._is_pg:
            method_clause = (
                " AND tec_method LIKE '%%code_live%%'" if code_live_only else ""
            )
            sql = f"""
            SELECT station,
                   to_timestamp(
                     floor(extract(epoch FROM time) / %s) * %s
                   ) AT TIME ZONE 'UTC' AS bucket,
                   AVG(vtec_tecu) AS vtec_tecu,
                   COUNT(*) AS obs_count
            FROM vtec_obs
            WHERE time >= %s
              AND vtec_tecu IS NOT NULL
              AND vtec_tecu > 0
              AND vtec_tecu < 200
              AND (tec_method IS NULL OR tec_method NOT LIKE 'dlr_%%')
              {method_clause}
            GROUP BY station, bucket
            ORDER BY station, bucket
            """
            params = [float(step * 60), float(step * 60), since]
        else:
            method_clause = (
                " AND tec_method LIKE '%code_live%'" if code_live_only else ""
            )
            # SQLite stores ISO timestamps; bucket via unix epoch seconds.
            sql = f"""
            SELECT station,
                   strftime(
                     '%Y-%m-%dT%H:%M:00Z',
                     (CAST(strftime('%s', time) AS INTEGER) / ?) * ?,
                     'unixepoch'
                   ) AS bucket,
                   AVG(vtec_tecu) AS vtec_tecu,
                   COUNT(*) AS obs_count
            FROM vtec_obs
            WHERE time >= ?
              AND vtec_tecu IS NOT NULL
              AND vtec_tecu > 0
              AND vtec_tecu < 200
              AND (tec_method IS NULL OR tec_method NOT LIKE 'dlr_%')
              {method_clause}
            GROUP BY station, bucket
            ORDER BY station, bucket
            """
            params = [step * 60, step * 60, since]

        try:
            df = self._read_sql(sql, params)
        except Exception as exc:
            log.warning("station_vtec_timeseries_binned failed (%s)", exc)
            return pd.DataFrame(columns=["station", "bucket", "vtec_tecu", "obs_count"])

        if df.empty and code_live_only:
            # Fall back once if code TEC has not started yet (elevation/ephemeris warm-up).
            return self.station_vtec_timeseries_binned(
                hours=hours,
                resample_minutes=resample_minutes,
                code_live_only=False,
            )
        return df

    def record_count(self, *, hours: float | None = None) -> int:
        """Total rows in the database, optionally limited to the last N hours."""
        if hours is None:
            cur = self._conn.cursor()
            cur.execute("SELECT COUNT(*) FROM vtec_obs")
            return int(cur.fetchone()[0])
        since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
        sql = "SELECT COUNT(*) FROM vtec_obs WHERE time >= ?"
        if self._is_pg:
            sql = sql.replace("?", "%s")
        cur = self._conn.cursor()
        cur.execute(sql, (since,))
        return int(cur.fetchone()[0])

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
        global _SHARED_SQLITE_CONN
        if not self._conn:
            return
        # Shared SQLite handle is process-wide — do not close it from one client.
        if not self._is_pg and self._conn is _SHARED_SQLITE_CONN:
            return
        self._conn.close()
        self._conn = None
