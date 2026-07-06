"""Build live TEC heat-map payload for the Next.js map (no synthetic data)."""

from __future__ import annotations

from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np

from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
from zgiis.maps.interpolation import (
    ZW_LAT_MAX,
    ZW_LAT_MIN,
    ZW_LON_MAX,
    ZW_LON_MIN,
    interpolate_tec,
)

TEC_SCALE_MIN = 0.0
TEC_SCALE_MAX = 200.0
ICAO_TEC_MOD = 125.0
ICAO_TEC_SEV = 175.0
_REGIONAL_CODES = frozenset({"nw", "ne", "cent", "sw", "se"})
_STATION_LOOKUP = {s.code.lower(): s for s in ZIMBABWE_CORS_STATIONS}


def _absolute_weight(vtec: float) -> float:
    span = TEC_SCALE_MAX - TEC_SCALE_MIN
    if span <= 0:
        return 0.5
    return float(max(0.05, min(1.0, (vtec - TEC_SCALE_MIN) / span)))


def _classify_data_quality(stations: list[dict[str, Any]], grid: dict[str, Any] | None) -> str:
    if not stations:
        return "none"
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
            "Showing interpolated TEC from available live measurements. "
            "Per-station pipeline archives are limited — values may reflect network mean until more CORS streams contribute VTEC."
        )
    if quality == "stations_only":
        return (
            f"{station_count} CORS site(s) reporting VTEC — interpolated surface could not be built. "
            "Ensure at least one station has live pipeline observations."
        )
    return None


def _row_from_station(station, *, vtec: float, obs_count: int) -> dict[str, Any]:
    return {
        "code": station.code,
        "name": station.name,
        "lat": station.lat,
        "lon": station.lon,
        "vtec": round(float(vtec), 2),
        "obs_count": int(obs_count),
    }


def _pipeline_station_rows(hours: float = 2.0) -> list[dict[str, Any]]:
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
        from backend.live_manager import get_db

        df = get_db().query_recent(hours=hours)
    except Exception:
        return []
    if df is None or df.empty or "station" not in df.columns or "vtec_tecu" not in df.columns:
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
            )
        )
    return rows


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


def _merge_station_rows(*groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for group in groups:
        for row in group:
            code = str(row["code"]).lower()
            prev = merged.get(code)
            if prev is None or int(row.get("obs_count") or 0) >= int(prev.get("obs_count") or 0):
                merged[code] = row
    return list(merged.values())


def _build_grid_payload(stations: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not stations:
        return None
    try:
        lats = np.array([s["lat"] for s in stations], dtype=float)
        lons = np.array([s["lon"] for s in stations], dtype=float)
        vtecs = np.array([s["vtec"] for s in stations], dtype=float)
        grid_lons, grid_lats, grid_tec = interpolate_tec(lats, lons, vtecs, method="linear")
        if not np.isfinite(grid_tec).any():
            return None
        return {
            "lons": grid_lons.tolist(),
            "lats": grid_lats.tolist(),
            "vtec": np.where(np.isfinite(grid_tec), grid_tec, None).tolist(),
        }
    except Exception:
        return None


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


def build_tec_heatmap(*, hours: float = 2.0) -> dict[str, Any]:
    """Return interpolated grid + heat points for map overlay."""
    stations = _merge_station_rows(
        _pipeline_station_rows(hours=hours),
        _recent_pipeline_rows(hours=min(hours, 0.75)),
        _live_pipeline_memory_rows(),
        _probe_sample_vtec_rows(),
        _cors_current_tec_rows(),
    )

    empty: dict[str, Any] = {
        "available": False,
        "stations": [],
        "heat_points": [],
        "grid": None,
        "bounds": [ZW_LON_MIN, ZW_LAT_MIN, ZW_LON_MAX, ZW_LAT_MAX],
        "tec_min": None,
        "tec_max": None,
        "station_count": 0,
        "updated_at": None,
        "message": _empty_heatmap_message(),
        "data_quality": "none",
        "icao_mod_tecu": ICAO_TEC_MOD,
        "icao_sev_tecu": ICAO_TEC_SEV,
    }
    if not stations:
        return empty

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

    grid_payload = _build_grid_payload(stations)
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
    }
