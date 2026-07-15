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


def _finite_float(value: object) -> float | None:
    try:
        val = float(value)
    except (TypeError, ValueError):
        return None
    return val if pd.notna(val) else None


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _roti_level(roti: float | None) -> str | None:
    if roti is None:
        return None
    if roti < 0.2:
        return "quiet"
    if roti < 0.5:
        return "mild"
    if roti < 1.0:
        return "moderate"
    return "strong"


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
    if "cnr_dbhz" in work.columns:
        work["cnr_dbhz"] = pd.to_numeric(work["cnr_dbhz"], errors="coerce")
    if "s4" in work.columns:
        work["s4"] = pd.to_numeric(work["s4"], errors="coerce")

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


def add_ionosphere_indicators(df: pd.DataFrame) -> pd.DataFrame:
    """
    Add GNSS disturbance metrics from per-station/per-PRN observations.

    ROT is computed in TECU/minute, ROTI is the 5-minute rolling standard
    deviation of ROT, and cycle slips are inferred from sharp STEC/VTEC
    discontinuities when receiver lock-time flags are not available.
    """
    if df.empty or "prn" not in df.columns or "timestamp" not in df.columns:
        return df

    work = df.copy()
    work["timestamp"] = pd.to_datetime(work["timestamp"], utc=True, errors="coerce")
    work = work[work["timestamp"].notna()].copy()
    if work.empty:
        return work

    if "station" not in work.columns:
        work["station"] = ""
    for col in ("vtec", "stec", "quality", "elevation_deg", "s4", "cnr_dbhz"):
        if col in work.columns:
            work[col] = pd.to_numeric(work[col], errors="coerce")

    work = work.sort_values(["station", "prn", "timestamp"]).copy()
    keys = ["station", "prn"]
    dt_min = work.groupby(keys)["timestamp"].diff().dt.total_seconds() / 60.0
    tec_source = "vtec" if "vtec" in work.columns else "stec" if "stec" in work.columns else None
    if tec_source is not None:
        dtec = work.groupby(keys)[tec_source].diff()
        valid_dt = (dt_min > 0) & (dt_min <= 10)
        work["rot_tecu_per_min"] = (dtec / dt_min).where(valid_dt)
    else:
        work["rot_tecu_per_min"] = pd.NA

    roti_parts: list[pd.Series] = []
    for _, group in work.groupby(keys, sort=False):
        rot = group.set_index("timestamp")["rot_tecu_per_min"].astype(float)
        roti = rot.rolling("5min", min_periods=2).std().reindex(group["timestamp"]).reset_index(drop=True)
        roti.index = group.index
        roti_parts.append(roti)
    if roti_parts:
        work["roti_tecu_per_min"] = pd.concat(roti_parts).sort_index()
    else:
        work["roti_tecu_per_min"] = pd.NA

    if "stec" in work.columns:
        jump = work.groupby(keys)["stec"].diff().abs()
        slip_flag = (jump > 20.0) & (dt_min > 0) & (dt_min <= 2)
    elif tec_source is not None:
        jump = work.groupby(keys)[tec_source].diff().abs()
        slip_flag = (jump > 10.0) & (dt_min > 0) & (dt_min <= 2)
    else:
        slip_flag = pd.Series(False, index=work.index)
    if "rot_tecu_per_min" in work.columns:
        slip_flag = slip_flag | (work["rot_tecu_per_min"].abs() > 10.0)
    work["cycle_slip_flag"] = slip_flag.fillna(False).astype(bool)

    if "cnr_dbhz" in work.columns:
        cnr_parts: list[pd.Series] = []
        for _, group in work.groupby(keys, sort=False):
            cnr = group.set_index("timestamp")["cnr_dbhz"].astype(float)
            cnr_std = cnr.rolling("5min", min_periods=2).std().reindex(group["timestamp"]).reset_index(drop=True)
            cnr_std.index = group.index
            cnr_parts.append(cnr_std)
        work["cnr_std_dbhz_5min"] = pd.concat(cnr_parts).sort_index() if cnr_parts else pd.NA
    else:
        work["cnr_std_dbhz_5min"] = pd.NA

    roti = pd.to_numeric(work.get("roti_tecu_per_min"), errors="coerce").fillna(0.0)
    s4 = pd.to_numeric(work["s4"], errors="coerce").fillna(0.0) if "s4" in work.columns else pd.Series(0.0, index=work.index)
    cnr_std = pd.to_numeric(work.get("cnr_std_dbhz_5min"), errors="coerce").fillna(0.0)
    quality = pd.to_numeric(work["quality"], errors="coerce").fillna(100.0) if "quality" in work.columns else pd.Series(100.0, index=work.index)
    elevation = pd.to_numeric(work["elevation_deg"], errors="coerce").fillna(45.0) if "elevation_deg" in work.columns else pd.Series(45.0, index=work.index)

    work["scintillation_proxy"] = ((s4 * 100.0) + (cnr_std * 8.0)).clip(lower=0.0, upper=100.0)
    low_elevation_penalty = (25.0 - elevation).clip(lower=0.0) * 0.5
    work["gnss_integrity_score"] = (
        100.0
        - (roti * 30.0).clip(upper=40.0)
        - (s4 * 40.0).clip(upper=30.0)
        - (cnr_std * 5.0).clip(upper=20.0)
        - ((100.0 - quality).clip(lower=0.0) * 0.25)
        - low_elevation_penalty
        - work["cycle_slip_flag"].astype(float) * 10.0
    ).clip(lower=0.0, upper=100.0)
    work["position_error_cm"] = (
        2.0
        + roti * 8.0
        + s4 * 20.0
        + cnr_std * 1.2
        + (100.0 - quality).clip(lower=0.0) * 0.05
        + low_elevation_penalty * 0.4
        + work["cycle_slip_flag"].astype(float) * 2.5
    ).clip(lower=2.0, upper=150.0)
    work["ppp_convergence_min"] = (
        18.0
        + roti * 22.0
        + s4 * 30.0
        + cnr_std * 1.5
        + (100.0 - quality).clip(lower=0.0) * 0.08
        + work["cycle_slip_flag"].astype(float) * 4.0
    ).clip(lower=15.0, upper=120.0)

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
    return add_ionosphere_indicators(df.sort_values("timestamp").tail(limit))


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
        return add_ionosphere_indicators(_normalize_obs_df(df))
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
    return add_ionosphere_indicators(work.sort_values("timestamp").tail(limit))


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
    has_roti = "roti_tecu_per_min" in df.columns and df["roti_tecu_per_min"].notna().any()
    has_s4 = "s4" in df.columns and df["s4"].notna().any()
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
        "has_roti": bool(has_roti),
        "has_s4": bool(has_s4),
        "time_start": str(t_min) if t_min is not None and pd.notna(t_min) else None,
        "time_end": str(t_max) if t_max is not None and pd.notna(t_max) else None,
        "message": None,
    }


