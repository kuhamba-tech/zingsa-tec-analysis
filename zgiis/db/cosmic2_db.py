"""COSMIC-2 persistence — profile summaries, CORS matches, and calibration
runs. Raw electron-density sample arrays are NOT stored here; the
downloaded tarballs/extracted NetCDF files stay on disk
(static/data/cosmic2_cache/), only per-profile summary values are persisted.

Uses Supabase/PostgreSQL when configured, otherwise SQLite at
static/data/cosmic2.sqlite — same dual-backend pattern as
zgiis/db/tec_intelligence_db.py (the closest real precedent in this repo).

A real pooled Postgres connection in this environment was found to mangle a
non-ASCII character in a persisted text column even with client_encoding
pinned — every text value written by this module must be plain ASCII.
"""
from __future__ import annotations

import logging
import sqlite3
import tempfile
from datetime import date
from pathlib import Path
from typing import Any, Optional

import pandas as pd

from zgiis.db.config import database_backend_label, database_dsn

log = logging.getLogger(__name__)

_TSDB_DSN = database_dsn()
_SQLITE_PATH = Path(__file__).resolve().parents[2] / "static" / "data" / "cosmic2.sqlite"

_PG_DDL = """
CREATE TABLE IF NOT EXISTS cosmic2_profiles (
    profile_id              TEXT NOT NULL,
    day                     DATE NOT NULL,
    occ_time                TIMESTAMPTZ,
    tangent_lat             DOUBLE PRECISION,
    tangent_lon             DOUBLE PRECISION,
    source_file             TEXT,
    quality_status          TEXT NOT NULL,
    quality_reasons         TEXT,
    valid_sample_count      INTEGER,
    nmf2_el_m3              DOUBLE PRECISION,
    hmf2_km                 DOUBLE PRECISION,
    fof2_mhz                DOUBLE PRECISION,
    partial_tec_tecu        DOUBLE PRECISION,
    tec_integration_min_km  DOUBLE PRECISION,
    tec_integration_max_km  DOUBLE PRECISION,
    computed_at             TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cosmic2_profiles_id_uq ON cosmic2_profiles (profile_id);
CREATE INDEX IF NOT EXISTS cosmic2_profiles_day_idx ON cosmic2_profiles (day DESC);
CREATE INDEX IF NOT EXISTS cosmic2_profiles_quality_idx ON cosmic2_profiles (quality_status);

CREATE TABLE IF NOT EXISTS cosmic2_matches (
    profile_id            TEXT NOT NULL,
    day                   DATE NOT NULL,
    station_code          TEXT,
    station_distance_km   DOUBLE PRECISION,
    cors_timestamp        TIMESTAMPTZ,
    cors_vtec_tecu        DOUBLE PRECISION,
    time_delta_minutes    DOUBLE PRECISION,
    match_valid           BOOLEAN NOT NULL DEFAULT FALSE,
    match_quality         TEXT NOT NULL,
    match_reason          TEXT NOT NULL,
    computed_at           TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cosmic2_matches_profile_uq ON cosmic2_matches (profile_id);
CREATE INDEX IF NOT EXISTS cosmic2_matches_day_idx ON cosmic2_matches (day DESC);

CREATE TABLE IF NOT EXISTS cosmic2_calibration_runs (
    start_date      DATE NOT NULL,
    end_date        DATE NOT NULL,
    slope           DOUBLE PRECISION,
    intercept       DOUBLE PRECISION,
    r_squared       DOUBLE PRECISION,
    pearson_r       DOUBLE PRECISION,
    rmse_tecu       DOUBLE PRECISION,
    mae_tecu        DOUBLE PRECISION,
    mean_bias_tecu  DOUBLE PRECISION,
    sample_count    INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL,
    message         TEXT,
    computed_at     TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cosmic2_calibration_range_uq ON cosmic2_calibration_runs (start_date, end_date);
"""

