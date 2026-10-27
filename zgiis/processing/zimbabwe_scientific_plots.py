"""Zimbabwe scientific TEC plots: diurnal bands, seasonal, MODIP transect, quiet/disturbed.

All statistics are computed from measured observations (live CORS and/or the
packaged CMN hourly archive). Missing seasons or regimes are reported explicitly
— values are never invented.
"""
from __future__ import annotations

import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any

import numpy as np
import pandas as pd

from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS, get_station, is_surveyor_general
from zgiis.processing.gg_calibration import approximate_modip_deg

log = logging.getLogger(__name__)

# Geographic N/C/S bands (same as frontend zimbabweLatBands / corsGeneticOptimizer).
NORTH_LAT = -18.2
CENTRAL_LAT = -20.2

SEASON_MARKERS: list[dict[str, Any]] = [
    {"id": "mar_equinox", "label": "March equinox", "doy": 80, "window_days": 15},
    {"id": "jun_solstice", "label": "June solstice", "doy": 172, "window_days": 15},
    {"id": "sep_equinox", "label": "September equinox", "doy": 266, "window_days": 15},
    {"id": "dec_solstice", "label": "December solstice", "doy": 356, "window_days": 15},
]

DIURNAL_HOURS = list(range(24))
QUIET_KP_MAX = 3.0  # Kp < 3 → quiet; Kp ≥ 3 → disturbed (planetary scale)


def _band_for_lat(lat: float) -> str:
    if lat > NORTH_LAT:
        return "northern"
    if lat > CENTRAL_LAT:
        return "central"
    return "southern"


def _station_lat(code: str) -> float | None:
    st = get_station((code or "").lower().rstrip("_"))
    if st is None or not math.isfinite(float(st.lat)):
        return None
    return float(st.lat)


def _quantile(vals: list[float], q: float) -> float | None:
    if not vals:
        return None
    arr = np.asarray(vals, dtype=float)
    arr = arr[np.isfinite(arr)]
    if arr.size == 0:
        return None
    return float(np.quantile(arr, q))


def _hour_bucket(ts: pd.Timestamp) -> int | None:
    """UT hour 0–23. Each hour keeps its own mean."""
    if pd.isna(ts):
        return None
    try:
        hour = int(ts.hour)
    except (TypeError, ValueError):
        return None
    if hour < 0 or hour > 23:
        return None
    return hour


def _hour_start(ts: pd.Timestamp) -> pd.Timestamp | None:
    if pd.isna(ts):
        return None
    try:
        stamp = ts.tz_convert("UTC") if ts.tzinfo else ts.tz_localize("UTC")
    except Exception:
        return None
    return stamp.floor("h")


def _series_band(
    hours: list[int],
    buckets: dict[int, list[float]],
) -> dict[str, list[float | None]]:
    p50: list[float | None] = []
    p25: list[float | None] = []
    p75: list[float | None] = []
    n: list[int] = []
    for h in hours:
        vals = buckets.get(h, [])
        n.append(len(vals))
        if len(vals) < 2:
            # Still report median when a single sample exists; band collapses.
            med = _quantile(vals, 0.5)
            p50.append(med)
            p25.append(med)
            p75.append(med)
            continue
        p50.append(_quantile(vals, 0.5))
        p25.append(_quantile(vals, 0.25))
        p75.append(_quantile(vals, 0.75))
    return {"p50": p50, "p25": p25, "p75": p75, "n": n}


