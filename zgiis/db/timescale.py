"""VTEC observation database on Supabase Postgres."""
from __future__ import annotations

import logging
import hashlib
import math
import os
import threading
from datetime import datetime, timezone, timedelta
from typing import Optional

import pandas as pd

from zgiis.db.config import (
    DatabaseUnavailable,
    checkout,
    database_backend_label,
    database_dsn,
    reconnect_after_error,
    release,
    schema_init_enabled,
    transaction,
)

log = logging.getLogger(__name__)

# Set once the first TecDB() in this process has confirmed the Postgres
# schema (DDL, audit columns, indexes) exists, so later instances skip
# re-running it — see _init_pg().
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
_PG_IDX = """
CREATE INDEX IF NOT EXISTS vtec_obs_station_time ON vtec_obs (station, time DESC);
CREATE INDEX IF NOT EXISTS vtec_obs_time_idx ON vtec_obs (time DESC);
"""


class TecDB:
    """VTEC client for Supabase Postgres.

    ``TecDB()`` uses ``database_dsn()``. Pass ``dsn=`` to point at another
    Supabase database (tests). An empty DSN is an error.
    """

    def __init__(self, dsn: str | None = None):
        # Resolve DSN at construction time so env bootstrap in main/collector
        # is visible (module-level default would freeze a pre-bootstrap empty DSN).
        self._dsn = database_dsn() if dsn is None else dsn
        self._is_pg = False
        self._conn = None
        # One pooled socket. Dashboard reads must take turns or a second
        # request fails the first and the card reports no measurements.
        self._io_lock = threading.Lock()
        self._init()

    def _init(self) -> None:
        if not self._dsn:
            log.error("SUPABASE_DATABASE_URL is not configured")
            raise DatabaseUnavailable("SUPABASE_DATABASE_URL is not configured")
        self._init_pg()
        log.info("TecDB ready (%s)", database_backend_label(self._dsn))

    def _init_pg(self) -> None:
        global _PG_SCHEMA_READY
        try:
            import psycopg2  # noqa: F401 — surface a clear error when the driver is missing
            previous = self._conn
            self._conn = None
            if previous is not None:
                release(previous, close=True)
            self._conn = checkout(self._dsn)
            self._is_pg = True
            if not schema_init_enabled():
                # scripts/init_supabase_schema.py owns DDL. An ALTER TABLE here
                # waits forever behind idle-in-transaction readers.
                _PG_SCHEMA_READY = True
                return
            if _PG_SCHEMA_READY:
                # Schema (DDL, audit columns, indexes) was already
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
            with self._conn.cursor() as cur:
                cur.execute(_PG_IDX)
                cur.execute(
                    """
                    CREATE INDEX IF NOT EXISTS vtec_obs_code_live_time_station
                    ON vtec_obs (time, station)
                    WHERE tec_method LIKE 'code_live%'
                      AND vtec_tecu > 0
                      AND vtec_tecu < 200
                    """
                )
            self._conn.commit()
            _PG_SCHEMA_READY = True
        except ImportError:
            log.error("psycopg2 not installed — pip install psycopg2-binary")
            raise DatabaseUnavailable("psycopg2 is not installed") from None
        except DatabaseUnavailable:
            raise
        except Exception as exc:
            log.error("Supabase Postgres init failed: %s", exc)
            raise DatabaseUnavailable("Supabase Postgres init failed") from exc

    @property
    def backend(self) -> str:
        return "supabase"

    def _ensure_vtec_obs_audit_columns(self) -> None:
        columns = {
            "tecg_tecu": "DOUBLE PRECISION",
            "tecp_tecu": "DOUBLE PRECISION",
            "tec_method": "TEXT",
            "bias_method": "TEXT",
            "observation_id": "TEXT",
            "stored_at": "TEXT",
            "received_at": "TEXT",
            "station_latitude": "DOUBLE PRECISION",
            "station_longitude": "DOUBLE PRECISION",
            "ipp_latitude": "DOUBLE PRECISION",
            "ipp_longitude": "DOUBLE PRECISION",
            "region": "TEXT",
            "quality_flag": "TEXT",
            "processing_version": "TEXT",
            "data_source": "TEXT",
        }
        try:
            with self._conn.cursor() as cur:
                for name, sql_type in columns.items():
                    cur.execute(f"ALTER TABLE vtec_obs ADD COLUMN IF NOT EXISTS {name} {sql_type}")
            self._conn.commit()
            with self._conn.cursor() as cur:
                cur.execute("CREATE UNIQUE INDEX IF NOT EXISTS vtec_obs_identity ON vtec_obs (time, observation_id)")
            self._conn.commit()
        except Exception as exc:
            # Without a rollback, a failed statement here leaves the
            # connection's transaction aborted, so every later statement in
            # _init_pg() fails immediately with "current transaction is aborted".
            try:
                self._conn.rollback()
            except Exception:
                pass
            log.debug("vtec_obs audit-column migration skipped: %s", exc)

    # ── Write ─────────────────────────────────────────────────────────────────

    def insert_vtec(self, records: list[dict]) -> int:
        """Bulk-insert VTEC records. Returns count inserted."""
        if not records:
            return 0

        from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
        from zgiis.processing.north_south_tec_research import zimbabwe_lat_band
        catalog = {s.code.lower().rstrip('_'): s for s in ZIMBABWE_CORS_STATIONS}
        records = [dict(r) for r in records]
        for r in records:
            stamp = r['epoch']
            if isinstance(stamp, str):
                stamp = datetime.fromisoformat(stamp.replace('Z', '+00:00'))
            r['epoch'] = stamp.replace(tzinfo=timezone.utc) if stamp.tzinfo is None else stamp.astimezone(timezone.utc)
            r['station'] = str(r.get('station', '')).lower().rstrip('_')
            r.setdefault('constellation', 'GPS')
            st = catalog.get(r['station'])
            r['station_latitude'] = st.lat if st else None
            r['station_longitude'] = st.lon if st else None
            r['region'] = zimbabwe_lat_band(st.lat) if st else None

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
                hashlib.sha256("|".join(str(r.get(k, "")) for k in ("epoch", "station", "constellation", "prn", "tec_method")).encode()).hexdigest(),
                datetime.now(timezone.utc).isoformat(),
                r.get('received_at'), r.get('station_latitude'), r.get('station_longitude'),
                r.get('ipp_latitude'), r.get('ipp_longitude'), r.get('region'),
                r.get('quality_flag'), r.get('processing_version'),
                'NTRIP' if 'code_live' in str(r.get('tec_method','')) else r.get('data_source'),
            )
            for r in records
        ]

        def _write() -> int:
            from psycopg2.extras import execute_values

            insert_sql = """
            INSERT INTO vtec_obs
                (time, station, constellation, prn, tecg_tecu, tecp_tecu, stec_tecu, vtec_tecu,
                 elevation_deg, cnr_dbhz, tec_method, bias_method, observation_id, stored_at,
                 received_at, station_latitude, station_longitude, ipp_latitude, ipp_longitude,
                 region, quality_flag, processing_version, data_source)
            VALUES %s
            ON CONFLICT (time, observation_id) DO NOTHING
            """
            with transaction(self._conn):
                with self._conn.cursor() as cur:
                    execute_values(cur, insert_sql, rows, page_size=500)
            return len(rows)

        for attempt in range(2):
            if self._conn is None or getattr(self._conn, "closed", 1):
                self._conn = reconnect_after_error(self._conn) if self._conn is not None else checkout(self._dsn)
            try:
                return _write()
            except Exception as exc:
                log.warning("insert_vtec failed (%s)", exc)
                try:
                    if self._conn is not None:
                        self._conn.rollback()
                except Exception:
                    pass
                self._conn = reconnect_after_error(self._conn)
                if attempt == 0 and self._conn is not None:
                    continue
                raise RuntimeError("VTEC write failed; retain pending observations for retry") from exc
        raise RuntimeError("VTEC write failed; retain pending observations for retry")

    def _ensure_conn(self):
        """Replace a closed pooled connection before the next statement."""
        if self._conn is None or getattr(self._conn, "closed", 1):
            self._conn = (
                reconnect_after_error(self._conn) if self._conn is not None else checkout(self._dsn)
            )
        if self._conn is None or getattr(self._conn, "closed", 1):
            raise DatabaseUnavailable("Supabase Postgres connection is closed")

    def _read_sql(self, sql: str, params: list | tuple) -> pd.DataFrame:
        """Run a parameterised SELECT without pandas mangling LIKE '%' wildcards.

        ``pd.read_sql`` treats ``%code_live%`` as a pyformat specifier
        (``%c``) unless the caller already escaped percent signs.
        A dropped Supabase socket is replaced once and the read is retried.
        """
        with self._io_lock:
            return self._read_sql_locked(sql, params)

    def _read_sql_locked(self, sql: str, params: list | tuple) -> pd.DataFrame:
        last_exc: Exception | None = None
        for attempt in range(2):
            self._ensure_conn()
            try:
                return pd.read_sql(sql, self._conn, params=list(params))
            except Exception as exc:
                last_exc = exc
                log.warning("TecDB read failed (%s)", exc)
                try:
                    if self._conn is not None:
                        self._conn.rollback()
                except Exception:
                    pass
                self._conn = reconnect_after_error(self._conn)
                if attempt == 0 and self._conn is not None:
                    continue
                raise
        if last_exc is not None:
            raise last_exc
        raise DatabaseUnavailable("Supabase Postgres connection is closed")

    def _fetchone(self, sql: str, params: tuple | list = ()) -> tuple:
        with self._io_lock:
            last_exc: Exception | None = None
            for attempt in range(2):
                self._ensure_conn()
                try:
                    with self._conn.cursor() as cur:
                        cur.execute(sql, params)
                        row = cur.fetchone()
                    return row if row is not None else (0,)
                except Exception as exc:
                    last_exc = exc
                    log.warning("TecDB query failed (%s)", exc)
                    try:
                        if self._conn is not None:
                            self._conn.rollback()
                    except Exception:
                        pass
                    self._conn = reconnect_after_error(self._conn)
                    if attempt == 0 and self._conn is not None:
                        continue
                    raise
            if last_exc is not None:
                raise last_exc
            raise DatabaseUnavailable("Supabase Postgres connection is closed")

    # ── Read ──────────────────────────────────────────────────────────────────

    def query_recent(
        self,
        hours: float = 24.0,
        station: Optional[str] = None,
        constellation: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> pd.DataFrame:
        """VTEC observations from the last N hours.

        When ``limit`` is set, only the newest N rows are returned (then sorted
        ascending). Live charts/comparisons must pass a limit — unbounded
        SELECT * over hours of NTRIP ingest can exceed hundreds of thousands
        of rows and stall the API worker.
        """
        since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
        clauses = ["time >= ?"]
        params: list = [since]
        if station:
            clauses.append("station = ?")
            params.append(station)
        if constellation:
            clauses.append("constellation = ?")
            params.append(constellation)

        where = " AND ".join(clauses)
        if limit is not None and int(limit) > 0:
            # Newest-first limit, then restore chronological order for consumers.
            sql = (
                f"SELECT * FROM ("
                f"SELECT * FROM vtec_obs WHERE {where} ORDER BY time DESC LIMIT ?"
                f") AS recent ORDER BY time"
            )
            params.append(int(limit))
        else:
            sql = f"SELECT * FROM vtec_obs WHERE {where} ORDER BY time"
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
        if "tec_method" in df.columns:
            method = df["tec_method"].astype(str)
            df = df.loc[~method.str.startswith("dlr_")].copy()
        if df.empty:
            return pd.Series(dtype=float, name="vtec_tecu")
        # Live rows mix ``...:00+00:00`` and fractional-second ISO stamps.
        df["time"] = pd.to_datetime(df["time"], utc=True, format="ISO8601")
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
        allow_method_fallback: bool = True,
    ) -> pd.DataFrame:
        """Latest live NTRIP VTEC per station from a short lookback.

        Uses a robust per-station median (MAD spike clip) instead of AVG so
        one bad PRN cannot push Gokwe/similar sites to 100+ TECU while peers
        stay near 15–25 TECU.
        """
        now = datetime.now(tz=timezone.utc)
        since = (now - timedelta(minutes=max(0.25, float(minutes)))).isoformat()
        # Allow a little GNSS clock skew ahead of wall time; reject far-future
        # rows that otherwise become the "latest" fresh-slice anchor.
        until = (now + timedelta(minutes=2)).isoformat()
        if self._is_pg:
            method_clause = " AND tec_method LIKE '%%code_live%%'" if code_live_only else ""
            sql = f"""
            SELECT time, station, prn, vtec_tecu
            FROM vtec_obs
            WHERE time >= %s
              AND time <= %s
              AND vtec_tecu IS NOT NULL
              AND vtec_tecu > 0
              AND vtec_tecu < 200
              AND (tec_method IS NULL OR tec_method NOT LIKE 'dlr_%%')
              {method_clause}
            """
            params: list = [since, until]
        else:
            method_clause = " AND tec_method LIKE '%code_live%'" if code_live_only else ""
            sql = f"""
            SELECT time, station, prn, vtec_tecu
            FROM vtec_obs
            WHERE time >= ?
              AND time <= ?
              AND vtec_tecu IS NOT NULL
              AND vtec_tecu > 0
              AND vtec_tecu < 200
              AND (tec_method IS NULL OR tec_method NOT LIKE 'dlr_%')
              {method_clause}
            """
            params = [since, until]
        try:
            raw = self._read_sql(sql, params)
        except Exception as exc:
            log.warning("recent_station_vtec failed (%s)", exc)
            return pd.DataFrame(columns=["station", "mean_vtec", "obs_count", "observed_at"])

        if raw.empty and code_live_only and allow_method_fallback:
            return self.recent_station_vtec(
                minutes=minutes,
                code_live_only=False,
                allow_method_fallback=False,
            )
        if raw.empty:
            return pd.DataFrame(columns=["station", "mean_vtec", "obs_count", "observed_at"])

        from zgiis.maps.heatmap_data import _fresh_station_vtec_from_group

        rows: list[dict] = []
        work = raw.copy()
        work["station"] = work["station"].astype(str).str.lower().str.rstrip("_")
        for code, group in work.groupby("station"):
            vtec = _fresh_station_vtec_from_group(group)
            if vtec is None:
                continue
            observed_at = None
            if "time" in group.columns:
                times = pd.to_datetime(group["time"], utc=True, errors="coerce").dropna()
                if not times.empty:
                    observed_at = times.max().isoformat().replace("+00:00", "Z")
            rows.append(
                {
                    "station": str(code),
                    "mean_vtec": float(vtec),
                    "obs_count": int(len(group)),
                    "observed_at": observed_at,
                }
            )
        return pd.DataFrame(rows, columns=["station", "mean_vtec", "obs_count", "observed_at"])

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

    def hourly_station_vtec(self, hours: float = 24.0 * 180) -> pd.DataFrame:
        """Hourly mean of live NTRIP code TEC (GOPI) per Zimbabwe station."""
        since = (datetime.now(tz=timezone.utc) - timedelta(hours=max(1.0, float(hours)))).isoformat()
        columns = ["hour", "station", "vtec"]
        if self._is_pg:
            sql = """
            SELECT to_char(time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24') AS hour,
                   station,
                   AVG(vtec_tecu) AS vtec
            FROM vtec_obs
            WHERE time >= %s
              AND vtec_tecu IS NOT NULL
              AND vtec_tecu > 0.5
              AND vtec_tecu < 150
              AND tec_method LIKE '%%code_live%%'
            GROUP BY hour, station
            """
            params: list = [since]
        else:
            sql = """
            SELECT substr(time, 1, 13) AS hour,
                   station,
                   AVG(vtec_tecu) AS vtec
            FROM vtec_obs
            WHERE time >= ?
              AND vtec_tecu IS NOT NULL
              AND vtec_tecu > 0.5
              AND vtec_tecu < 150
              AND tec_method LIKE '%code_live%'
            GROUP BY hour, station
            """
            params = [since]
        try:
            df = self._read_sql(sql, params)
        except Exception as exc:
            log.warning("hourly_station_vtec failed (%s)", exc)
            return pd.DataFrame(columns=columns)
        if df.empty:
            return pd.DataFrame(columns=columns)
        return df

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
        # Matamba and Danskin keep elevation of at least 20° and TEC from 0 to 50.
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
                   MAX(time) AS observed_at,
                   AVG(vtec_tecu) AS vtec_tecu,
                   COUNT(*) AS obs_count
            FROM vtec_obs
            WHERE time >= %s
              AND vtec_tecu IS NOT NULL
              AND vtec_tecu > 0
              AND vtec_tecu <= 50
              AND elevation_deg >= 20
              AND (tec_method IS NULL OR tec_method NOT LIKE 'dlr_%%')
              {method_clause}
            GROUP BY station, bucket
            ORDER BY station, bucket
            """
            params = [float(step * 60), float(step * 60), since]
        try:
            df = self._read_sql(sql, params)
        except Exception as exc:
            log.warning("station_vtec_timeseries_binned failed (%s)", exc)
            return pd.DataFrame(columns=["station", "bucket", "observed_at", "vtec_tecu", "obs_count"])

        if df.empty and code_live_only:
            return self.station_vtec_timeseries_binned(
                hours=hours,
                resample_minutes=resample_minutes,
                code_live_only=False,
            )
        return df

    def record_count(self, *, hours: float | None = None) -> int:
        """Total rows in the database, optionally limited to the last N hours."""
        if hours is None:
            row = self._fetchone("SELECT COUNT(*) FROM vtec_obs")
            return int(row[0])
        since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
        sql = "SELECT COUNT(*) FROM vtec_obs WHERE time >= %s" if self._is_pg else "SELECT COUNT(*) FROM vtec_obs WHERE time >= ?"
        row = self._fetchone(sql, (since,))
        return int(row[0])

    def recent_code_live_count(self, hours: float = 1.0) -> int:
        """Live NTRIP code-TEC rows stored in the last N hours.

        This is the count the dashboard uses to tell a quiet hour from a
        dead reader. It stays on the time index instead of scanning the archive.
        """
        since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
        row = self._fetchone(
            """
            SELECT COUNT(*) FROM vtec_obs
            WHERE time >= %s
              AND tec_method LIKE %s
              AND vtec_tecu > 0
              AND vtec_tecu < 200
            """,
            (since, "%code_live%"),
        )
        return int(row[0])

    def recent_code_live_station_codes(self, hours: float = 0.25) -> list[str]:
        """ZINGSA stations that stored live code TEC in the last N hours."""
        since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
        with self._io_lock:
            self._ensure_conn()
            with self._conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT DISTINCT station FROM vtec_obs
                    WHERE time >= %s
                      AND tec_method LIKE %s
                      AND vtec_tecu > 0
                      AND vtec_tecu < 200
                    """,
                    (since, "%code_live%"),
                )
                rows = cur.fetchall()
        return [str(row[0]).lower().rstrip("_") for row in rows if row and row[0]]

    # ── Housekeeping ──────────────────────────────────────────────────────────

    def prune_older_than(self, days: int = 90) -> int:
        """Delete records older than N days. Returns rows deleted."""
        cutoff = (datetime.now(tz=timezone.utc) - timedelta(days=days)).isoformat()
        # Measured live TEC is the permanent climatology archive. Retention
        # cleanup only applies to other products (forecasts, imports, etc.).
        sql = "DELETE FROM vtec_obs WHERE time < %s AND COALESCE(tec_method, '') NOT LIKE %s"
        with transaction(self._conn):
            with self._conn.cursor() as cur:
                cur.execute(sql, (cutoff, "%code_live%"))
                deleted = cur.rowcount
        return deleted

    def close(self) -> None:
        conn = self._conn
        self._conn = None
        release(conn)

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass

    def newest_live_obs_age_s(self, *, hours: float = 0.25) -> float | None:
        """Age in seconds of the newest live row, without transferring the rows."""
        since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
        sql = """
        SELECT MAX(time)
        FROM vtec_obs
        WHERE time >= %s
          AND position('live' in lower(COALESCE(tec_method, ''))) > 0
        """
        try:
            with self._conn.cursor() as cur:
                cur.execute(sql, (since,))
                row = cur.fetchone()
        except Exception as exc:
            log.warning("newest_live_obs_age_s failed (%s)", exc)
            try:
                self._conn.rollback()
            except Exception:
                pass
            return None
        if not row or row[0] is None:
            return None
        newest = row[0]
        if isinstance(newest, str):
            newest = datetime.fromisoformat(newest.replace("Z", "+00:00"))
        if newest.tzinfo is None:
            newest = newest.replace(tzinfo=timezone.utc)
        return max(0.0, (datetime.now(tz=timezone.utc) - newest).total_seconds())

    def live_station_mean_vtec(self, *, seconds: float = 90.0) -> dict[str, float]:
        """One grouped mean per station for the live station list.

        The station route used to pull every observation in the window and
        average it in Python. The database does that average in one query.
        """
        since = (datetime.now(tz=timezone.utc) - timedelta(seconds=seconds)).isoformat()
        sql = """
        SELECT LOWER(RTRIM(station, '_')) AS station,
               AVG(vtec_tecu) AS mean_vtec
        FROM vtec_obs
        WHERE time >= %s
          AND vtec_tecu IS NOT NULL
          AND position('live' in lower(COALESCE(tec_method, ''))) > 0
          AND lower(COALESCE(tec_method, '')) !~ 'dlr|archive|rinex|cmn'
        GROUP BY 1
        """
        try:
            frame = self._read_sql(sql, [since])
        except Exception as exc:
            log.warning("live_station_mean_vtec failed (%s)", exc)
            try:
                self._conn.rollback()
            except Exception:
                pass
            return {}
        if frame is None or frame.empty:
            return {}
        out: dict[str, float] = {}
        for _, row in frame.iterrows():
            code = str(row["station"] or "").lower().rstrip("_")
            try:
                value = float(row["mean_vtec"])
            except (TypeError, ValueError):
                continue
            if code and math.isfinite(value):
                out[code] = value
        return out

    def network_mean_vtec(self, *, minutes: float = 5.0) -> float | None:
        """Mean of per-station medians over a short code-live window.

        One round trip for the dashboard ionosphere card. Empty when the
        caster has not written in the window, so callers can fall back.
        """
        now = datetime.now(tz=timezone.utc)
        since = (now - timedelta(minutes=max(0.25, float(minutes)))).isoformat()
        until = (now + timedelta(minutes=2)).isoformat()
        sql = """
        SELECT AVG(med) FROM (
            SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY vtec_tecu) AS med
            FROM vtec_obs
            WHERE time >= %s
              AND time <= %s
              AND vtec_tecu > 1
              AND vtec_tecu <= 55
              AND tec_method LIKE '%%code_live%%'
            GROUP BY LOWER(RTRIM(station, '_'))
        ) AS station_medians
        """
        try:
            with self._conn.cursor() as cur:
                cur.execute(sql, (since, until))
                row = cur.fetchone()
        except Exception as exc:
            log.warning("network_mean_vtec failed (%s)", exc)
            try:
                self._conn.rollback()
            except Exception:
                pass
            return None
        if not row or row[0] is None:
            return None
        try:
            value = float(row[0])
        except (TypeError, ValueError):
            return None
        if not math.isfinite(value) or value <= 1.0:
            return None
        return value
