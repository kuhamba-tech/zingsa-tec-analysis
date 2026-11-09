"""Historical TEC sources for anomaly and climatology analysis.

Two real archives are supported:
1. Live CORS ``vtec_obs`` (preferred) — continuous NTRIP GOPI code-live samples
2. Packaged CMN hourly CSV — older processed RINEX/CMN index

No synthetic TEC is invented. Empty returns mean the source is unavailable.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import pandas as pd

log = logging.getLogger(__name__)

ARCHIVE_INDEX_PATH = (
    Path(__file__).resolve().parents[2]
    / "static"
    / "data"
    / "tec_archive_hourly.csv"
)

# Keep anomaly windows long enough for quiet-time baselines without unbounded scans.
DEFAULT_LIVE_DAYS = 120


def load_historical_tec() -> tuple[pd.DataFrame, dict]:
    """Return packaged CMN-derived hourly TEC observations and provenance."""
    if not ARCHIVE_INDEX_PATH.exists():
        return pd.DataFrame(), {
            "source": "CMN archive index",
            "path": str(ARCHIVE_INDEX_PATH),
            "available": False,
            "kind": "cmn_csv",
        }

    frame = pd.read_csv(ARCHIVE_INDEX_PATH, parse_dates=["timestamp", "date"])
    required = {"timestamp", "date", "station", "vtec"}
    if frame.empty or not required.issubset(frame.columns):
        return pd.DataFrame(), {
            "source": "CMN archive index",
            "path": str(ARCHIVE_INDEX_PATH),
            "available": False,
            "kind": "cmn_csv",
        }

    frame["station"] = frame["station"].astype(str).str.lower()
    frame["constellation"] = frame.get("constellation", "GPS")
    frame["prn"] = frame.get("prn", "ALL")
    metadata = {
        "source": "Processed Zimbabwe CORS CMN observations",
        "path": str(ARCHIVE_INDEX_PATH),
        "available": True,
        "kind": "cmn_csv",
        "stations": sorted(frame["station"].dropna().unique().tolist()),
        "first_date": frame["date"].min(),
        "last_date": frame["date"].max(),
        "observations": int(frame.get("observations", pd.Series(dtype=int)).sum())
        if "observations" in frame.columns
        else int(len(frame)),
        "source_files": int(frame.get("source_file", pd.Series(dtype=str)).nunique())
        if "source_file" in frame.columns
        else 0,
    }
    return frame, metadata


def _normalize_frame(frame: pd.DataFrame) -> pd.DataFrame:
    if frame.empty:
        return pd.DataFrame(columns=["timestamp", "date", "station", "vtec", "observations"])
    work = frame.copy()
    work["timestamp"] = pd.to_datetime(work["timestamp"], utc=True, errors="coerce")
    work = work.dropna(subset=["timestamp", "vtec"])
    work["station"] = work["station"].astype(str).str.lower().str.rstrip("_")
    work["date"] = work["timestamp"].dt.floor("D")
    if "observations" not in work.columns:
        work["observations"] = 1
    work["observations"] = pd.to_numeric(work["observations"], errors="coerce").fillna(1).astype(int)
    work["vtec"] = pd.to_numeric(work["vtec"], errors="coerce")
    work = work.dropna(subset=["vtec"])
    return work[["timestamp", "date", "station", "vtec", "observations"]].reset_index(drop=True)


def load_live_vtec_obs(*, days_back: int = DEFAULT_LIVE_DAYS, db=None) -> tuple[pd.DataFrame, dict]:
    """Load measured GOPI code-live TEC from ``vtec_obs`` as hourly station means."""
    meta: dict[str, Any] = {
        "source": "vtec_obs gopi_eq_4_11_code_live",
        "available": False,
        "kind": "vtec_obs",
        "days_back": days_back,
    }
    try:
        from zgiis.db.timescale import TecDB
        from zgiis.processing.measured_tec import measured_gopi_clause
    except Exception as exc:
        meta["error"] = f"import failed: {exc}"
        return pd.DataFrame(), meta

    own_db = db is None
    connection = db
    try:
        if connection is None:
            connection = TecDB()
        marker = "%s" if getattr(connection, "_is_pg", True) else "?"
        clause, params = measured_gopi_clause(marker, elevation=True)
        end = datetime.now(timezone.utc)
        start = end - timedelta(days=max(7, int(days_back)))
        hour = (
            "date_trunc('hour', time)"
            if getattr(connection, "_is_pg", True)
            else "datetime((strftime('%s', time) / 3600) * 3600, 'unixepoch')"
        )
        sql = f"""
            SELECT LOWER(RTRIM(station, '_')) AS station,
                   {hour} AS timestamp,
                   AVG(vtec_tecu) AS vtec,
                   COUNT(*) AS observations
            FROM vtec_obs
            WHERE time >= {marker} AND time < {marker}
              AND {clause}
            GROUP BY 1, 2
            ORDER BY 2
        """
        frame = connection._read_sql(sql, [start.isoformat(), end.isoformat(), *params])
        normalized = _normalize_frame(frame)
        if normalized.empty:
            meta["error"] = "vtec_obs returned no measured GOPI rows in the requested window"
            return pd.DataFrame(), meta
        meta.update(
            {
                "available": True,
                "stations": sorted(normalized["station"].dropna().unique().tolist()),
                "first_date": normalized["date"].min(),
                "last_date": normalized["date"].max(),
                "observations": int(normalized["observations"].sum()),
                "hours": int(len(normalized)),
            }
        )
        return normalized, meta
    except Exception as exc:
        log.warning("live vtec_obs archive load failed: %s", exc)
        meta["error"] = str(exc)
        return pd.DataFrame(), meta
    finally:
        if own_db and connection is not None:
            try:
                connection.close()
            except Exception:
                pass


def load_anomaly_tec(*, days_back: int = DEFAULT_LIVE_DAYS, db=None) -> tuple[pd.DataFrame, dict]:
    """Preferred anomaly source: live ``vtec_obs``, then packaged CMN CSV."""
    live, live_meta = load_live_vtec_obs(days_back=days_back, db=db)
    if not live.empty:
        return live, live_meta

    cmn, cmn_meta = load_historical_tec()
    if not cmn.empty:
        normalized = _normalize_frame(cmn)
        cmn_meta = {**cmn_meta, "fallback_reason": live_meta.get("error")}
        return normalized, cmn_meta

    return pd.DataFrame(), {
        "source": "none",
        "available": False,
        "kind": "none",
        "live": live_meta,
        "cmn": cmn_meta,
        "error": live_meta.get("error") or cmn_meta.get("error") or "No TEC archive available",
    }
