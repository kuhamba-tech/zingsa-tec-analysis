"""Per-PRN observation loader — live TecDB, CMN files, and archive fallback."""
from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any

import pandas as pd

log = logging.getLogger(__name__)

_CONST_PREFIX = {
    "GPS": "G",
    "Galileo": "E",
    "BeiDou": "C",
    "GLONASS": "R",
}
_PREFIX_CONST = {v: k for k, v in _CONST_PREFIX.items()}

_ROOT = Path(__file__).resolve().parents[2]


def format_prn(prn: object, constellation: str | None = None) -> str | None:
    """Normalise RINEX-style PRN (G01, E12) from numeric or prefixed values."""
    if prn is None or (isinstance(prn, float) and pd.isna(prn)):
        return None
    raw = str(prn).strip().upper()
    if not raw or raw in {"ALL", "NAN", "NONE"}:
        return None
    if raw[0] in _PREFIX_CONST:
        try:
            return f"{raw[0]}{int(raw[1:]):02d}"
        except ValueError:
            return raw
    prefix = _CONST_PREFIX.get(constellation or "GPS", "G")
    try:
        return f"{prefix}{int(float(raw)):02d}"
    except ValueError:
        return raw


def constellation_for_prn(prn: str) -> str:
    if not prn:
        return "GPS"
    return _PREFIX_CONST.get(prn[0].upper(), "GPS")


def _quality_from_row(cnr: float | None, s4: float | None) -> float | None:
    if cnr is not None and pd.notna(cnr):
        return float(min(100.0, max(0.0, (cnr - 25.0) / 30.0 * 100.0)))
    if s4 is not None and pd.notna(s4):
        return float(min(100.0, max(0.0, (1.0 - s4) * 100.0)))
    return None


def _normalize_obs_df(df: pd.DataFrame, default_constellation: str | None = None) -> pd.DataFrame:
    if df.empty:
        return df
    work = df.copy()
    if "timestamp" not in work.columns and "time" in work.columns:
        work["timestamp"] = pd.to_datetime(work["time"], utc=True, errors="coerce")
    elif "timestamp" in work.columns:
        work["timestamp"] = pd.to_datetime(work["timestamp"], utc=True, errors="coerce")

    if "elevation_deg" not in work.columns and "elevation" in work.columns:
        work["elevation_deg"] = pd.to_numeric(work["elevation"], errors="coerce")
    if "vtec" not in work.columns and "vtec_tecu" in work.columns:
        work["vtec"] = pd.to_numeric(work["vtec_tecu"], errors="coerce")
    if "stec" not in work.columns and "stec_tecu" in work.columns:
        work["stec"] = pd.to_numeric(work["stec_tecu"], errors="coerce")
    if "azimuth_deg" not in work.columns and "az" in work.columns:
        work["azimuth_deg"] = pd.to_numeric(work["az"], errors="coerce")

    if "constellation" not in work.columns:
        work["constellation"] = default_constellation or "GPS"
    work["constellation"] = work["constellation"].astype(str)

    const_series = work["constellation"] if "constellation" in work.columns else None
    work["prn"] = [
        format_prn(p, const_series.iloc[i] if const_series is not None else default_constellation)
        for i, p in enumerate(work.get("prn", pd.Series(dtype=object)))
    ]
    work = work[work["prn"].notna()].copy()
    work["constellation"] = work["prn"].map(constellation_for_prn)

    cnr = work["cnr_dbhz"] if "cnr_dbhz" in work.columns else pd.Series([None] * len(work))
    s4 = work["s4"] if "s4" in work.columns else pd.Series([None] * len(work))
    if "quality" not in work.columns:
        work["quality"] = [
            _quality_from_row(
                cnr.iloc[i] if i < len(cnr) else None,
                s4.iloc[i] if i < len(s4) else None,
            )
            for i in range(len(work))
        ]

    return work


def _cmn_source_roots() -> list[Path]:
    roots: list[Path] = []
    env = os.getenv("ZGIIS_CMN_SOURCE", "").strip()
    if env:
        roots.append(Path(env))
    for candidate in (
        _ROOT / "static" / "data" / "cmn",
        _ROOT / "data" / "cmn",
        _ROOT.parent / "cmn",
    ):
        if candidate.is_dir():
            roots.append(candidate)
    return roots


