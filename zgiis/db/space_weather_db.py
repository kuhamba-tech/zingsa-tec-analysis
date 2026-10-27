"""
Space weather operations dashboard — time-series log for correlation analysis.

Stores the eight dashboard metrics together per sample so Kp, Dst, F10.7,
solar wind, S4, GNSS risk, and CORS station counts can be queried and
correlated in one table.

Stored in Supabase Postgres.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import pandas as pd

from zgiis.db.config import (
    DatabaseUnavailable,
    checkout,
    database_backend_label,
    database_dsn,
    release,
    schema_init_enabled,
)

log = logging.getLogger(__name__)


def _zingsa_station_cap() -> int:
    """ZINGSA CORS count. Surveyor General sites are outside this cap."""
    try:
        from zgiis.cors.stations import zingsa_cors_stations

        count = len(zingsa_cors_stations())
    except Exception:
        count = 19
    return count if count > 0 else 19


_GNSS_RISK_SCORES = {
    "Low": 0.0,
    "Moderate": 1.0,
    "High": 2.0,
    "Critical": 3.0,
    "Unavailable": None,
}

_NUMERIC_COLUMNS = [
    "kp",
    "dst",
    "f107",
    "plasma_speed",
    "s4",
    "gnss_risk_score",
    "stations_online",
    "stations_total",
    "mean_vtec",
]

_PG_DDL = """
CREATE TABLE IF NOT EXISTS space_weather_log (
    time              TIMESTAMPTZ      NOT NULL,
    kp                DOUBLE PRECISION,
    kp_condition      TEXT,
    dst               DOUBLE PRECISION,
    f107              DOUBLE PRECISION,
    plasma_speed      DOUBLE PRECISION,
    s4                DOUBLE PRECISION,
    gnss_risk         TEXT,
    gnss_risk_score   DOUBLE PRECISION,
    stations_online   INTEGER,
    stations_total    INTEGER,
    mean_vtec         DOUBLE PRECISION,
    source            TEXT
);
"""
_PG_IDX = "CREATE INDEX IF NOT EXISTS sw_log_time_idx ON space_weather_log (time DESC);"
_TIMELINE_DDL = """
CREATE TABLE IF NOT EXISTS space_weather_timeline (
    metric TEXT NOT NULL,
    time   TIMESTAMPTZ NOT NULL,
    value  DOUBLE PRECISION,
    PRIMARY KEY (metric, time)
);
"""
_TIMELINE_IDX = """
CREATE INDEX IF NOT EXISTS sw_timeline_metric_time_idx
    ON space_weather_timeline (metric, time DESC);
