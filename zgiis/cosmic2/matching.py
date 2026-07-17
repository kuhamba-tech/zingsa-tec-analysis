"""Haversine distance and COSMIC-2 profile <-> Zimbabwe CORS matching.

No true great-circle distance helper exists anywhere else in this repo (the
only "distance" code, zgiis/maps/station_map.py's IDW interpolation, uses a
rough equirectangular approximation for map-grid weighting, not exposed as
a reusable function and not km-accurate) — this is a new, standalone
Haversine implementation, kept local to this module since nothing else in
the repo currently needs a general-purpose geo-distance utility.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime

import pandas as pd

from zgiis.cors.stations import CorsStation
from zgiis.cosmic2.models import Cosmic2Config

EARTH_RADIUS_KM = 6371.0088


def is_in_box(lat: float, lon: float, *, config: Cosmic2Config) -> bool:
    """Broad southern-Africa research box membership (no GeoJSON boundary
    exists in this repo to use instead)."""
    return config.lat_min <= lat <= config.lat_max and config.lon_min <= lon <= config.lon_max


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_KM * math.asin(min(1.0, math.sqrt(a)))


@dataclass
class MatchResult:
    station_code: str | None
    station_name: str | None
    station_lat: float | None
    station_lon: float | None
    station_distance_km: float | None
    cors_timestamp: str | None
    cors_vtec_tecu: float | None
    time_delta_minutes: float | None
    match_valid: bool
    match_quality: str  # "high" | "medium" | "low" | "invalid"
    match_reason: str  # ASCII only


def find_nearest_station(lat: float, lon: float, stations: list[CorsStation]) -> tuple[CorsStation, float]:
    best_station = stations[0]
    best_distance = haversine_km(lat, lon, best_station.lat, best_station.lon)
    for station in stations[1:]:
        distance = haversine_km(lat, lon, station.lat, station.lon)
        if distance < best_distance:
            best_station, best_distance = station, distance
    return best_station, best_distance


def find_nearest_observation(
    obs_df: pd.DataFrame, station_code: str, occ_time: datetime, *, max_minutes: float
) -> tuple[datetime | None, float | None, float | None]:
    """obs_df: pre-loaded DataFrame with columns [station, timestamp, vtec],
    batch-loaded once per analyse_range() call rather than per profile."""
    if obs_df is None or obs_df.empty:
        return None, None, None
    station_obs = obs_df[obs_df["station"] == station_code]
    if station_obs.empty:
        return None, None, None

    occ_ts = pd.Timestamp(occ_time)
    if occ_ts.tzinfo is None:
        occ_ts = occ_ts.tz_localize("UTC")
    deltas = (station_obs["timestamp"] - occ_ts).abs()
    idx = deltas.idxmin()
    delta_minutes = float(deltas.loc[idx].total_seconds() / 60.0)
    if delta_minutes > max_minutes:
        return None, None, delta_minutes
    row = station_obs.loc[idx]
    return row["timestamp"].to_pydatetime(), float(row["vtec"]), delta_minutes


def _classify_quality(distance_km: float, time_delta_minutes: float, *, config: Cosmic2Config) -> str:
    if distance_km <= config.match_quality_high_km and time_delta_minutes <= config.match_quality_high_min:
        return "high"
    if distance_km <= config.match_quality_medium_km and time_delta_minutes <= config.match_quality_medium_min:
        return "medium"
    return "low"


def match_profile_to_cors(
    lat: float, lon: float, occ_time: datetime, obs_df: pd.DataFrame,
    stations: list[CorsStation], *, config: Cosmic2Config | None = None,
) -> MatchResult:
    config = config or Cosmic2Config()
    if not stations:
        return MatchResult(None, None, None, None, None, None, None, None, False, "invalid", "no_cors_stations")

    station, distance_km = find_nearest_station(lat, lon, stations)
    if distance_km > config.max_match_distance_km:
        return MatchResult(
            station.code, station.name, station.lat, station.lon, distance_km,
            None, None, None, False, "invalid", "station_too_far",
        )

    obs_time, vtec, time_delta_minutes = find_nearest_observation(
        obs_df, station.code, occ_time, max_minutes=config.max_match_time_minutes
    )
    if vtec is None:
        reason = "no_cors_observation_in_window" if time_delta_minutes is None else "time_difference_too_large"
        return MatchResult(
            station.code, station.name, station.lat, station.lon, distance_km,
            None, None, time_delta_minutes, False, "invalid", reason,
        )

    quality = _classify_quality(distance_km, time_delta_minutes, config=config)
    return MatchResult(
        station_code=station.code, station_name=station.name, station_lat=station.lat, station_lon=station.lon,
        station_distance_km=distance_km, cors_timestamp=obs_time.isoformat(), cors_vtec_tecu=vtec,
        time_delta_minutes=time_delta_minutes, match_valid=True, match_quality=quality, match_reason="matched",
    )