def _cmn_files_in_range(start: pd.Timestamp | None, end: pd.Timestamp | None) -> list[Path]:
    files: list[Path] = []
    for root in _cmn_source_roots():
        for path in sorted({*root.rglob("*.Cmn"), *root.rglob("*.cmn")}):
            if "zgiis_outputs" in path.parts or "tec_python_outputs" in path.parts:
                continue
            match = re.search(r"(20\d{2}-\d{2}-\d{2})", path.stem)
            if match:
                file_date = pd.Timestamp(match.group(1), tz="UTC")
                if start is not None and file_date < start.normalize().tz_convert("UTC"):
                    continue
                if end is not None and file_date > end.normalize().tz_convert("UTC"):
                    continue
            files.append(path)
    return files


def load_cmn_prn_observations(
    *,
    start: str | None = None,
    end: str | None = None,
    station: str | None = None,
    constellation: str | None = None,
    prns: list[str] | None = None,
    elev_min: float = 0.0,
    limit: int = 10000,
) -> pd.DataFrame:
    """Load per-PRN rows from processed .Cmn files on disk."""
    try:
        from tec_core import TecConfig, read_cmn_file
    except ImportError:
        return pd.DataFrame()

    start_ts = pd.Timestamp(start, tz="UTC") if start else None
    end_ts = pd.Timestamp(end, tz="UTC") if end else None
    files = _cmn_files_in_range(start_ts, end_ts)
    if not files:
        return pd.DataFrame()

    config = TecConfig(elevation_min_deg=max(0.0, elev_min))
    frames: list[pd.DataFrame] = []
    for path in files:
        try:
            frame = read_cmn_file(path, config)
        except Exception as exc:
            log.debug("CMN read failed %s: %s", path, exc)
            continue
        if frame.empty:
            continue
        if station and str(frame["station"].iloc[0]).lower() != station.lower():
            continue
        frames.append(frame)
        if sum(len(f) for f in frames) >= limit * 2:
            break

    if not frames:
        return pd.DataFrame()

    df = pd.concat(frames, ignore_index=True)
    df = _normalize_obs_df(df)
    if constellation:
        df = df[df["constellation"].str.upper() == constellation.upper()]
    if prns:
        wanted = {format_prn(p) for p in prns if format_prn(p)}
        df = df[df["prn"].isin(wanted)]
    if elev_min > 0 and "elevation_deg" in df.columns:
        df = df[df["elevation_deg"] >= elev_min]
    if start_ts is not None:
        df = df[df["timestamp"] >= start_ts]
    if end_ts is not None:
        df = df[df["timestamp"] <= end_ts + pd.Timedelta(days=1)]
    return df.sort_values("timestamp").tail(limit)


def load_live_prn_observations(
    *,
    hours: float = 168.0,
    station: str | None = None,
    constellation: str | None = None,
    prns: list[str] | None = None,
    elev_min: float = 0.0,
    limit: int = 10000,
) -> pd.DataFrame:
    try:
        from zgiis.db.timescale import TecDB
    except ImportError:
        return pd.DataFrame()

    try:
        db = TecDB()
        df = db.query_prn_observations(
            hours=hours,
            station=station,
            constellation=constellation,
            prns=prns,
            elev_min=elev_min,
            limit=limit,
        )
        db.close()
        return _normalize_obs_df(df)
    except Exception as exc:
        log.debug("Live PRN query failed: %s", exc)
        return pd.DataFrame()


def load_archive_prn_observations(
    *,
    station: str | None = None,
    constellation: str | None = None,
    start: str | None = None,
    end: str | None = None,
    limit: int = 10000,
) -> pd.DataFrame:
    try:
        from zgiis.data.tec_archive import load_historical_tec
        df, _ = load_historical_tec()
    except Exception:
        return pd.DataFrame()
    if df.empty:
        return pd.DataFrame()

    work = df.copy()
    if "prn" in work.columns:
        work = work[~work["prn"].astype(str).str.upper().isin({"ALL", "NAN", ""})]
    if work.empty:
        return pd.DataFrame()

    work = _normalize_obs_df(work)
    if station and "station" in work.columns:
        work = work[work["station"].str.lower() == station.lower()]
    if constellation:
        work = work[work["constellation"].str.upper() == constellation.upper()]
    if "timestamp" in work.columns:
        work["timestamp"] = pd.to_datetime(work["timestamp"], utc=True, errors="coerce")
        if start:
            work = work[work["timestamp"] >= pd.Timestamp(start, tz="UTC")]
        if end:
            work = work[work["timestamp"] <= pd.Timestamp(end, tz="UTC") + pd.Timedelta(days=1)]
    return work.sort_values("timestamp").tail(limit)


