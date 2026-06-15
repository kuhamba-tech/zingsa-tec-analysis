"""Client for ZINGSA CORS_Program REST APIs."""
from __future__ import annotations

import os
import time
from typing import Any, Dict, Optional

try:
    import requests

    _REQUESTS_AVAILABLE = True
except ImportError:
    _REQUESTS_AVAILABLE = False

# Production deployment from ZINGSA CORS_Program.
# Base URL preference order: secrets.toml → env var → hard-coded default.
def _secrets_api_base() -> str:
    try:
        import streamlit as st
        return (st.secrets.get("cors_api", {}).get("base_url") or "").rstrip("/")
    except Exception:
        return ""

_DEFAULT_API_BASES = (
    _secrets_api_base(),
    os.environ.get("ZGIIS_CORS_API_BASE", "").rstrip("/"),
    "https://zingsa-national-cors.vercel.app/api",
)

_TIMEOUT_SECONDS = 12


def _api_bases() -> list[str]:
    bases = list(dict.fromkeys(b for b in _DEFAULT_API_BASES if b))
    return bases or ["https://zingsa-national-cors.vercel.app/api"]


def _get_json(path: str, *, params: Optional[dict] = None) -> Optional[Dict[str, Any]]:
    if not _REQUESTS_AVAILABLE:
        return None
    for base in _api_bases():
        url = f"{base}/{path.lstrip('/')}"
        for attempt in range(2):
            try:
                response = requests.get(
                    url,
                    params=params,
                    timeout=_TIMEOUT_SECONDS,
                    headers={"User-Agent": "ZGIIS/1.0"},
                )
                if response.ok:
                    payload = response.json()
                    if isinstance(payload, dict):
                        payload["_api_base"] = base
                        return payload
                if response.status_code < 500:
                    break
            except Exception:
                pass
            if attempt == 0:
                time.sleep(0.25)
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


def fetch_live_tec_stations(*, country: str = "Zimbabwe") -> Dict[str, Any]:
    """Return only genuinely live, telemetry-backed station VTEC observations."""
    health = fetch_station_health(country=country)
    summary = (health or {}).get("health_summary") or {}
    telemetry_live = int(summary.get("telemetry_live") or 0)
    result: Dict[str, Any] = {
        "stations": [],
        "telemetry_live": telemetry_live,
        "updated_utc": (health or {}).get("analysis_date"),
        "api_base": (health or {}).get("_api_base"),
        "reason": None,
    }

    if telemetry_live <= 0:
        result["reason"] = (
            "The production CORS API reports zero stations with live telemetry."
        )
        return result

    ionosphere = fetch_ionosphere_status()
    if not ionosphere:
        result["reason"] = "The live ionosphere endpoint is unavailable."
        return result

    live_rows = []
    for row in ionosphere.get("stations") or []:
        source = str(row.get("data_source") or "").strip().lower()
        is_live_source = (
            bool(row.get("telemetry_live"))
            or bool(row.get("is_live"))
            or source in {"live", "live-telemetry", "cors-telemetry", "ntrip-live"}
        )
        if not is_live_source or row.get("vtec") is None:
            continue
        try:
            live_rows.append(
                {
                    "name": row.get("name") or row.get("id"),
                    "code": str(row.get("id") or "").lower().rstrip("_"),
                    "lat": float(row["lat"]),
                    "lon": float(row["lon"]),
                    "vtec": float(row["vtec"]),
                    "status": "online",
                    "data_source": source,
                }
            )
        except (KeyError, TypeError, ValueError):
            continue

    result["stations"] = live_rows
    result["updated_utc"] = ionosphere.get("updated_utc") or result["updated_utc"]
    if not live_rows:
        result["reason"] = (
            "The API reports live station telemetry, but returned no "
            "telemetry-backed VTEC observations."
        )
    return result