_SQLITE_DDL = """
CREATE TABLE IF NOT EXISTS cosmic2_profiles (
    profile_id              TEXT NOT NULL,
    day                     TEXT NOT NULL,
    occ_time                TEXT,
    tangent_lat             REAL,
    tangent_lon             REAL,
    source_file             TEXT,
    quality_status          TEXT NOT NULL,
    quality_reasons         TEXT,
    valid_sample_count      INTEGER,
    nmf2_el_m3              REAL,
    hmf2_km                 REAL,
    fof2_mhz                REAL,
    partial_tec_tecu        REAL,
    tec_integration_min_km  REAL,
    tec_integration_max_km  REAL,
    computed_at             TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cosmic2_profiles_id_uq ON cosmic2_profiles (profile_id);
CREATE INDEX IF NOT EXISTS cosmic2_profiles_day_idx ON cosmic2_profiles (day);
CREATE INDEX IF NOT EXISTS cosmic2_profiles_quality_idx ON cosmic2_profiles (quality_status);

CREATE TABLE IF NOT EXISTS cosmic2_matches (
    profile_id            TEXT NOT NULL,
    day                   TEXT NOT NULL,
    station_code          TEXT,
    station_distance_km   REAL,
    cors_timestamp        TEXT,
    cors_vtec_tecu        REAL,
    time_delta_minutes    REAL,
    match_valid           INTEGER NOT NULL DEFAULT 0,
    match_quality         TEXT NOT NULL,
    match_reason          TEXT NOT NULL,
    computed_at           TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cosmic2_matches_profile_uq ON cosmic2_matches (profile_id);
CREATE INDEX IF NOT EXISTS cosmic2_matches_day_idx ON cosmic2_matches (day);

CREATE TABLE IF NOT EXISTS cosmic2_calibration_runs (
    start_date      TEXT NOT NULL,
    end_date        TEXT NOT NULL,
    slope           REAL,
    intercept       REAL,
    r_squared       REAL,
    pearson_r       REAL,
    rmse_tecu       REAL,
    mae_tecu        REAL,
    mean_bias_tecu  REAL,
    sample_count    INTEGER NOT NULL DEFAULT 0,
    status          TEXT NOT NULL,
    message         TEXT,
    computed_at     TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cosmic2_calibration_range_uq ON cosmic2_calibration_runs (start_date, end_date);
"""

_PROFILE_COLUMNS = [
    "profile_id", "day", "occ_time", "tangent_lat", "tangent_lon", "source_file",
    "quality_status", "quality_reasons", "valid_sample_count", "nmf2_el_m3", "hmf2_km",
    "fof2_mhz", "partial_tec_tecu", "tec_integration_min_km", "tec_integration_max_km", "computed_at",
]
_MATCH_COLUMNS = [
    "profile_id", "day", "station_code", "station_distance_km", "cors_timestamp", "cors_vtec_tecu",
    "time_delta_minutes", "match_valid", "match_quality", "match_reason", "computed_at",
]
_CALIBRATION_COLUMNS = [
    "start_date", "end_date", "slope", "intercept", "r_squared", "pearson_r", "rmse_tecu",
    "mae_tecu", "mean_bias_tecu", "sample_count", "status", "message", "computed_at",
]