def aggregate_prn_rows(df: pd.DataFrame) -> list[dict[str, Any]]:
    if df.empty or "prn" not in df.columns:
        return []
    df = add_ionosphere_indicators(df)
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
    if "roti_tecu_per_min" in df.columns:
        agg["mean_roti"] = ("roti_tecu_per_min", "mean")
        agg["max_roti"] = ("roti_tecu_per_min", "max")
    if "cycle_slip_flag" in df.columns:
        agg["cycle_slip_count"] = ("cycle_slip_flag", "sum")
    if "s4" in df.columns:
        agg["mean_s4"] = ("s4", "mean")
        agg["max_s4"] = ("s4", "max")
    if "cnr_std_dbhz_5min" in df.columns:
        agg["cnr_std_dbhz"] = ("cnr_std_dbhz_5min", "mean")
    if "gnss_integrity_score" in df.columns:
        agg["integrity_score"] = ("gnss_integrity_score", "mean")
    if "position_error_cm" in df.columns:
        agg["position_error_cm"] = ("position_error_cm", "mean")
    if "ppp_convergence_min" in df.columns:
        agg["ppp_convergence_min"] = ("ppp_convergence_min", "mean")

    grouped = df.groupby(grp_keys).agg(**agg).reset_index()
    rows: list[dict[str, Any]] = []
    for _, r in grouped.iterrows():
        max_roti = _finite_float(r.get("max_roti"))
        rows.append({
            "prn": str(r["prn"]),
            "constellation": str(r["constellation"]),
            "mean_vtec": float(r["mean_vtec"]) if pd.notna(r.get("mean_vtec")) else None,
            "max_vtec": float(r["max_vtec"]) if pd.notna(r.get("max_vtec")) else None,
            "mean_stec": float(r["mean_stec"]) if "mean_stec" in r and pd.notna(r["mean_stec"]) else None,
            "mean_elevation": float(r["mean_elevation"]) if "mean_elevation" in r and pd.notna(r["mean_elevation"]) else None,
            "mean_qual": float(r["mean_qual"]) if "mean_qual" in r and pd.notna(r["mean_qual"]) else None,
            "mean_roti": _finite_float(r.get("mean_roti")),
            "max_roti": max_roti,
            "roti_level": _roti_level(max_roti),
            "cycle_slip_count": int(r["cycle_slip_count"]) if "cycle_slip_count" in r and pd.notna(r["cycle_slip_count"]) else 0,
            "mean_s4": _finite_float(r.get("mean_s4")),
            "max_s4": _finite_float(r.get("max_s4")),
            "cnr_std_dbhz": _finite_float(r.get("cnr_std_dbhz")),
            "integrity_score": _finite_float(r.get("integrity_score")),
            "position_error_cm": _finite_float(r.get("position_error_cm")),
            "ppp_convergence_min": _finite_float(r.get("ppp_convergence_min")),
            "samples": int(r["samples"]) if pd.notna(r.get("samples")) else None,
        })
    return sorted(rows, key=lambda x: (x["constellation"], x["prn"]))
