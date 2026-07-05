"""Build live TEC heat-map payload for the Next.js map (no synthetic data)."""

from __future__ import annotations

from datetime import datetime, timezone
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


def _normalize_weight(vtec: float, tec_min: float, tec_max: float) -> float:
    if tec_max <= tec_min:
        return 0.5
    return float(max(0.05, min(1.0, (vtec - tec_min) / (tec_max - tec_min))))


def _live_station_rows(hours: float = 2.0) -> list[dict[str, Any]]:
    try:
        from backend.live_manager import get_db

        summary = get_db().station_summary(hours=hours)
    except Exception:
        return []

    if summary is None or summary.empty:
        return []

    lookup = {s.code.lower(): s for s in ZIMBABWE_CORS_STATIONS}
    rows: list[dict[str, Any]] = []
    for _, row in summary.iterrows():
        code = str(row.get("station", "")).lower().rstrip("_")
        station = lookup.get(code)
        if station is None:
            continue
        mean_vtec = float(row["mean_vtec"])
        if not np.isfinite(mean_vtec) or mean_vtec <= 0:
            continue
        rows.append(
            {
                "code": station.code,
                "name": station.name,
                "lat": station.lat,
                "lon": station.lon,
                "vtec": round(mean_vtec, 2),
                "obs_count": int(row.get("obs_count") or 0),
            }
        )
    return rows


def build_tec_heatmap(*, hours: float = 2.0) -> dict[str, Any]:
    """Return interpolated grid + heat points for map overlay."""
    stations = _live_station_rows(hours=hours)
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
        "message": "No recent live VTEC observations in the pipeline database.",
    }
    if not stations:
        return empty

    tec_values = [s["vtec"] for s in stations]
    tec_min = float(min(tec_values))
    tec_max = float(max(tec_values))
    if np.isclose(tec_min, tec_max):
        tec_min -= 0.5
        tec_max += 0.5

    heat_points: list[dict[str, Any]] = [
        {
            "lon": s["lon"],
            "lat": s["lat"],
            "vtec": s["vtec"],
            "weight": _normalize_weight(s["vtec"], tec_min, tec_max),
            "code": s["code"],
        }
        for s in stations
    ]

    grid_payload: dict[str, Any] | None = None
    if len(stations) >= 3:
        try:
            lats = np.array([s["lat"] for s in stations])
            lons = np.array([s["lon"] for s in stations])
            vtecs = np.array([s["vtec"] for s in stations])
            grid_lons, grid_lats, grid_tec = interpolate_tec(lats, lons, vtecs, method="linear")

            for i in range(grid_lats.shape[0]):
                for j in range(grid_lons.shape[1]):
                    value = float(grid_tec[i, j])
                    if not np.isfinite(value):
                        continue
                    heat_points.append(
                        {
                            "lon": float(grid_lons[i, j]),
                            "lat": float(grid_lats[i, j]),
                            "vtec": round(value, 2),
                            "weight": _normalize_weight(value, tec_min, tec_max),
                            "code": None,
                        }
                    )

            grid_payload = {
                "lons": grid_lons.tolist(),
                "lats": grid_lats.tolist(),
                "vtec": np.where(np.isfinite(grid_tec), grid_tec, None).tolist(),
            }
        except Exception:
            grid_payload = None

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
        "message": None,
    }