def build_diurnal_latband(live_df: pd.DataFrame) -> dict[str, Any]:
    """Diurnal N/C/S VTEC with IQR bands from live station-binned observations."""
    hours = list(DIURNAL_HOURS)
    empty = {
        "hours": hours,
        "northern": {"p50": [None] * len(hours), "p25": [None] * len(hours), "p75": [None] * len(hours), "n": [0] * len(hours)},
        "central": {"p50": [None] * len(hours), "p25": [None] * len(hours), "p75": [None] * len(hours), "n": [0] * len(hours)},
        "southern": {"p50": [None] * len(hours), "p25": [None] * len(hours), "p75": [None] * len(hours), "n": [0] * len(hours)},
        "station_counts": {"northern": 0, "central": 0, "southern": 0},
        "sample_count": 0,
        "note": "No live station VTEC in the current window.",
    }
    if live_df is None or live_df.empty:
        return empty

    work = live_df.copy()
    work["station"] = work["station"].astype(str).str.lower().str.rstrip("_")
    work["bucket"] = pd.to_datetime(work["bucket"], utc=True, errors="coerce")
    work["vtec_tecu"] = pd.to_numeric(work["vtec_tecu"], errors="coerce")
    work = work.dropna(subset=["bucket", "vtec_tecu"])
    work = work[(work["vtec_tecu"] > 0) & (work["vtec_tecu"] < 120)]
    if work.empty:
        return empty

    band_buckets: dict[str, dict[int, list[float]]] = {
        "northern": {},
        "central": {},
        "southern": {},
    }
    stations_seen: dict[str, set[str]] = {k: set() for k in band_buckets}
    sample_count = 0

    for _, row in work.iterrows():
        lat = _station_lat(str(row["station"]))
        if lat is None or is_surveyor_general(str(row["station"])):
            continue
        band = _band_for_lat(lat)
        tick = _hour_bucket(row["bucket"])
        if tick is None:
            continue
        v = float(row["vtec_tecu"])
        band_buckets[band].setdefault(tick, []).append(v)
        stations_seen[band].add(str(row["station"]))
        sample_count += 1

    return {
        "hours": hours,
        "northern": _series_band(hours, band_buckets["northern"]),
        "central": _series_band(hours, band_buckets["central"]),
        "southern": _series_band(hours, band_buckets["southern"]),
        "station_counts": {k: len(v) for k, v in stations_seen.items()},
        "sample_count": sample_count,
        "uncertainty": "IQR (25th–75th percentile) across station×hour observations in each latitude band",
        "note": (
            "Measured live CORS VTEC (code_live). Each UT hour is its own median; "
            f"latitude bands are N > {NORTH_LAT}°, C > {CENTRAL_LAT}°, else S. "
            "Surveyor General sites are not included."
        ),
    }


def build_seasonal_equinox_solstice() -> dict[str, Any]:
    """Seasonal diurnal composites around equinox/solstice DOYs from CMN archive."""
    from zgiis.data.tec_archive import load_historical_tec

    frame, meta = load_historical_tec()
    seasons: list[dict[str, Any]] = []
    if frame is None or frame.empty or not meta.get("available"):
        return {
            "available": False,
            "seasons": [],
            "archive": meta,
            "note": "CMN hourly archive unavailable — seasonal equinox/solstice composites cannot be formed.",
        }

    work = frame.copy()
    work["timestamp"] = pd.to_datetime(work["timestamp"], utc=True, errors="coerce")
    work["vtec"] = pd.to_numeric(work["vtec"], errors="coerce")
    work = work.dropna(subset=["timestamp", "vtec"])
    work = work[(work["vtec"] > 0) & (work["vtec"] < 150)]
    work["doy"] = work["timestamp"].dt.dayofyear
    work["hour"] = work["timestamp"].dt.hour

    for marker in SEASON_MARKERS:
        doy = int(marker["doy"])
        win = int(marker["window_days"])
        # Handle DOY wrap for Dec solstice
        if doy - win < 1 or doy + win > 366:
            lo = (doy - win) % 366 or 366
            hi = (doy + win) % 366 or 366
            if lo > hi:
                mask = (work["doy"] >= lo) | (work["doy"] <= hi)
            else:
                mask = (work["doy"] >= lo) & (work["doy"] <= hi)
        else:
            mask = (work["doy"] >= doy - win) & (work["doy"] <= doy + win)
        subset = work.loc[mask]
        if subset.empty:
            seasons.append(
                {
                    "id": marker["id"],
                    "label": marker["label"],
                    "doy_center": doy,
                    "window_days": win,
                    "available": False,
                    "hours": list(range(24)),
                    "p50": [None] * 24,
                    "p25": [None] * 24,
                    "p75": [None] * 24,
                    "n": [0] * 24,
                    "stations": [],
                    "date_start": None,
                    "date_end": None,
                    "sample_count": 0,
                    "note": f"No archive observations within ±{win} days of DOY {doy}.",
                }
            )
            continue

        hours = list(range(24))
        buckets: dict[int, list[float]] = {h: [] for h in hours}
        for _, row in subset.iterrows():
            buckets[int(row["hour"])].append(float(row["vtec"]))
        series = _series_band(hours, buckets)
        # Flag partial coverage when observations sit only at the edge of the window.
        doy_vals = subset["doy"].astype(int)
        doy_med = int(doy_vals.median())
        partial = abs(((doy_med - doy + 183) % 366) - 183) > 10
        seasons.append(
            {
                "id": marker["id"],
                "label": marker["label"],
                "doy_center": doy,
                "window_days": win,
                "available": True,
                "partial": partial,
                "hours": hours,
                **series,
                "stations": sorted(subset["station"].astype(str).str.lower().unique().tolist()),
                "date_start": subset["timestamp"].min().isoformat(),
                "date_end": subset["timestamp"].max().isoformat(),
                "sample_count": int(len(subset)),
                "uncertainty": "IQR across hourly CMN archive samples in the DOY window",
                "note": (
                    f"CMN archive {subset['timestamp'].min().date()} → {subset['timestamp'].max().date()} "
                    f"(±{win} d of DOY {doy}); stations {', '.join(sorted(subset['station'].unique()))}."
                    + (" Partial edge coverage — not a full equinox/solstice climatology." if partial else "")
                ),
            }
        )

    available_n = sum(1 for s in seasons if s["available"])
    return {
        "available": available_n > 0,
        "seasons": seasons,
        "archive": {
            "source": meta.get("source"),
            "available": bool(meta.get("available")),
            "stations": meta.get("stations"),
            "first_date": str(meta.get("first_date")),
            "last_date": str(meta.get("last_date")),
        },
        "uncertainty": "IQR (25th–75th percentile) of measured hourly VTEC within each season window",
        "note": (
            f"{available_n}/4 season windows have archive coverage. "
            "Sep equinox / Dec solstice require additional CMN months beyond the packaged Apr–Jun 2024 index."
            if available_n < 4
            else "All four equinox/solstice windows have archive coverage."
        ),
    }