class Cosmic2DB:
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
        label = database_backend_label(self._dsn) if self._is_pg else f"SQLite:{_SQLITE_PATH}"
        log.info("Cosmic2DB ready (%s)", label)

    def _init_pg(self) -> None:
        try:
            import psycopg2

            self._conn = psycopg2.connect(self._dsn)
            self._conn.set_client_encoding("UTF8")
            with self._conn.cursor() as cur:
                cur.execute(_PG_DDL)
            self._conn.commit()
        except Exception as exc:
            log.error("Cosmic2DB Postgres init failed: %s - using SQLite", exc)
            self._is_pg = False
            self._init_sqlite()

    def _init_sqlite(self) -> None:
        try:
            _SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(_SQLITE_PATH), check_same_thread=False)
        except (OSError, sqlite3.OperationalError):
            fallback = Path(tempfile.gettempdir()) / _SQLITE_PATH.name
            self._conn = sqlite3.connect(str(fallback), check_same_thread=False)
        self._conn.executescript(_SQLITE_DDL)
        self._conn.commit()

    @property
    def backend(self) -> str:
        if not self._is_pg:
            return "sqlite"
        return "supabase" if "supabase" in self._dsn.lower() else "postgres"

    def _ph(self) -> str:
        return "%s" if self._is_pg else "?"

    def _read_sql(self, sql: str, params: list[Any]) -> pd.DataFrame:
        return pd.read_sql(sql, self._conn, params=params) if self._is_pg else pd.read_sql_query(sql, self._conn, params=params)

    # ── Write (idempotent: delete-then-insert within one transaction) ──────

    def upsert_profiles(self, rows: list[dict[str, Any]], start: date, end: date) -> int:
        if not rows:
            return 0
        ph = self._ph()
        delete_sql = f"DELETE FROM cosmic2_profiles WHERE day BETWEEN {ph} AND {ph}"
        insert_sql = (
            f"INSERT INTO cosmic2_profiles ({', '.join(_PROFILE_COLUMNS)}) "
            f"VALUES ({', '.join([ph] * len(_PROFILE_COLUMNS))})"
        )
        values = [tuple(r.get(c) for c in _PROFILE_COLUMNS) for r in rows]
        cur = self._conn.cursor()
        try:
            cur.execute(delete_sql, (start.isoformat(), end.isoformat()))
            cur.executemany(insert_sql, values)
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            raise
        return len(rows)

    def upsert_matches(self, rows: list[dict[str, Any]], start: date, end: date) -> int:
        if not rows:
            return 0
        ph = self._ph()
        delete_sql = f"DELETE FROM cosmic2_matches WHERE day BETWEEN {ph} AND {ph}"
        insert_sql = (
            f"INSERT INTO cosmic2_matches ({', '.join(_MATCH_COLUMNS)}) "
            f"VALUES ({', '.join([ph] * len(_MATCH_COLUMNS))})"
        )
        values = [tuple(r.get(c) for c in _MATCH_COLUMNS) for r in rows]
        cur = self._conn.cursor()
        try:
            cur.execute(delete_sql, (start.isoformat(), end.isoformat()))
            cur.executemany(insert_sql, values)
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            raise
        return len(rows)

    def upsert_calibration_run(self, row: dict[str, Any]) -> int:
        ph = self._ph()
        delete_sql = f"DELETE FROM cosmic2_calibration_runs WHERE start_date = {ph} AND end_date = {ph}"
        insert_sql = (
            f"INSERT INTO cosmic2_calibration_runs ({', '.join(_CALIBRATION_COLUMNS)}) "
            f"VALUES ({', '.join([ph] * len(_CALIBRATION_COLUMNS))})"
        )
        values = tuple(row.get(c) for c in _CALIBRATION_COLUMNS)
        cur = self._conn.cursor()
        try:
            cur.execute(delete_sql, (row["start_date"], row["end_date"]))
            cur.execute(insert_sql, values)
            self._conn.commit()
        except Exception:
            self._conn.rollback()
            raise
        return 1

    # ── Read ─────────────────────────────────────────────────────────────

    def query_profiles(self, start: date, end: date, *, quality_status: Optional[str] = None) -> pd.DataFrame:
        ph = self._ph()
        clauses = [f"day BETWEEN {ph} AND {ph}"]
        params: list[Any] = [start.isoformat() if hasattr(start, "isoformat") else str(start),
                              end.isoformat() if hasattr(end, "isoformat") else str(end)]
        if quality_status:
            clauses.append(f"quality_status = {ph}")
            params.append(quality_status)
        sql = f"SELECT * FROM cosmic2_profiles WHERE {' AND '.join(clauses)} ORDER BY occ_time"
        return self._read_sql(sql, params)

    def query_profile(self, profile_id: str) -> Optional[dict[str, Any]]:
        ph = self._ph()
        df = self._read_sql(f"SELECT * FROM cosmic2_profiles WHERE profile_id = {ph}", [profile_id])
        return df.iloc[0].to_dict() if not df.empty else None

    def query_matches(self, start: date, end: date, *, match_quality: Optional[str] = None) -> pd.DataFrame:
        ph = self._ph()
        clauses = [f"day BETWEEN {ph} AND {ph}"]
        params: list[Any] = [start.isoformat() if hasattr(start, "isoformat") else str(start),
                              end.isoformat() if hasattr(end, "isoformat") else str(end)]
        if match_quality:
            clauses.append(f"match_quality = {ph}")
            params.append(match_quality)
        sql = f"SELECT * FROM cosmic2_matches WHERE {' AND '.join(clauses)} ORDER BY day"
        return self._read_sql(sql, params)

    def query_latest_calibration(self, *, start: Optional[date] = None, end: Optional[date] = None) -> Optional[dict[str, Any]]:
        ph = self._ph()
        if start is not None and end is not None:
            df = self._read_sql(
                f"SELECT * FROM cosmic2_calibration_runs WHERE start_date = {ph} AND end_date = {ph}",
                [start.isoformat(), end.isoformat()],
            )
        else:
            df = self._read_sql("SELECT * FROM cosmic2_calibration_runs ORDER BY computed_at DESC LIMIT 1", [])
        return df.iloc[0].to_dict() if not df.empty else None

    def summary_counts(self) -> dict[str, Any]:
        cur = self._conn.cursor()
        cur.execute("SELECT COUNT(*) FROM cosmic2_profiles")
        total_profiles = int(cur.fetchone()[0])
        cur.execute("SELECT COUNT(*) FROM cosmic2_profiles WHERE quality_status = 'ok'")
        total_ok_profiles = int(cur.fetchone()[0])
        cur.execute("SELECT COUNT(*) FROM cosmic2_matches WHERE match_valid = 1" if not self._is_pg
                     else "SELECT COUNT(*) FROM cosmic2_matches WHERE match_valid = TRUE")
        total_valid_matches = int(cur.fetchone()[0])
        cur.execute("SELECT MAX(day) FROM cosmic2_profiles")
        row = cur.fetchone()
        latest_day = str(row[0]) if row and row[0] is not None else None
        return {
            "total_profiles": total_profiles,
            "total_ok_profiles": total_ok_profiles,
            "total_valid_matches": total_valid_matches,
            "latest_profile_day": latest_day,
        }

    def close(self) -> None:
        if self._conn:
            self._conn.close()