"""


def gnss_risk_to_score(risk: str | None) -> float | None:
    if not risk:
        return None
    return _GNSS_RISK_SCORES.get(risk.strip())


def snapshot_from_sw_dict(sw: dict[str, Any], *, source: str = "api") -> dict[str, Any]:
    """Normalise get_space_weather() output into a log row."""
    risk = sw.get("gnss_risk")
    when = sw.get("updated_utc") or sw.get("timestamp")
    if not when:
        when = datetime.now(tz=timezone.utc).replace(microsecond=0).isoformat()
    return {
        "time": when,
        "kp": sw.get("kp"),
        "kp_condition": sw.get("kp_condition"),
        "dst": sw.get("dst"),
        "f107": sw.get("f107"),
        "plasma_speed": sw.get("solar_wind_speed") or sw.get("plasma_speed"),
        "s4": sw.get("s4"),
        "gnss_risk": risk,
        "gnss_risk_score": gnss_risk_to_score(risk),
        "stations_online": sw.get("stations_online"),
        "stations_total": sw.get("stations_total"),
        "mean_vtec": sw.get("mean_vtec"),
        "source": source,
    }


class SpaceWeatherDB:
    def __init__(self, dsn: str | None = None):
        # Resolve DSN at construction time so Vercel cold starts see env that
        # was loaded after module import.
        self._dsn = database_dsn() if dsn is None else dsn
        self._is_pg = False
        self._conn = None
        if not self._dsn:
            log.error("SUPABASE_DATABASE_URL is not configured")
            raise DatabaseUnavailable("SUPABASE_DATABASE_URL is not configured")
        self._init_pg()
        self._timeline_ready = False
        log.info("SpaceWeatherDB ready (%s)", database_backend_label(self._dsn))

    def _ensure(self) -> None:
        if self._conn is None or getattr(self._conn, "closed", 1):
            self._conn = checkout(self._dsn)

    def _retry(self, fn):
        """Run one database operation, and once more after a dropped connection."""
        self._ensure()
        try:
            return fn()
        except Exception:
            from zgiis.db.config import reconnect_after_error

            self._conn = reconnect_after_error(self._conn)
            if self._conn is None:
                self._conn = checkout(self._dsn)
            return fn()

    def _init_pg(self) -> None:
        try:
            self._conn = checkout(self._dsn)
            self._is_pg = True
            if schema_init_enabled():
                with self._conn.cursor() as cur:
                    cur.execute(_PG_DDL)
                    cur.execute(_PG_IDX)
        except Exception as exc:
            log.error("SpaceWeatherDB Postgres init failed: %s", exc)
            raise DatabaseUnavailable("Supabase Postgres init failed") from exc

    def insert_snapshot(self, row: dict[str, Any]) -> None:
        sql = """
        INSERT INTO space_weather_log (
            time, kp, kp_condition, dst, f107, plasma_speed, s4,
            gnss_risk, gnss_risk_score, stations_online, stations_total,
            mean_vtec, source
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        params = (
            str(row.get("time")),
            row.get("kp"),
            row.get("kp_condition"),
            row.get("dst"),
            row.get("f107"),
            row.get("plasma_speed"),
            row.get("s4"),
            row.get("gnss_risk"),
            row.get("gnss_risk_score"),
            row.get("stations_online"),
            row.get("stations_total"),
            row.get("mean_vtec"),
            row.get("source", "api"),
        )
        def write() -> None:
            if self._is_pg:
                statement = sql.replace("?", "%s")
                with self._conn.cursor() as cur:
                    cur.execute(statement, params)
                self._conn.commit()
            else:
                self._conn.execute(sql, params)
                self._conn.commit()

        self._retry(write)

    def latest_logged_at(self) -> datetime | None:
        """Wall time of the newest snapshot, if the table has one."""
        def read():
            with self._conn.cursor() as cur:
                cur.execute("SELECT time FROM space_weather_log ORDER BY time DESC LIMIT 1")
                row = cur.fetchone()
            return row[0] if row else None

        try:
            value = self._retry(read)
        except Exception as exc:
            log.warning("latest space-weather log time failed: %s", exc)
            return None
        if value is None:
            return None
        if isinstance(value, datetime):
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        text = str(value).replace("Z", "+00:00")
        try:
            parsed = datetime.fromisoformat(text)
        except ValueError:
            return None
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

    def logged_within(self, seconds: float) -> bool:
        """True when a snapshot was stored less than ``seconds`` ago."""
        latest = self.latest_logged_at()
        if latest is None:
            return False
        age = (datetime.now(tz=timezone.utc) - latest).total_seconds()
        return 0 <= age < seconds

    def ensure_timeline_table(self) -> None:
        if self._timeline_ready:
            return

        def create() -> None:
            with self._conn.cursor() as cur:
                cur.execute(_TIMELINE_DDL)
                cur.execute(_TIMELINE_IDX)

        self._retry(create)
        self._timeline_ready = True

    def upsert_timeline(self, rows: list[tuple[str, datetime | str, float]]) -> int:
        """Insert graph samples. The same metric and time keeps the newest value."""
        deduped: dict[tuple[str, str], tuple[str, str, float]] = {}
        for metric, when, value in rows:
            if metric is None or when is None or value is None:
                continue
            try:
                number = float(value)
            except (TypeError, ValueError):
                continue
            stamp = when.isoformat() if isinstance(when, datetime) else str(when)
            if not stamp:
                continue
            deduped[(str(metric), stamp)] = (str(metric), stamp, number)
        payload = list(deduped.values())
        if not payload:
            return 0
        self.ensure_timeline_table()

        def write() -> int:
            from psycopg2.extras import execute_values

            sql = """
            INSERT INTO space_weather_timeline (metric, time, value)
            VALUES %s
            ON CONFLICT (metric, time) DO UPDATE SET value = EXCLUDED.value
            """
            with self._conn.cursor() as cur:
                execute_values(cur, sql, payload, page_size=500)
            self._conn.commit()
            return len(payload)

        return int(self._retry(write))

    def read_timeline_bins(
        self,
        metrics: list[str],
        *,
        since: datetime,
        before: datetime | None = None,
        bin_minutes: int = 15,
    ) -> dict[str, list[tuple[datetime, float]]]:
        """Average stored graph samples into bins so a multi-day chart stays small."""
        names = [str(metric) for metric in metrics if metric]
        if not names:
            return {}
        self.ensure_timeline_table()
        minutes = max(1, int(bin_minutes))

        def read():
            sql = """
            SELECT metric,
                   date_bin(%s, time, TIMESTAMPTZ '2000-01-01') AS bucket,
                   CASE
                     WHEN metric = 'stations_online' THEN
                       percentile_cont(0.5) WITHIN GROUP (ORDER BY value)
                         FILTER (
                           WHERE value >= 2
                             AND value <= %s
                             AND value = trunc(value)
                         )
                     ELSE avg(value)
                   END AS value
            FROM space_weather_timeline
            WHERE metric = ANY(%s)
              AND time >= %s
              AND (%s IS NULL OR time < %s)
            GROUP BY metric, bucket
            ORDER BY metric, bucket
            """
            with self._conn.cursor() as cur:
                cur.execute(
                    sql,
                    (
                        timedelta(minutes=minutes),
                        float(_zingsa_station_cap()),
                        names,
                        since,
                        before,
                        before,
                    ),
                )
                return cur.fetchall()

        try:
            fetched = self._retry(read)
        except Exception as exc:
            log.warning("timeline read failed: %s", exc)
            return {}
        grouped: dict[str, list[tuple[datetime, float]]] = {}
        for metric, bucket, value in fetched:
            if bucket is None or value is None:
                continue
            stamp = bucket if getattr(bucket, "tzinfo", None) else bucket.replace(tzinfo=timezone.utc)
            grouped.setdefault(str(metric), []).append((stamp, float(value)))
        return grouped

    def prune_timeline(self, *, days: int = 90) -> int:
        """Drop graph samples older than the retention window."""
        self.ensure_timeline_table()
        cutoff = datetime.now(tz=timezone.utc) - timedelta(days=max(1, int(days)))

        def delete() -> int:
            with self._conn.cursor() as cur:
                cur.execute("DELETE FROM space_weather_timeline WHERE time < %s", (cutoff,))
                removed = int(cur.rowcount or 0)
            self._conn.commit()
            return removed

        return int(self._retry(delete))

    def query_dataframe(
        self,
        hours: float = 24.0,
        *,
        resample: str | None = None,
    ) -> pd.DataFrame:
        since = (datetime.now(tz=timezone.utc) - timedelta(hours=hours)).isoformat()
        sql = """
        SELECT time, kp, kp_condition, dst, f107, plasma_speed, s4,
               gnss_risk, gnss_risk_score, stations_online, stations_total, mean_vtec
        FROM space_weather_log
        WHERE time >= ?
        ORDER BY time
        """
        if self._is_pg:
            sql = sql.replace("?", "%s")
            df = pd.read_sql(sql, self._conn, params=[since])
        else:
            df = pd.read_sql_query(sql, self._conn, params=[since])

        if df.empty:
            return df

        df["time"] = pd.to_datetime(df["time"], utc=True, errors="coerce")
        df = df.dropna(subset=["time"]).set_index("time").sort_index()

        if resample:
            numeric = [c for c in _NUMERIC_COLUMNS if c in df.columns]
            averaged = df[numeric].resample(resample).mean(numeric_only=True)
            # A station count is not a rate. Averaging a real 14 with a catalog
            # size (19 or 25) draws a peak near 18 that never happened.
            if "stations_online" in averaged.columns:
                cap = _zingsa_station_cap()
                online = df["stations_online"]
                total = df["stations_total"] if "stations_total" in df.columns else None
                plausible = online.where((online >= 2) & (online <= cap))
                # 19/19 and 25/25 are the catalog length, not stations that
                # came online. Averaging those with a real 14 draws a peak
                # near 18.
                if total is not None:
                    plausible = plausible.where(online < total.fillna(cap + 1))
                averaged["stations_online"] = plausible.resample(resample).median()
            df = averaged

        return df.reset_index()

    def correlation_matrix(
        self,
        hours: float = 168.0,
        *,
        resample: str = "1h",
        min_samples: int = 8,
    ) -> dict[str, Any]:
        df = self.query_dataframe(hours=hours, resample=resample)
        cols = [c for c in _NUMERIC_COLUMNS if c in df.columns]
        if df.empty or len(df) < min_samples:
            return {
                "hours": hours,
                "resample": resample,
                "sample_count": int(len(df)),
                "matrix": {},
                "pairs": [],
            }

        numeric = df[cols].apply(pd.to_numeric, errors="coerce")
        corr = numeric.corr(min_periods=min_samples)
        matrix = {
            row: {col: (None if pd.isna(val) else round(float(val), 4)) for col, val in corr.loc[row].items()}
            for row in corr.index
        }

        pairs: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for a in corr.columns:
            for b in corr.columns:
                if a >= b:
                    continue
                key = (a, b)
                if key in seen:
                    continue
                seen.add(key)
                val = corr.loc[a, b]
                if pd.isna(val):
                    continue
                pairs.append({"a": a, "b": b, "r": round(float(val), 4)})
        pairs.sort(key=lambda p: abs(p["r"]), reverse=True)

        return {
            "hours": hours,
            "resample": resample,
            "sample_count": int(len(df)),
            "from": df["time"].iloc[0].isoformat() if "time" in df.columns else None,
            "to": df["time"].iloc[-1].isoformat() if "time" in df.columns else None,
            "matrix": matrix,
            "pairs": pairs,
        }

    def record_count(self) -> int:
        cur = self._conn.cursor()
        cur.execute("SELECT COUNT(*) FROM space_weather_log")
        return int(cur.fetchone()[0])

    def latest_snapshot(self) -> dict[str, Any] | None:
        sql = "SELECT * FROM space_weather_log ORDER BY time DESC LIMIT 1"
        if self._is_pg:
            df = pd.read_sql(sql, self._conn)
        else:
            df = pd.read_sql_query(sql, self._conn)
        if df.empty:
            return None
        return df.iloc[0].to_dict()

    def latest_snapshot_with_vtec(self) -> dict[str, Any] | None:
        """Most recent row that actually carries mean_vtec (skip empty dashboard polls)."""
        sql = """
        SELECT * FROM space_weather_log
        WHERE mean_vtec IS NOT NULL AND mean_vtec > 1
        ORDER BY time DESC LIMIT 1
        """
        if self._is_pg:
            df = pd.read_sql(sql, self._conn)
        else:
            df = pd.read_sql_query(sql, self._conn)
        if df.empty:
            return None
        return df.iloc[0].to_dict()

    def close(self) -> None:
        conn = self._conn
        self._conn = None
        release(conn)

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass
