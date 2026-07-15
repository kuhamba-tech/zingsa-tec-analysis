"""Build live TEC heat-map payload for the Next.js map (no synthetic data)."""

from __future__ import annotations

from datetime import datetime
import os
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np

from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
from zgiis.maps.interpolation import (
    MATAMBA_GRID_STEP_DEG,
    MATAMBA_MEDIAN_FILTER_SIZE,
    ZW_LAT_MAX,
    ZW_LAT_MIN,
    ZW_LON_MAX,
    ZW_LON_MIN,
    interpolate_tec_matamba,
)

TEC_SCALE_MIN = 0.0
TEC_SCALE_MAX = 200.0
ICAO_TEC_MOD = 125.0
ICAO_TEC_SEV = 175.0
MATAMBA_CADENCE_MIN = 5
MATAMBA_WINDOW_MIN = 15
MATAMBA_TEMPORAL_LOOKBACK_MIN = MATAMBA_WINDOW_MIN + MATAMBA_CADENCE_MIN
MADIMBO_IONOSONDE = {
    "code": "MU12K",
    "name": "Madimbo ionosonde",
    "lat": -22.39,
    "lon": 30.88,
    "country": "South Africa",
    "note": "Nearest SANSA ionosonde to Zimbabwe listed by Matamba and Danskin (2022); use for cross-border TEC validation when NRT ionosonde TEC is available.",
}
MATAMBA_EVALUATION_WINDOW_DAYS = 5
MATAMBA_EVALUATION_INTERVAL_MIN = 60
MATAMBA_EVALUATION_TARGETS = [
    {
        "code": "HE13N",
        "name": "Hermanus ionosonde",
        "lat": -34.43,
        "lon": 19.23,
        "country": "South Africa",
        "env_ionosonde": "HE13N_IONOSONDE_TEC",
        "env_afritec": "HE13N_AFRITEC_TEC",
    },
    {
        "code": "GR13L",
        "name": "Grahamstown ionosonde",
        "lat": -33.32,
        "lon": 26.50,
        "country": "South Africa",
        "env_ionosonde": "GR13L_IONOSONDE_TEC",
        "env_afritec": "GR13L_AFRITEC_TEC",
    },
]
MATAMBA_REFERENCE_STATISTICS = {
    "ionosonde_example_slope_range": [0.90, 1.01],
    "ionosonde_example_correlation": 0.96,
    "ionosonde_operational_correlation_min": 0.82,
    "ionosonde_observed_slope_range": [0.65, 1.12],
    "afritec_example_slope_range": [0.85, 0.86],
    "afritec_example_correlation": 0.93,
    "afritec_observed_slope_range": [0.59, 1.15],
}
TEC_ACQUISITION_RECOMMENDATIONS = [
    "Use dual-frequency GNSS L1/L2 observations for TEC; single-frequency streams cannot isolate ionospheric delay.",
    "For live NTRIP VTEC, require MSM4/MSM7 observation messages plus broadcast ephemeris, especially GPS RTCM 1019.",
    "Generate operational map products every 5 minutes from the previous 15 minutes of accepted observations.",
    "Reject non-physical VTEC below 0 TECU and cap operational outliers above 50 TECU unless solar-cycle conditions justify a higher cap.",
    "Use 1 degree by 1 degree nearest-neighbour gridding with a 7-cell spatial median filter for the Matamba/SANSA-style product.",
]
_REGIONAL_CODES = frozenset({"nw", "ne", "cent", "sw", "se"})
_PROCESSED_ARCHIVE_SOURCES = frozenset({"processed_archive", "processed_archive_estimate"})
_SURFACE_ESTIMATE_SOURCES = frozenset({"live_surface_estimate", "processed_archive_estimate"})
_STATION_LOOKUP = {s.code.lower(): s for s in ZIMBABWE_CORS_STATIONS}


def _live_db_heatmap_enabled() -> bool:
    """Live DB rows should be used in every environment unless explicitly disabled."""
    disabled = os.getenv("TEC_HEATMAP_QUERY_LIVE_DB", "").strip().lower() in {"0", "false", "no", "off"}
    return not disabled


def _absolute_weight(vtec: float) -> float:
    span = TEC_SCALE_MAX - TEC_SCALE_MIN
    if span <= 0:
        return 0.5
    return float(max(0.05, min(1.0, (vtec - TEC_SCALE_MIN) / span)))


def _classify_data_quality(stations: list[dict[str, Any]], grid: dict[str, Any] | None) -> str:
    if not stations:
        return "none"
    if all(str(s.get("source") or "") in _PROCESSED_ARCHIVE_SOURCES for s in stations):
        return "processed_archive"
    if any(str(s.get("source") or "") in _SURFACE_ESTIMATE_SOURCES for s in stations):
        return "regional_mean"
    codes = {str(s["code"]).lower() for s in stations}
    if codes.issubset(_REGIONAL_CODES):
        return "regional_mean"
    if all(int(s.get("obs_count") or 0) == 0 for s in stations):
        return "regional_mean"
    if grid is None:
        return "stations_only"
    return "station"


def _quality_message(quality: str, station_count: int) -> str | None:
    if quality == "regional_mean":
        return (
            "Showing calculated live VTEC where available, plus interpolated station estimates from the current live surface. "
            "Sites with no MSM observations are estimates until more CORS streams contribute VTEC."
        )
    if quality == "stations_only":
        return (
            f"{station_count} CORS site(s) reporting VTEC — interpolated surface could not be built. "
            "Ensure at least one station has live pipeline observations."
        )
    if quality == "processed_archive":
        return (
            f"Showing calculated VTEC from the latest processed RINEX/CMN archive for {station_count} CORS site(s). "
            "Stations without an exact archive row use the interpolated archive surface until live NTRIP emits VTEC."
        )
    return None


def _matamba_metadata() -> dict[str, Any]:
    return {
        "source": "Matamba and Danskin (2022), Space Weather, doi:10.1029/2021SW003013",
        "cadence_minutes": MATAMBA_CADENCE_MIN,
        "window_minutes": MATAMBA_WINDOW_MIN,
        "grid_resolution_deg": MATAMBA_GRID_STEP_DEG,
        "interpolation": "nearest-neighbour",
        "median_filter_size": MATAMBA_MEDIAN_FILTER_SIZE,
        "quality_metrics": ["map RMSE", "station coverage quality factor", "spatial TEC gradient", "temporal TEC gradient"],
        "gradient_method": {
            "spatial": (
                "Cell-to-cell TEC change on the 1 degree median-filtered grid, reported for north-south, "
                "east-west, and combined adjacent-cell gradients in TECU/degree."
            ),
            "temporal": (
                "Absolute TEC change between consecutive 5-minute median-filtered map products, normalized "
                "to TECU/hour. Each map uses the previous 15 minutes of observations."
            ),
            "icao_note": (
                "ICAO Doc 10100 advisory level is still based on absolute vertical TEC thresholds; gradients "
                "are supporting GNSS-impact diagnostics for spatial and temporal variability."
            ),
        },
        "evaluation": {
            "targets": [target["code"] for target in MATAMBA_EVALUATION_TARGETS],
            "external_references": ["ionosonde TEC", "AfriTEC model"],
            "matched_points_only": True,
            "comparison_window_days": MATAMBA_EVALUATION_WINDOW_DAYS,
            "comparison_interval_minutes": MATAMBA_EVALUATION_INTERVAL_MIN,
            "rmse_window_minutes": MATAMBA_WINDOW_MIN,
            "rmse_definition": (
                "RMSE of gridded median-filtered TEC minus original TEC estimates at IPP/control locations "
                "for each 5-minute map using the past 15 minutes of data."
            ),
            "reference_statistics": MATAMBA_REFERENCE_STATISTICS,
        },
        "recommendations": TEC_ACQUISITION_RECOMMENDATIONS,
    }


def _empty_diagnostics() -> dict[str, Any]:
    return {
        "matamba": _matamba_metadata(),
        "fit": {"rmse_tecu": None, "quality_factor": 0.0, "control_station_count": 0, "control_observation_count": 0},
        "gradients": _empty_gradient_payload(),
        "ionosonde_comparison": _madimbo_comparison(None),
        "evaluation": _matamba_evaluation([], None, None, None),
        "frequency_recommendations": TEC_ACQUISITION_RECOMMENDATIONS,
    }


def _grid_lookup(grid_lons: np.ndarray, grid_lats: np.ndarray, grid_tec: np.ndarray, lon: float, lat: float) -> float | None:
    if grid_tec.size == 0:
        return None
    distances = np.hypot(grid_lons - float(lon), grid_lats - float(lat))
    if not np.isfinite(distances).any():
        return None
    idx = np.unravel_index(int(np.nanargmin(distances)), distances.shape)
    value = float(grid_tec[idx])
    return value if np.isfinite(value) else None


def _fit_metrics(
    control_rows: list[dict[str, Any]],
    grid_lons: np.ndarray,
    grid_lats: np.ndarray,
    grid_tec: np.ndarray,
) -> dict[str, Any]:
    errors: list[float] = []
    obs_count = 0
    for row in control_rows:
        obs_count += int(row.get("obs_count") or 0)
        fitted = _grid_lookup(grid_lons, grid_lats, grid_tec, float(row["lon"]), float(row["lat"]))
        if fitted is None:
            continue
        errors.append(float(fitted) - float(row["vtec"]))
    rmse = float(np.sqrt(np.mean(np.square(errors)))) if errors else None
    coverage = min(1.0, len(control_rows) / max(1, len(ZIMBABWE_CORS_STATIONS)))
    fit_score = 1.0 if rmse is None else max(0.0, 1.0 - min(rmse, 50.0) / 50.0)
    quality = round(float(0.65 * coverage + 0.35 * fit_score), 3)
    return {
        "rmse_tecu": round(rmse, 2) if rmse is not None else None,
        "quality_factor": quality,
        "control_station_count": len(control_rows),
        "control_observation_count": obs_count,
    }


def _empty_gradient_payload() -> dict[str, Any]:
    return {
        "spatial_max_tecu_per_deg": None,
        "spatial_mean_tecu_per_deg": None,
        "spatial_lat_max_tecu_per_deg": None,
        "spatial_lon_max_tecu_per_deg": None,
        "spatial_max_direction": None,
        "temporal_max_tecu_per_hour": None,
        "temporal_mean_tecu_per_hour": None,
        "temporal_window_minutes": MATAMBA_WINDOW_MIN,
        "temporal_cadence_minutes": MATAMBA_CADENCE_MIN,
        "temporal_available": False,
        "icao_supporting_diagnostic": True,
        "method": "Matamba adjacent-cell spatial gradient and consecutive-map temporal gradient",
    }


def _spatial_gradient(grid_lons: np.ndarray, grid_lats: np.ndarray, grid_tec: np.ndarray) -> dict[str, Any]:
    out = _empty_gradient_payload()
    if grid_tec.size == 0 or not np.isfinite(grid_tec).any():
        return out
    lat_step = float(np.nanmedian(np.abs(np.diff(grid_lats[:, 0])))) if grid_lats.shape[0] > 1 else 1.0
    lon_step = float(np.nanmedian(np.abs(np.diff(grid_lons[0, :])))) if grid_lons.shape[1] > 1 else 1.0
    lat_grad = np.abs(np.diff(grid_tec, axis=0)) / max(lat_step, 1e-6) if grid_tec.shape[0] > 1 else np.array([])
    lon_grad = np.abs(np.diff(grid_tec, axis=1)) / max(lon_step, 1e-6) if grid_tec.shape[1] > 1 else np.array([])
    finite_lat = lat_grad[np.isfinite(lat_grad)]
    finite_lon = lon_grad[np.isfinite(lon_grad)]
    lat_max = float(np.max(finite_lat)) if finite_lat.size else None
    lon_max = float(np.max(finite_lon)) if finite_lon.size else None
    all_components = np.concatenate([finite_lat, finite_lon]) if finite_lat.size or finite_lon.size else np.array([])
    if all_components.size:
        out["spatial_mean_tecu_per_deg"] = round(float(np.mean(all_components)), 3)
    if lat_max is not None:
        out["spatial_lat_max_tecu_per_deg"] = round(lat_max, 3)
    if lon_max is not None:
        out["spatial_lon_max_tecu_per_deg"] = round(lon_max, 3)
    candidates = [(lat_max, "north-south"), (lon_max, "east-west")]
    candidates = [(value, label) for value, label in candidates if value is not None]
    if candidates:
        value, label = max(candidates, key=lambda item: item[0])
        out["spatial_max_tecu_per_deg"] = round(float(value), 3)
        out["spatial_max_direction"] = label
    return out


def _temporal_gradient(
    grid_tec: np.ndarray,
    previous_grid_tec: np.ndarray | None,
) -> dict[str, Any]:
    out: dict[str, Any] = {}
    if previous_grid_tec is None or previous_grid_tec.size == 0 or previous_grid_tec.shape != grid_tec.shape:
        return {
            "temporal_max_tecu_per_hour": None,
            "temporal_mean_tecu_per_hour": None,
            "temporal_available": False,
        }
    delta = np.abs(grid_tec - previous_grid_tec) / (MATAMBA_CADENCE_MIN / 60.0)
    finite = delta[np.isfinite(delta)]
    if finite.size == 0:
        return {
            "temporal_max_tecu_per_hour": None,
            "temporal_mean_tecu_per_hour": None,
            "temporal_available": False,
        }
    out["temporal_max_tecu_per_hour"] = round(float(np.max(finite)), 3)
    out["temporal_mean_tecu_per_hour"] = round(float(np.mean(finite)), 3)
    out["temporal_available"] = True
    return out


def _station_temporal_gradient(control_rows: list[dict[str, Any]], previous_rows: list[dict[str, Any]] | None) -> float | None:
    if not previous_rows:
        return None
    prev_by_code = {str(row["code"]).lower().rstrip("_"): row for row in previous_rows}
    diffs: list[float] = []
    for row in control_rows:
        prev = prev_by_code.get(str(row["code"]).lower().rstrip("_"))
        if prev is None:
            continue
        diffs.append(abs(float(row["vtec"]) - float(prev["vtec"])) / (MATAMBA_CADENCE_MIN / 60.0))
    return round(float(max(diffs)), 3) if diffs else None


def _madimbo_comparison(estimated_vtec: float | None) -> dict[str, Any]:
    iono_vtec = os.getenv("MADIMBO_IONOSONDE_TEC")
    measured = None
    difference = None
    try:
        measured = float(iono_vtec) if iono_vtec not in {None, ""} else None
    except ValueError:
        measured = None
    if measured is not None and estimated_vtec is not None:
        difference = round(float(estimated_vtec) - measured, 2)
    return {
        **MADIMBO_IONOSONDE,
        "estimated_vtec": round(float(estimated_vtec), 2) if estimated_vtec is not None else None,
        "ionosonde_vtec": measured,
        "difference_tecu": difference,
        "status": "comparison_available" if difference is not None else "awaiting_ionosonde_tec",
    }


def _read_env_float(name: str) -> float | None:
    raw = os.getenv(name)
    if raw in {None, ""}:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def _comparison_row(estimate: float | None, measured: float | None) -> dict[str, Any]:
    diff = None
    if estimate is not None and measured is not None:
        diff = round(float(estimate) - float(measured), 2)
    return {
        "value": measured,
        "difference_tecu": diff,
        "matched": estimate is not None and measured is not None,
    }


def _matamba_evaluation(
    control_rows: list[dict[str, Any]],
    grid_lons: np.ndarray | None,
    grid_lats: np.ndarray | None,
    grid_tec: np.ndarray | None,
) -> dict[str, Any]:
    targets: list[dict[str, Any]] = []
    for target in MATAMBA_EVALUATION_TARGETS:
        estimate = None
        if grid_lons is not None and grid_lats is not None and grid_tec is not None:
            estimate = _grid_lookup(grid_lons, grid_lats, grid_tec, target["lon"], target["lat"])
        iono = _read_env_float(target["env_ionosonde"])
        afritec = _read_env_float(target["env_afritec"])
        targets.append(
            {
                "code": target["code"],
                "name": target["name"],
                "lat": target["lat"],
                "lon": target["lon"],
                "country": target["country"],
                "nrt_tec_est": round(float(estimate), 2) if estimate is not None else None,
                "ionosonde": _comparison_row(estimate, iono),
                "afritec": _comparison_row(estimate, afritec),
                "status": "matched_comparison_available" if iono is not None or afritec is not None else "awaiting_external_tec",
            }
        )

    return {
        "method": "Interpolate NRT TEC estimate from the median-filtered gridded map at ionosonde coordinates.",
        "matched_points_only": True,
        "comparison_window_days": MATAMBA_EVALUATION_WINDOW_DAYS,
        "comparison_interval_minutes": MATAMBA_EVALUATION_INTERVAL_MIN,
        "map_generation_interval_minutes": MATAMBA_CADENCE_MIN,
        "rmse_window_minutes": MATAMBA_WINDOW_MIN,
        "reference_statistics": MATAMBA_REFERENCE_STATISTICS,
        "control_point_count": len(control_rows),
        "targets": targets,
        "notes": [
            "Matamba and Danskin compare only matched data points in time.",
            "Each hour, compare the latest 5 days of NRT TEC estimates with ionosonde TEC and AfriTEC.",
            "Set HE13N_IONOSONDE_TEC, GR13L_IONOSONDE_TEC, HE13N_AFRITEC_TEC, and GR13L_AFRITEC_TEC to compute live residuals.",
        ],
    }


def _matamba_diagnostics(
    control_rows: list[dict[str, Any]],
    grid_lons: np.ndarray,
    grid_lats: np.ndarray,
    grid_tec: np.ndarray,
    *,
    previous_rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    madimbo_estimate = _grid_lookup(grid_lons, grid_lats, grid_tec, MADIMBO_IONOSONDE["lon"], MADIMBO_IONOSONDE["lat"])
    gradients = _spatial_gradient(grid_lons, grid_lats, grid_tec)
    previous_grid_tec = None
    if previous_rows:
        try:
            prev_lats = np.array([s["lat"] for s in previous_rows], dtype=float)
            prev_lons = np.array([s["lon"] for s in previous_rows], dtype=float)
            prev_vtecs = np.array([s["vtec"] for s in previous_rows], dtype=float)
            _, _, previous_grid_tec = interpolate_tec_matamba(prev_lats, prev_lons, prev_vtecs)
        except Exception:
            previous_grid_tec = None
    gradients.update(_temporal_gradient(grid_tec, previous_grid_tec))
    station_temporal = _station_temporal_gradient(control_rows, previous_rows)
    gradients["temporal_station_max_tecu_per_hour"] = station_temporal
    return {
        "matamba": _matamba_metadata(),
        "fit": _fit_metrics(control_rows, grid_lons, grid_lats, grid_tec),
        "gradients": gradients,
        "ionosonde_comparison": _madimbo_comparison(madimbo_estimate),
        "evaluation": _matamba_evaluation(control_rows, grid_lons, grid_lats, grid_tec),
        "frequency_recommendations": TEC_ACQUISITION_RECOMMENDATIONS,
    }


def _row_from_station(station, *, vtec: float, obs_count: int, source: str = "live") -> dict[str, Any]:
    return {
        "code": station.code,
        "name": station.name,
        "lat": station.lat,
        "lon": station.lon,
        "vtec": round(float(vtec), 2),
        "obs_count": int(obs_count),
        "source": source,
    }


def _pipeline_station_rows(hours: float = 2.0) -> list[dict[str, Any]]:
    if not _live_db_heatmap_enabled():
        return []
    try:
        from backend.live_manager import get_db

        summary = get_db().station_summary(hours=hours)
    except Exception:
        return []

    if summary is None or summary.empty:
        return []

    rows: list[dict[str, Any]] = []
    for _, record in summary.iterrows():
        code = str(record.get("station", "")).lower().rstrip("_")
        station = _STATION_LOOKUP.get(code)
        if station is None:
            continue
        mean_vtec = float(record["mean_vtec"])
        if not np.isfinite(mean_vtec) or mean_vtec <= 0:
            continue
        rows.append(
            _row_from_station(
                station,
                vtec=mean_vtec,
                obs_count=int(record.get("obs_count") or 0),
            )
        )
    return rows


def _recent_pipeline_rows(hours: float = 0.5) -> list[dict[str, Any]]:
    """Shorter-window pipeline query — catches stations that just came online."""
    try:
        if not _live_db_heatmap_enabled():
            return []
        from backend.live_manager import get_db

        df = get_db().query_recent(hours=hours)
    except Exception:
        return []
    return _station_rows_from_observation_frame(df, source="live")


def _station_rows_from_observation_frame(df, *, source: str) -> list[dict[str, Any]]:
    if df is None or not hasattr(df, "empty") or df.empty or "station" not in df.columns or "vtec_tecu" not in df.columns:
        return []
    rows: list[dict[str, Any]] = []
    grouped = df.groupby("station")["vtec_tecu"]
    for code_raw, series in grouped:
        code = str(code_raw).lower().rstrip("_")
        station = _STATION_LOOKUP.get(code)
        if station is None:
            continue
        mean_vtec = float(series.mean())
        if not np.isfinite(mean_vtec) or mean_vtec <= 0:
            continue
        rows.append(
            _row_from_station(
                station,
                vtec=mean_vtec,
                obs_count=int(series.count()),
                source=source,
            )
        )
    return rows


def _temporal_reference_pipeline_rows() -> list[dict[str, Any]]:
    """Previous map product window: [latest - 20 min, latest - 5 min)."""
    try:
        if not _live_db_heatmap_enabled():
            return []
        from backend.live_manager import get_db

        df = get_db().query_recent(hours=MATAMBA_TEMPORAL_LOOKBACK_MIN / 60.0)
    except Exception:
        return []
    if df is None or not hasattr(df, "empty") or df.empty or "time" not in df.columns:
        return []

    work = df.copy()
    work["time"] = np.array(work["time"], dtype="datetime64[ns]")
    latest_raw = work["time"].max()
    latest = np.datetime64(latest_raw.to_datetime64() if hasattr(latest_raw, "to_datetime64") else latest_raw)
    if np.isnat(latest):
        return []
    previous_start = latest - np.timedelta64(MATAMBA_TEMPORAL_LOOKBACK_MIN, "m")
    previous_end = latest - np.timedelta64(MATAMBA_CADENCE_MIN, "m")
    previous = work[(work["time"] >= previous_start) & (work["time"] < previous_end)]
    return _station_rows_from_observation_frame(previous, source="live_previous_map")


def _live_pipeline_memory_rows() -> list[dict[str, Any]]:
    """VTEC computed by the live ingest pipeline but not yet flushed to the DB."""
    try:
        from backend.live_manager import latest_vtec_by_station

        rows: list[dict[str, Any]] = []
        for code, vtec in latest_vtec_by_station().items():
            station = _STATION_LOOKUP.get(code.lower().rstrip("_"))
            if station is None or not np.isfinite(vtec) or vtec <= 0:
                continue
            rows.append(_row_from_station(station, vtec=vtec, obs_count=1))
        return rows
    except Exception:
        return []


def _probe_sample_vtec_rows() -> list[dict[str, Any]]:
    """VTEC sampled during the cached NTRIP probe (serverless / no persistent ingest)."""
    try:
        from zgiis.live.ntrip_status_cache import get_cached_ntrip_probe, ntrip_probe_enabled, probe_rows_by_station

        if not ntrip_probe_enabled():
            return []

        payload = get_cached_ntrip_probe(refresh=False, allow_blocking_refresh=False)
        if payload.get("error"):
            return []

        rows: list[dict[str, Any]] = []
        for code, probe_row in probe_rows_by_station(payload).items():
            raw = probe_row.get("mean_vtec_tecu")
            if raw is None:
                continue
            vtec = float(raw)
            if not np.isfinite(vtec) or vtec <= 0:
                continue
            station = _STATION_LOOKUP.get(code.lower().rstrip("_"))
            if station is None:
                continue
            rows.append(
                _row_from_station(
                    station,
                    vtec=vtec,
                    obs_count=int(probe_row.get("vtec_sample_count") or 1),
                )
            )
        return rows
    except Exception:
        return []


def _empty_heatmap_message() -> str:
    try:
        from zgiis.live.ntrip_status_cache import get_cached_ntrip_probe, ntrip_probe_enabled, probe_rows_by_station

        if not ntrip_probe_enabled():
            return "No recent live VTEC observations in the pipeline database."

        payload = get_cached_ntrip_probe(refresh=False, allow_blocking_refresh=False)
        if payload.get("error"):
            return "No recent live VTEC observations in the pipeline database."

        by = probe_rows_by_station(payload)
        connected = sum(
            1 for row in by.values() if str(row.get("verdict") or "").lower() not in {"", "offline"}
        )
        msm = sum(1 for row in by.values() if str(row.get("verdict") or "").lower() == "msm_streaming")
        with_vtec = sum(1 for row in by.values() if float(row.get("mean_vtec_tecu") or 0) > 0)

        if with_vtec > 0:
            return (
                f"{with_vtec} connected CORS site(s) sampled live VTEC — "
                "refresh the map to load the latest probe decode."
            )
        if msm > 0:
            return (
                f"{msm} CORS site(s) streaming MSM observations — "
                "live VTEC decode needs L1/L2 carrier phase and GPS ephemeris (RTCM 1019)."
            )
        if connected > 0:
            return (
                f"{connected} CORS site(s) NTRIP-connected — "
                "awaiting MSM observation stream before live VTEC can be computed."
            )
    except Exception:
        pass
    return "No recent live VTEC observations in the pipeline database."


def _cors_current_tec_rows() -> list[dict[str, Any]]:
    """Live VTEC attached to CORS station records (NTRIP / recent pipeline query)."""
    try:
        from backend.routers.cors_network import _stations

        rows: list[dict[str, Any]] = []
        for station in _stations():
            current = getattr(station, "current_tec", None)
            if current is None:
                continue
            vtec = float(current)
            if not np.isfinite(vtec) or vtec <= 0:
                continue
            rows.append(_row_from_station(station, vtec=vtec, obs_count=1))
        return rows
    except Exception:
        return []


def _processed_archive_rows() -> list[dict[str, Any]]:
    """Newest processed RINEX/CMN VTEC per station, used only when live VTEC is absent."""
    try:
        from zgiis.data.tec_archive import load_historical_tec

        df, _ = load_historical_tec()
    except Exception:
        return []

    if df is None or df.empty or not {"timestamp", "station", "vtec"}.issubset(df.columns):
        return []

    work = df.copy()
    work["vtec"] = np.asarray(work["vtec"], dtype=float)
    work = work[np.isfinite(work["vtec"]) & (work["vtec"] > 0)].copy()
    if work.empty:
        return []

    latest = work.sort_values("timestamp").groupby("station", as_index=False).tail(1)
    rows: list[dict[str, Any]] = []
    for code_raw, group in latest.groupby("station"):
        code = str(code_raw).lower().rstrip("_")
        station = _STATION_LOOKUP.get(code)
        if station is None:
            continue
        mean_vtec = float(group["vtec"].mean())
        if not np.isfinite(mean_vtec) or mean_vtec <= 0:
            continue
        if "observations" in group.columns:
            obs_count = int(np.asarray(group["observations"], dtype=float).sum())
        else:
            obs_count = len(group)
        rows.append(
            _row_from_station(
                station,
                vtec=mean_vtec,
                obs_count=obs_count,
                source="processed_archive",
            )
        )
    return _archive_surface_station_rows(rows)


def _archive_surface_station_rows(control_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Add archive-surface estimates for CORS stations lacking exact archive rows."""
    return _surface_station_rows(control_rows, estimate_source="processed_archive_estimate")


def _surface_station_rows(
    control_rows: list[dict[str, Any]],
    *,
    estimate_source: str,
) -> list[dict[str, Any]]:
    """Add surface-estimated rows for CORS stations lacking exact VTEC rows."""
    if not control_rows:
        return []

    exact_by_code = {str(row["code"]).lower().rstrip("_"): row for row in control_rows}
    if len(control_rows) == 1:
        base_value = float(control_rows[0]["vtec"])
        rows = list(control_rows)
        for station in ZIMBABWE_CORS_STATIONS:
            code = station.code.lower().rstrip("_")
            if code in exact_by_code:
                continue
            rows.append(
                _row_from_station(
                    station,
                    vtec=base_value,
                    obs_count=0,
                    source=estimate_source,
                )
            )
        return rows

    control_lats = np.array([row["lat"] for row in control_rows], dtype=float)
    control_lons = np.array([row["lon"] for row in control_rows], dtype=float)
    control_vtec = np.array([row["vtec"] for row in control_rows], dtype=float)
    rows = list(control_rows)

    for station in ZIMBABWE_CORS_STATIONS:
        code = station.code.lower().rstrip("_")
        if code in exact_by_code:
            continue
        distances = np.hypot(control_lats - float(station.lat), control_lons - float(station.lon))
        if not np.isfinite(distances).any():
            continue
        if float(distances.min()) <= 1e-9:
            estimate = float(control_vtec[int(distances.argmin())])
        else:
            weights = 1.0 / np.maximum(distances, 1e-6) ** 2
            estimate = float(np.sum(weights * control_vtec) / np.sum(weights))
        if not np.isfinite(estimate) or estimate <= 0:
            continue
        rows.append(
            _row_from_station(
                station,
                vtec=estimate,
                obs_count=0,
                source=estimate_source,
            )
        )
    return rows


def _live_surface_station_rows(control_rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Show best live VTEC surface estimate at every CORS site."""
    return _surface_station_rows(control_rows, estimate_source="live_surface_estimate")


def _merge_station_rows(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for group in groups:
        for row in group:
            code = str(row["code"]).lower()
            prev = merged.get(code)
            if prev is None or int(row.get("obs_count") or 0) >= int(prev.get("obs_count") or 0):
                merged[code] = row
    return list(merged.values())


def _control_rows(stations: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        row
        for row in stations
        if str(row.get("source") or "") not in _SURFACE_ESTIMATE_SOURCES
    ] or stations


def _build_grid_payload(
    stations: list[dict[str, Any]],
    *,
    previous_rows: list[dict[str, Any]] | None = None,
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    if not stations:
        return None, _empty_diagnostics()
    try:
        control = _control_rows(stations)
        lats = np.array([s["lat"] for s in control], dtype=float)
        lons = np.array([s["lon"] for s in control], dtype=float)
        vtecs = np.array([s["vtec"] for s in control], dtype=float)
        grid_lons, grid_lats, grid_tec = interpolate_tec_matamba(lats, lons, vtecs)
        if not np.isfinite(grid_tec).any():
            return None, _empty_diagnostics()
        payload = {
            "lons": grid_lons.tolist(),
            "lats": grid_lats.tolist(),
            "vtec": np.where(np.isfinite(grid_tec), grid_tec, None).tolist(),
            "method": "nearest_median",
            "resolution_deg": MATAMBA_GRID_STEP_DEG,
        }
        previous_control = _control_rows(previous_rows or []) if previous_rows else None
        return payload, _matamba_diagnostics(
            control,
            grid_lons,
            grid_lats,
            grid_tec,
            previous_rows=previous_control,
        )
    except Exception:
        return None, _empty_diagnostics()


def _append_grid_heat_points(
    heat_points: list[dict[str, Any]],
    grid_payload: dict[str, Any],
) -> None:
    grid_lons = grid_payload["lons"]
    grid_lats = grid_payload["lats"]
    grid_vtec = grid_payload["vtec"]
    rows = len(grid_lats)
    cols = len(grid_lons[0]) if grid_lons else 0
    step = max(1, rows // 24)
    for i in range(0, rows, step):
        for j in range(0, cols, step):
            value = grid_vtec[i][j] if i < len(grid_vtec) and j < len(grid_vtec[i]) else None
            if value is None or not np.isfinite(float(value)):
                continue
            heat_points.append(
                {
                    "lon": float(grid_lons[i][j]),
                    "lat": float(grid_lats[i][j]),
                    "vtec": round(float(value), 2),
                    "weight": _absolute_weight(float(value)),
                    "code": None,
                }
            )


def _heatmap_payload_from_station_rows(
    stations: list[dict[str, Any]],
    *,
    empty_message: str | None,
    previous_rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    if not stations:
        return {
            "available": False,
            "stations": [],
            "heat_points": [],
            "grid": None,
            "bounds": [ZW_LON_MIN, ZW_LAT_MIN, ZW_LON_MAX, ZW_LAT_MAX],
            "tec_min": None,
            "tec_max": None,
            "station_count": 0,
            "updated_at": None,
            "message": empty_message,
            "data_quality": "none",
            "icao_mod_tecu": ICAO_TEC_MOD,
            "icao_sev_tecu": ICAO_TEC_SEV,
            "diagnostics": _empty_diagnostics(),
        }

    tec_values = [s["vtec"] for s in stations]
    tec_min = float(min(tec_values))
    tec_max = float(max(tec_values))

    heat_points: list[dict[str, Any]] = [
        {
            "lon": s["lon"],
            "lat": s["lat"],
            "vtec": s["vtec"],
            "weight": _absolute_weight(s["vtec"]),
            "code": s["code"],
        }
        for s in stations
    ]

    grid_payload, diagnostics = _build_grid_payload(stations, previous_rows=previous_rows)
    if grid_payload is not None:
        _append_grid_heat_points(heat_points, grid_payload)

    quality = _classify_data_quality(stations, grid_payload)
    quality_message = _quality_message(quality, len(stations))

    updated_at = datetime.now(ZoneInfo("Africa/Harare")).strftime("%d %b %Y, %H:%M CAT")
    return {
        "available": True,
        "stations": stations,
        "heat_points": heat_points,
        "grid": grid_payload,
        "bounds": [ZW_LON_MIN, ZW_LAT_MIN, ZW_LON_MAX, ZW_LAT_MAX],
        "tec_min": round(tec_min, 2),
        "tec_max": round(tec_max, 2),
        "station_count": len(stations),
        "updated_at": updated_at,
        "message": quality_message,
        "data_quality": quality,
        "icao_mod_tecu": ICAO_TEC_MOD,
        "icao_sev_tecu": ICAO_TEC_SEV,
        "diagnostics": diagnostics,
    }


def build_tec_heatmap(*, hours: float = 2.0) -> dict[str, Any]:
    """Return interpolated grid + heat points for map overlay."""
    live_rows = _merge_station_rows(
        _pipeline_station_rows(hours=hours),
        _recent_pipeline_rows(hours=min(hours, 0.75)),
        _live_pipeline_memory_rows(),
        _probe_sample_vtec_rows(),
    )
    previous_rows = _temporal_reference_pipeline_rows() if live_rows else []
    stations = _live_surface_station_rows(live_rows) if live_rows else []
    if not stations:
        stations = _processed_archive_rows()
    if not stations:
        cors_rows = _cors_current_tec_rows()
        stations = _live_surface_station_rows(cors_rows) if cors_rows else []
    return _heatmap_payload_from_station_rows(
        stations,
        empty_message=_empty_heatmap_message(),
        previous_rows=previous_rows,
    )


def build_archive_tec_heatmap() -> dict[str, Any]:
    """Return the processed-archive heat map without touching live services."""
    return _heatmap_payload_from_station_rows(
        _processed_archive_rows(),
        empty_message="No processed RINEX/CMN archive VTEC is available.",
    )