def build_modip_transect(live_df: pd.DataFrame) -> dict[str, Any]:
    """TEC versus approximate MODIP along the Zimbabwe N–S station transect."""
    points: list[dict[str, Any]] = []
    if live_df is not None and not live_df.empty:
        work = live_df.copy()
        work["station"] = work["station"].astype(str).str.lower().str.rstrip("_")
        work["vtec_tecu"] = pd.to_numeric(work["vtec_tecu"], errors="coerce")
        work = work.dropna(subset=["vtec_tecu"])
        work = work[(work["vtec_tecu"] > 0) & (work["vtec_tecu"] < 120)]
        for code, group in work.groupby("station"):
            lat = _station_lat(str(code))
            if lat is None:
                continue
            st = get_station(str(code))
            vals = [float(v) for v in group["vtec_tecu"].tolist() if math.isfinite(float(v))]
            if not vals:
                continue
            modip = approximate_modip_deg(lat, float(st.lon) if st else None)
            points.append(
                {
                    "station": str(code),
                    "name": st.name if st else str(code),
                    "lat": round(lat, 4),
                    "lon": round(float(st.lon), 4) if st else None,
                    "modip_deg": round(modip, 3),
                    "vtec_mean": round(float(np.mean(vals)), 2),
                    "vtec_p25": round(float(_quantile(vals, 0.25) or np.mean(vals)), 2),
                    "vtec_p75": round(float(_quantile(vals, 0.75) or np.mean(vals)), 2),
                    "vtec_std": round(float(np.std(vals)), 2) if len(vals) > 1 else 0.0,
                    "n": len(vals),
                    "band": _band_for_lat(lat),
                }
            )

    points.sort(key=lambda p: p["modip_deg"], reverse=True)

    # Simple linear regression when ≥3 stations
    regression = None
    if len(points) >= 3:
        xs = np.array([p["modip_deg"] for p in points], dtype=float)
        ys = np.array([p["vtec_mean"] for p in points], dtype=float)
        coeffs = np.polyfit(xs, ys, 1)
        yhat = np.polyval(coeffs, xs)
        ss_res = float(np.sum((ys - yhat) ** 2))
        ss_tot = float(np.sum((ys - np.mean(ys)) ** 2)) or 1.0
        r2 = 1.0 - ss_res / ss_tot
        regression = {
            "slope_tecu_per_deg": round(float(coeffs[0]), 4),
            "intercept_tecu": round(float(coeffs[1]), 3),
            "r2": round(float(r2), 4),
            "n": len(points),
        }

    return {
        "points": points,
        "regression": regression,
        "modip_model": {
            "name": "approximate_modip_africa_offset",
            "description": (
                "μ ≈ geographic latitude − 5° (Africa magnetic-equator offset used in live Gg "
                "calibration). Not full IGRF quasi-dipole; labelled as approximate MODIP."
            ),
            "offset_deg": 5.0,
        },
        "uncertainty": "Per-station IQR (p25–p75) of live VTEC samples in the analysis window",
        "note": (
            "North–south transect uses CORS station coordinates (not IPP). "
            f"{len(points)} stations with live VTEC in window."
            if points
            else "No live station VTEC available for the MODIP transect."
        ),
    }


def _kp_lookup(kp_points: list[dict[str, Any]]) -> list[tuple[pd.Timestamp, float]]:
    out: list[tuple[pd.Timestamp, float]] = []
    for p in kp_points or []:
        t = p.get("t") or p.get("time")
        v = p.get("v")
        if t is None or v is None:
            continue
        try:
            ts = pd.to_datetime(t, utc=True)
            fv = float(v)
        except Exception:
            continue
        if pd.isna(ts) or not math.isfinite(fv):
            continue
        out.append((ts, fv))
    out.sort(key=lambda x: x[0])
    return out


def _nearest_kp(ts: pd.Timestamp, kp: list[tuple[pd.Timestamp, float]], max_hours: float = 1.5) -> float | None:
    if not kp:
        return None
    # binary-ish linear scan is fine for ≤500 points
    best = None
    best_dt = None
    for kt, kv in kp:
        dt = abs((ts - kt).total_seconds())
        if best_dt is None or dt < best_dt:
            best_dt = dt
            best = kv
    if best_dt is None or best_dt > max_hours * 3600:
        return None
    return best


