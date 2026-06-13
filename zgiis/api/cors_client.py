"""Client for ZINGSA CORS_Program REST APIs."""
from __future__ import annotations

import os
from typing import Any, Dict, Optional

try:
    import requests

    _REQUESTS_AVAILABLE = True
except ImportError:
    _REQUESTS_AVAILABLE = False

# Vite dev (mock-api) and production deployment from ZINGSA CORS_Program/vite.config.js
_DEFAULT_API_BASES = (
    os.environ.get("ZGIIS_CORS_API_BASE", "").rstrip("/"),
    "https://zingsa-national-cors.vercel.app/api",
    "http://localhost:5174/api",
    "http://localhost:5173/api",
)

_TIMEOUT_SECONDS = 12
_LOCAL_TIMEOUT_SECONDS = 2


def _api_bases() -> list[str]:
    bases = [b for b in _DEFAULT_API_BASES if b]
    return bases or ["https://zingsa-national-cors.vercel.app/api"]


def _get_json(path: str, *, params: Optional[dict] = None) -> Optional[Dict[str, Any]]:
    if not _REQUESTS_AVAILABLE:
        return None
    for base in _api_bases():
        url = f"{base}/{path.lstrip('/')}"
        timeout = _LOCAL_TIMEOUT_SECONDS if base.startswith("http://localhost") else _TIMEOUT_SECONDS
        try:
            response = requests.get(url, params=params, timeout=timeout)
            if response.ok:
                payload = response.json()
                if isinstance(payload, dict):
                    payload["_api_base"] = base
                    return payload
        except Exception:
            continue
    return None


def fetch_space_weather_africa() -> Optional[Dict[str, Any]]:
    """GET /api/space-weather/africa — NOAA Kp + Africa geomagnetic level."""
    return _get_json("space-weather/africa")


def fetch_station_health(*, country: str = "Zimbabwe") -> Optional[Dict[str, Any]]:
    """GET /api/gnss/station-health — CORS online/degraded/offline counts."""
    return _get_json("gnss/station-health", params={"country": country})


def fetch_ionosphere_status(*, station: str = "HARA") -> Optional[Dict[str, Any]]:
    """GET /api/ionosphere/status — TEC, S4, GNSS impact, live Kp."""
    return _get_json("ionosphere/status", params={"station": station})
