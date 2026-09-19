"""Live satellite elevation from RTCM GPS ephemeris (1019) and station coordinates."""

from __future__ import annotations

import math
import threading
from datetime import datetime, timezone
from typing import Optional

import numpy as np

from tec_core import _ecef_elevation, _gps_sat_ecef

_WGS84_A = 6378137.0
_WGS84_F = 1.0 / 298.257223563
_WGS84_E2 = 2 * _WGS84_F - _WGS84_F**2


def llh_to_ecef(lat_deg: float, lon_deg: float, height_m: float) -> np.ndarray:
    lat = math.radians(lat_deg)
    lon = math.radians(lon_deg)
    sin_lat = math.sin(lat)
    cos_lat = math.cos(lat)
    sin_lon = math.sin(lon)
    cos_lon = math.cos(lon)
    n = _WGS84_A / math.sqrt(1.0 - _WGS84_E2 * sin_lat * sin_lat)
    x = (n + height_m) * cos_lat * cos_lon
    y = (n + height_m) * cos_lat * sin_lon
    z = (n * (1.0 - _WGS84_E2) + height_m) * sin_lat
    return np.array([x, y, z], dtype=float)


def _gps_sow(epoch: datetime) -> float:
    if epoch.tzinfo is None:
        epoch = epoch.replace(tzinfo=timezone.utc)
    ts = epoch.astimezone(timezone.utc)
    # Align with tec_core day-of-week convention (Sunday = 0).
    dow = (ts.weekday() + 1) % 7
    return dow * 86400.0 + ts.hour * 3600.0 + ts.minute * 60.0 + ts.second + ts.microsecond / 1e6


def _nav_row_from_rtcm_1019(msg) -> tuple[int, dict] | None:
    try:
        sv = int(getattr(msg, "DF009", 0) or 0)
    except (TypeError, ValueError):
        return None
    if sv <= 0:
        return None
    try:
        nav = {
            "sqrtA": float(getattr(msg, "DF092", 0)),
            "Eccentricity": float(getattr(msg, "DF090", 0)),
            "M0": float(getattr(msg, "DF088", 0)),
            "DeltaN": float(getattr(msg, "DF087", 0)),
            "omega": float(getattr(msg, "DF099", 0)),
            "Omega0": float(getattr(msg, "DF095", 0)),
            "OmegaDot": float(getattr(msg, "DF100", 0)),
            "Io": float(getattr(msg, "DF097", 0)),
            "IDOT": float(getattr(msg, "DF079", 0)),
            "Cuc": float(getattr(msg, "DF089", 0)),
            "Cus": float(getattr(msg, "DF091", 0)),
            "Crc": float(getattr(msg, "DF098", 0)),
            "Crs": float(getattr(msg, "DF086", 0)),
            "Cic": float(getattr(msg, "DF094", 0)),
            "Cis": float(getattr(msg, "DF096", 0)),
            "Toe": float(getattr(msg, "DF093", 0)),
        }
    except (TypeError, ValueError):
        return None
    if nav["sqrtA"] <= 0:
        return None
    return sv, nav


class LiveNavCache:
    """Thread-safe GPS broadcast ephemeris cache from RTCM 1019 messages."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._gps: dict[int, dict] = {}
        self._rx_ecef: dict[str, np.ndarray] = {}
        self.last_bulk_update: Optional[datetime] = None

    def update_gps_ephemeris(self, msg) -> None:
        parsed = _nav_row_from_rtcm_1019(msg)
        if parsed is None:
            return
        sv, nav = parsed
        with self._lock:
            self._gps[sv] = nav

    def bulk_update_gps(self, nav_by_sv: dict[int, dict]) -> int:
        """Merge broadcast-ephemeris nav rows (keyed by GPS SV number, see
        zgiis/live/broadcast_ephemeris.py) into the cache. Returns the count
        of satellites updated."""
        if not nav_by_sv:
            return 0
        with self._lock:
            self._gps.update(nav_by_sv)
            self.last_bulk_update = datetime.now(tz=timezone.utc)
        return len(nav_by_sv)

    def gps_sv_count(self) -> int:
        with self._lock:
            return len(self._gps)

    def receiver_ecef(self, station_code: str) -> Optional[np.ndarray]:
        key = station_code.lower().rstrip("_")
        with self._lock:
            cached = self._rx_ecef.get(key)
        if cached is not None:
            return cached

        from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

        station = next(
            (s for s in ZIMBABWE_CORS_STATIONS if s.code.lower().rstrip("_") == key),
            None,
        )
        if station is None:
            return None
        ecef = llh_to_ecef(station.lat, station.lon, station.height_m or 0.0)
        with self._lock:
            self._rx_ecef[key] = ecef
        return ecef

    def elevation_deg(self, station: str, prn: str, epoch: datetime | None) -> Optional[float]:
        if not prn or not str(prn).upper().startswith("G"):
            return None
        try:
            sv = int(str(prn)[1:])
        except ValueError:
            return None

        with self._lock:
            nav = self._gps.get(sv)
        if nav is None:
            return None

        rx = self.receiver_ecef(station)
        if rx is None:
            return None

        epoch = epoch or datetime.now(tz=timezone.utc)
        sat = _gps_sat_ecef(nav, _gps_sow(epoch))
        if sat is None:
            return None
        elev = _ecef_elevation(rx, sat)
        if not math.isfinite(elev):
            return None
        return float(elev)