def build_quiet_disturbed(
    live_df: pd.DataFrame,
    kp_points: list[dict[str, Any]],
) -> dict[str, Any]:
    """Composite diurnal VTEC under quiet (Kp<3) vs disturbed (Kp≥3) conditions."""
    hours = list(DIURNAL_HOURS)
    empty_series = {"p50": [None] * len(hours), "p25": [None] * len(hours), "p75": [None] * len(hours), "n": [0] * len(hours)}
    base = {
        "hours": hours,
        "quiet": dict(empty_series),
        "disturbed": dict(empty_series),
        "quiet_sample_count": 0,
        "disturbed_sample_count": 0,
        "kp_threshold": QUIET_KP_MAX,
        "available": False,
        "uncertainty": "IQR of live VTEC samples whose nearest Kp is in each regime",
        "note": "Need overlapping live VTEC and Kp timelines.",
    }
    if live_df is None or live_df.empty:
        return base

    kp = _kp_lookup(kp_points)
    if not kp:
        base["note"] = "Kp timeline unavailable — cannot classify quiet vs disturbed TEC."
        return base

    work = live_df.copy()
    work["bucket"] = pd.to_datetime(work["bucket"], utc=True, errors="coerce")
    work["vtec_tecu"] = pd.to_numeric(work["vtec_tecu"], errors="coerce")
    work = work.dropna(subset=["bucket", "vtec_tecu"])
    work = work[(work["vtec_tecu"] > 0) & (work["vtec_tecu"] < 120)]

    quiet_b: dict[int, list[float]] = {}
    dist_b: dict[int, list[float]] = {}
    q_n = d_n = 0
    for _, row in work.iterrows():
        if "station" in work.columns and is_surveyor_general(str(row["station"])):
            continue
        tick = _hour_bucket(row["bucket"])
        if tick is None:
            continue
        kp_v = _nearest_kp(row["bucket"], kp)
        if kp_v is None:
            continue
        v = float(row["vtec_tecu"])
        if kp_v < QUIET_KP_MAX:
            quiet_b.setdefault(tick, []).append(v)
            q_n += 1
        else:
            dist_b.setdefault(tick, []).append(v)
            d_n += 1

    return {
        "hours": hours,
        "quiet": _series_band(hours, quiet_b),
        "disturbed": _series_band(hours, dist_b),
        "quiet_sample_count": q_n,
        "disturbed_sample_count": d_n,
        "kp_threshold": QUIET_KP_MAX,
        "available": q_n > 0 or d_n > 0,
        "uncertainty": "IQR of live VTEC samples classified by nearest NOAA Kp (≤1.5 h)",
        "note": (
            f"Quiet: Kp < {QUIET_KP_MAX:g} ({q_n} samples). "
            f"Disturbed: Kp ≥ {QUIET_KP_MAX:g} ({d_n} samples). "
            + (
                "Disturbed coverage is sparse in this window — bands widen where n is small."
                if d_n < 20
                else "Both regimes have usable sample counts in this window."
            )
        ),
    }


def _merge_archived_kp(kp_points: list[dict] | None) -> list[dict]:
    """Add stored Kp so a TEC hour can still be classed after the NOAA file rolls on."""
    merged = list(kp_points or [])
    try:
        from zgiis.db.space_weather_db import SpaceWeatherDB

        since = datetime.now(tz=timezone.utc) - timedelta(hours=72)
        bins = SpaceWeatherDB().read_timeline_bins(["kp_observed"], since=since, bin_minutes=60)
    except Exception:
        log.debug("archived Kp unavailable for quiet/disturbed hours", exc_info=True)
        return merged
    for stamp, value in bins.get("kp_observed") or []:
        try:
            merged.append({"t": stamp.isoformat(), "v": float(value)})
        except (TypeError, ValueError, AttributeError):
            continue
    return merged