def load_prn_observations(
    *,
    hours: float = 168.0,
    station: str | None = None,
    constellation: str | None = None,
    prns: list[str] | None = None,
    elev_min: float = 20.0,
    start: str | None = None,
    end: str | None = None,
    limit: int = 10000,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    """
    Merge per-PRN sources: live pipeline → CMN folder → archive (non-ALL only).
    Returns (dataframe, metadata).
    """
    live = load_live_prn_observations(
        hours=hours,
        station=station,
        constellation=constellation,
        prns=prns,
        elev_min=elev_min,
        limit=limit,
    )
    if not live.empty:
        meta = _build_meta(live, "live")
        return live, meta

    cmn = load_cmn_prn_observations(
        start=start,
        end=end,
        station=station,
        constellation=constellation,
        prns=prns,
        elev_min=elev_min,
        limit=limit,
    )
    if not cmn.empty:
        meta = _build_meta(cmn, "cmn")
        return cmn, meta

    archive = load_archive_prn_observations(
        station=station,
        constellation=constellation,
        start=start,
        end=end,
        limit=limit,
    )
    if not archive.empty:
        meta = _build_meta(archive, "archive")
        return archive, meta

    return pd.DataFrame(), {
        "source": "none",
        "record_count": 0,
        "stations": [],
        "prns": [],
        "has_azimuth": False,
        "has_elevation": False,
        "has_quality": False,
        "message": (
            "No per-satellite PRN data found. Run the live NTRIP pipeline, place "
            "processed .Cmn files under ZGIIS_CMN_SOURCE, or process RINEX/CMN in Processing."
        ),
    }


def _build_meta(df: pd.DataFrame, source: str) -> dict[str, Any]:
    stations = sorted(df["station"].dropna().astype(str).unique().tolist()) if "station" in df.columns else []
    prns = sorted(df["prn"].dropna().astype(str).unique().tolist()) if "prn" in df.columns else []
    has_az = "azimuth_deg" in df.columns and df["azimuth_deg"].notna().any()
    has_el = "elevation_deg" in df.columns and df["elevation_deg"].notna().any()
    has_q = "quality" in df.columns and df["quality"].notna().any()
    t_min = df["timestamp"].min() if "timestamp" in df.columns and not df.empty else None
    t_max = df["timestamp"].max() if "timestamp" in df.columns and not df.empty else None
    return {
        "source": source,
        "record_count": int(len(df)),
        "stations": stations,
        "prns": prns,
        "has_azimuth": bool(has_az),
        "has_elevation": bool(has_el),
        "has_quality": bool(has_q),
        "time_start": str(t_min) if t_min is not None and pd.notna(t_min) else None,
        "time_end": str(t_max) if t_max is not None and pd.notna(t_max) else None,
        "message": None,
    }


def aggregate_prn_rows(df: pd.DataFrame) -> list[dict[str, Any]]:
    if df.empty or "prn" not in df.columns:
        return []
    grp_keys = ["prn", "constellation"]
    agg: dict[str, tuple[str, str]] = {
        "mean_vtec": ("vtec", "mean"),
        "max_vtec": ("vtec", "max"),
        "samples": ("vtec", "count"),
    }
    if "stec" in df.columns:
        agg["mean_stec"] = ("stec", "mean")
    if "elevation_deg" in df.columns:
        agg["mean_elevation"] = ("elevation_deg", "mean")
    if "quality" in df.columns:
        agg["mean_qual"] = ("quality", "mean")

    grouped = df.groupby(grp_keys).agg(**agg).reset_index()
    rows: list[dict[str, Any]] = []
    for _, r in grouped.iterrows():
        rows.append({
            "prn": str(r["prn"]),
            "constellation": str(r["constellation"]),
            "mean_vtec": float(r["mean_vtec"]) if pd.notna(r.get("mean_vtec")) else None,
            "max_vtec": float(r["max_vtec"]) if pd.notna(r.get("max_vtec")) else None,
            "mean_stec": float(r["mean_stec"]) if "mean_stec" in r and pd.notna(r["mean_stec"]) else None,
            "mean_elevation": float(r["mean_elevation"]) if "mean_elevation" in r and pd.notna(r["mean_elevation"]) else None,
            "mean_qual": float(r["mean_qual"]) if "mean_qual" in r and pd.notna(r["mean_qual"]) else None,
            "samples": int(r["samples"]) if pd.notna(r.get("samples")) else None,
        })
    return sorted(rows, key=lambda x: (x["constellation"], x["prn"]))
