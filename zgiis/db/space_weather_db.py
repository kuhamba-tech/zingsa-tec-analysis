"""
Space weather operations dashboard — time-series log for correlation analysis.

Stores the eight dashboard metrics together per sample so Kp, Dst, F10.7,
solar wind, S4, GNSS risk, and CORS station counts can be queried and
correlated in one table.

Uses TimescaleDB when TSDB_DSN is set, otherwise SQLite at
static/data/space_weather_log.sqlite.
"""
from __future__ import annotations

import logging
import os
import sqlite3
import tempfile
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

import pandas as pd

from pathlib import Path

log = logging.getLogger(__name__)

_TSDB_DSN = os.getenv("TSDB_DSN", "")
_SQLITE_PATH = Path(__file__).resolve().parents[2] / "static" / "data" / "space_weather_log.sqlite"

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
_PG_HYPER = "SELECT create_hypertable('space_weather_log','time',if_not_exists=>TRUE);"
_PG_IDX = "CREATE INDEX IF NOT EXISTS sw_log_time_idx ON space_weather_log (time DESC);"

_SQLITE_DDL = """
CREATE TABLE IF NOT EXISTS space_weather_log (
    time              TEXT    NOT NULL,
    kp                REAL,
    kp_condition      TEXT,
    dst               REAL,
    f107              REAL,
    plasma_speed      REAL,
    s4                REAL,
    gnss_risk         TEXT,
    gnss_risk_score   REAL,
    stations_online   INTEGER,
    stations_total    INTEGER,
    mean_vtec         REAL,
    source            TEXT
);
CREATE INDEX IF NOT EXISTS sw_log_time_idx ON space_weather_log (time);
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
            "SpaceWeatherDB ready (%s)",
            "TimescaleDB" if self._is_pg else f"SQLite:{_SQLITE_PATH}",
        )

    def _init_pg(self) -> None:
        try:
            import psycopg2

            self._conn = psycopg2.connect(self._dsn)
            with self._conn.cursor() as cur:
                cur.execute(_PG_DDL)
                try:
                    cur.execute(_PG_HYPER)
                except Exception:
                    pass
                cur.execute(_PG_IDX)
            self._conn.commit()
        except Exception as exc:
            log.error("SpaceWeatherDB TimescaleDB init failed: %s — using SQLite", exc)
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
        if self._is_pg:
            sql = sql.replace("?", "%s")
            with self._conn.cursor() as cur:
                cur.execute(sql, params)
            self._conn.commit()
        else:
            self._conn.execute(sql, params)
            self._conn.commit()

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
            df = df[numeric].resample(resample).mean(numeric_only=True)

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

    def close(self) -> None:
        if self._conn:
            self._conn.close()