def hourly_percentile_rows(
    live_df: pd.DataFrame,
    kp_points: list[dict] | None,
) -> list[tuple[str, datetime, float | None, float | None, float | None, int]]:
    """One stored row per latitude band or Kp regime and absolute UT hour."""
    if live_df is None or live_df.empty:
        return []
    work = live_df.copy()
    work["bucket"] = pd.to_datetime(work["bucket"], utc=True, errors="coerce")
    work["vtec_tecu"] = pd.to_numeric(work["vtec_tecu"], errors="coerce")
    work = work.dropna(subset=["bucket", "vtec_tecu"])
    work = work[(work["vtec_tecu"] > 0) & (work["vtec_tecu"] < 120)]

    by_band: dict[tuple[str, pd.Timestamp], list[float]] = {}
    quiet_abs: dict[pd.Timestamp, list[float]] = {}
    dist_abs: dict[pd.Timestamp, list[float]] = {}
    kp = _kp_lookup(kp_points or [])
    for _, row in work.iterrows():
        station = str(row["station"]).lower().rstrip("_") if "station" in work.columns else ""
        if station and is_surveyor_general(station):
            continue
        start = _hour_start(row["bucket"])
        if start is None:
            continue
        value = float(row["vtec_tecu"])
        lat = _station_lat(station) if station else None
        band = _band_for_lat(lat) if lat is not None else None
        if band:
            by_band.setdefault((band, start), []).append(value)
        if not kp:
            continue
        kp_v = _nearest_kp(row["bucket"], kp)
        if kp_v is None:
            continue
        if kp_v < QUIET_KP_MAX:
            quiet_abs.setdefault(start, []).append(value)
        else:
            dist_abs.setdefault(start, []).append(value)

    rows: list[tuple[str, datetime, float | None, float | None, float | None, int]] = []

    def _add(series: str, start: pd.Timestamp, vals: list[float]) -> None:
        band = _series_band([0], {0: vals})
        rows.append((series, start.to_pydatetime(), band["p50"][0], band["p25"][0], band["p75"][0], len(vals)))

    for (band, start), vals in by_band.items():
        _add(band, start, vals)
    for start, vals in quiet_abs.items():
        _add("quiet", start, vals)
    for start, vals in dist_abs.items():
        _add("disturbed", start, vals)
    return rows


def persist_hourly_percentiles(live_df: pd.DataFrame, kp_points: list[dict] | None) -> int:
    try:
        from zgiis.db.diurnal_vtec_db import upsert_hours

        return upsert_hours(hourly_percentile_rows(live_df, kp_points))
    except Exception:
        log.debug("hourly VTEC log failed", exc_info=True)
        return 0


def _blank_percentile_series() -> dict[str, Any]:
    return {
        "p50": [None] * len(DIURNAL_HOURS),
        "p25": [None] * len(DIURNAL_HOURS),
        "p75": [None] * len(DIURNAL_HOURS),
        "n": [0] * len(DIURNAL_HOURS),
    }


def _payload_from_stored_day(day: str) -> tuple[dict[str, Any], dict[str, Any]] | None:
    from zgiis.db.diurnal_vtec_db import read_day

    stored = read_day(day)
    if not stored:
        return None
    names = ("northern", "central", "southern", "quiet", "disturbed")
    series_map = {name: _blank_percentile_series() for name in names}
    for series, stamp, p50, p25, p75, n in stored:
        block = series_map.get(series)
        if block is None or p50 is None:
            continue
        when = pd.Timestamp(stamp)
        if when.tzinfo is None:
            when = when.tz_localize("UTC")
        hour = int(when.tz_convert("UTC").hour)
        if hour < 0 or hour > 23:
            continue
        block["p50"][hour] = float(p50)
        block["p25"][hour] = float(p25) if p25 is not None else None
        block["p75"][hour] = float(p75) if p75 is not None else None
        block["n"][hour] = int(n or 0)

    def _total(name: str) -> int:
        return int(sum(series_map[name]["n"]))

    def _with_n(name: str) -> dict[str, Any]:
        return series_map[name]

    diurnal = {
        "hours": DIURNAL_HOURS,
        "northern": _with_n("northern"),
        "central": _with_n("central"),
        "southern": _with_n("southern"),
        "station_counts": {},
        "sample_count": _total("northern") + _total("central") + _total("southern"),
        "uncertainty": "IQR stored with each UT hour from live CORS VTEC.",
        "note": f"Stored hourly medians for {day} UTC. Hours with no row were not observed.",
    }
    quiet_n = _total("quiet")
    disturbed_n = _total("disturbed")
    quiet = {
        "hours": DIURNAL_HOURS,
        "quiet": _with_n("quiet"),
        "disturbed": _with_n("disturbed"),
        "quiet_sample_count": quiet_n,
        "disturbed_sample_count": disturbed_n,
        "kp_threshold": QUIET_KP_MAX,
        "available": bool(quiet_n or disturbed_n),
        "uncertainty": "IQR of live VTEC samples classified by the nearest Kp at the time.",
        "note": (
            f"Stored {day} UTC. Quiet: Kp < {QUIET_KP_MAX:g} ({quiet_n} samples). "
            f"Disturbed: Kp ≥ {QUIET_KP_MAX:g} ({disturbed_n} samples)."
        ),
    }
    return diurnal, quiet


def logged_diurnal_days() -> list[str]:
    try:
        from zgiis.db.diurnal_vtec_db import list_days

        return list_days()
    except Exception:
        log.debug("diurnal day list unavailable", exc_info=True)
        return []


def archive_recent_diurnal_hours(hours: float = 36.0, resample_minutes: int = 15) -> int:
    """Log each UT hour that has measurements. Safe to call when the page is closed."""
    try:
        from zgiis.db.timescale import TecDB

        db = TecDB()
        live_df = db.station_vtec_timeseries_binned(hours=hours, resample_minutes=resample_minutes)
    except Exception:
        log.warning("diurnal archive: live VTEC unavailable", exc_info=True)
        return 0
    return persist_hourly_percentiles(live_df, _merge_archived_kp([]))


def build_zimbabwe_scientific_plots(
    *,
    hours: float = 24.0,
    resample_minutes: int = 15,
    kp_points: list[dict[str, Any]] | None = None,
    day: str | None = None,
) -> dict[str, Any]:
    """Assemble all four scientific plot payloads from live + archive observations."""
    live_df = pd.DataFrame()
    try:
        from backend.live_manager import get_db

        db = get_db()
        if db is not None:
            live_df = db.station_vtec_timeseries_binned(
                hours=float(hours),
                resample_minutes=int(resample_minutes),
                code_live_only=True,
            )
            if live_df is None:
                live_df = pd.DataFrame()
    except Exception:
        log.exception("scientific plots: live station bins failed")
        live_df = pd.DataFrame()

    if kp_points is None:
        kp_points = []
        try:
            from zgiis.space_weather.fetch_indices import _fetch_noaa_kp_history, _parse_kp_value

            for row in _fetch_noaa_kp_history() or []:
                if not isinstance(row, dict):
                    continue
                t = row.get("time_tag") or row.get("time") or row.get("t")
                try:
                    v = _parse_kp_value(row)
                except Exception:
                    v = row.get("kp_index", row.get("kp", row.get("v")))
                if t is None or v is None:
                    continue
                try:
                    fv = float(v)
                except (TypeError, ValueError):
                    continue
                kp_points.append({"t": str(t), "v": fv})
        except Exception:
            log.debug("scientific plots: Kp history unavailable", exc_info=True)
            kp_points = []

    kp_points = _merge_archived_kp(kp_points)
    diurnal = build_diurnal_latband(live_df)
    seasonal = build_seasonal_equinox_solstice()
    transect = build_modip_transect(live_df)
    quiet = build_quiet_disturbed(live_df, kp_points)
    persist_hourly_percentiles(live_df, kp_points)
    selected = (day or "").strip()[:10]
    if selected:
        try:
            stored = _payload_from_stored_day(selected)
        except Exception:
            log.debug("stored diurnal day unavailable", exc_info=True)
            stored = None
        if stored is not None:
            diurnal, quiet = stored

    return {
        "generated_at": datetime.now(tz=timezone.utc).isoformat(),
        "hours": hours,
        "resample_minutes": resample_minutes,
        "day": selected or None,
        "logged_days": logged_diurnal_days(),
        "diurnal_latband": diurnal,
        "seasonal": seasonal,
        "modip_transect": transect,
        "quiet_disturbed": quiet,
        "integrity": {
            "no_synthetic_tec": True,
            "uncertainty": "All error ribbons are observation percentiles (IQR), not arbitrary fixed bars.",
            "seasonal_archive_limited": not all(s.get("available") for s in seasonal.get("seasons") or []),
            "modip_approximate": True,
        },
    }
