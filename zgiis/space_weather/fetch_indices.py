"""Fetch real-time space weather and CORS health from ZINGSA CORS_Program APIs."""
from __future__ import annotations

import datetime
import math
from typing import Any, Dict, Optional

from zgiis.api.cors_client import (
    fetch_ionosphere_status,
    fetch_space_weather_africa,
    fetch_station_health,
)

try:
    import requests

    _REQUESTS_AVAILABLE = True
except ImportError:
    _REQUESTS_AVAILABLE = False

_CACHE: Dict[str, Any] = {}
_CACHE_TTL_SECONDS = 300  # 5 minutes — matches CORS_Program refresh cadence


# Aligned with ZINGSA CORS_Program/api/_space-weather/africa.js
_KP_LEVELS = [
    (0, 2, "Quiet", "#1D9E75"),
    (2, 4, "Unsettled", "#22d3ee"),
    (4, 5, "Active", "#EF9F27"),
    (5, 6, "G1 Storm", "#ef4444"),
    (6, 7, "G2 Storm", "#dc2626"),
    (7, 10, "G3+ Storm", "#7f1d1d"),
]

_GNSS_RISK_COLORS = {
    "Low": "#1D9E75",
    "Moderate": "#EF9F27",
    "High": "#ef4444",
    "Critical": "#dc2626",
    "SEVERE": "#dc2626",
    "HIGH": "#ef4444",
    "MODERATE": "#EF9F27",
    "LOW": "#1D9E75",
}

NOAA_KP_URL = "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json"
NOAA_F107_URL = "https://services.swpc.noaa.gov/json/f107_cm_flux.json"


def _cached(key: str, fetch_fn) -> Any:
    import time

    entry = _CACHE.get(key)
    if entry and time.time() - entry["ts"] < _CACHE_TTL_SECONDS:
        return entry["data"]
    data = fetch_fn()
    _CACHE[key] = {"ts": time.time(), "data": data}
    return data


def _resolve_kp_level(kp: float) -> tuple[str, str]:
    for lo, hi, name, color in _KP_LEVELS:
        if lo <= kp < hi:
            return name, color
    return "Quiet", "#1D9E75"


def _gnss_impact_label(kp: float, s4: float = 0.0, delta_tec: float = 0.0) -> str:
    """Same thresholds as ZINGSA CORS_Program/api/_ionosphere/status.js."""
    if kp >= 5 or s4 >= 0.7:
        return "Critical"
    if kp >= 4 or s4 >= 0.5 or abs(delta_tec) >= 8:
        return "High"
    if kp >= 3 or s4 >= 0.35 or abs(delta_tec) >= 4:
        return "Moderate"
    return "Low"


def _demo_kp() -> float:
    seed = int(datetime.datetime.utcnow().strftime("%Y%m%d%H"))
    return round(abs(math.sin(seed * 0.017)) * 4 + 1.2, 1)


def _parse_kp_value(record: Optional[dict]) -> Optional[float]:
    """Prefer kp_index; fall back to estimated_kp when index is zero (NOAA 1-min feed)."""
    if not record:
        return None
    kp_index = float(record.get("kp_index") or 0)
    estimated = float(record.get("estimated_kp") or 0)
    if kp_index > 0:
        return kp_index
    if estimated > 0:
        return estimated
    return kp_index if kp_index >= 0 else None


def _fetch_noaa_kp() -> Optional[float]:
    if not _REQUESTS_AVAILABLE:
        return None
    try:
        response = requests.get(NOAA_KP_URL, timeout=8)
        rows = response.json()
        if rows:
            return _parse_kp_value(rows[-1])
    except Exception:
        pass
    return None


def _fetch_noaa_f107() -> Optional[float]:
    if not _REQUESTS_AVAILABLE:
        return None
    try:
        response = requests.get(NOAA_F107_URL, timeout=8)
        rows = response.json()
        if rows:
            return float(rows[-1].get("flux") or 0)
    except Exception:
        pass
    return None


def _fallback_data() -> Dict[str, Any]:
    kp = _demo_kp()
    condition, condition_color = _resolve_kp_level(kp)
    risk = _gnss_impact_label(kp)
    return {
        "kp": kp,
        "kp_condition": condition,
        "kp_color": condition_color,
        "f107": 155.0,
        "gnss_risk": risk,
        "gnss_risk_color": _GNSS_RISK_COLORS.get(risk, "#1D9E75"),
        "mode": "demo",
        "source": "ZINGSA CORS demo fallback",
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "africa_impacts": None,
        "stations_online": None,
        "stations_total": None,
        "stations_degraded": None,
        "stations_offline": None,
        "station_health": None,
        "api_base": None,
    }


def _normalize_gnss_risk(raw: Optional[str]) -> str:
    if not raw:
        return "Low"
    mapping = {
        "SEVERE": "Critical",
        "HIGH": "High",
        "MODERATE": "Moderate",
        "LOW": "Low",
        "Critical": "Critical",
        "High": "High",
        "Moderate": "Moderate",
        "Low": "Low",
    }
    return mapping.get(raw, raw)


def get_space_weather() -> Dict[str, Any]:
    """Return consolidated dashboard space-weather metrics."""

    def _fetch() -> Dict[str, Any]:
        africa = fetch_space_weather_africa()
        iono = fetch_ionosphere_status(station="HARA")
        health = fetch_station_health(country="Zimbabwe")

        kp: Optional[float] = None
        condition = "Quiet"
        condition_color = "#1D9E75"
        mode = "demo"
        source = "ZINGSA CORS_Program APIs"
        timestamp = datetime.datetime.utcnow().isoformat() + "Z"
        api_base = None

        if africa:
            history = africa.get("history") or []
            latest_hist = history[-1] if history else None
            kp = _parse_kp_value(latest_hist) or _parse_kp_value(
                {"kp_index": africa.get("kp_index"), "estimated_kp": africa.get("estimated_kp")}
            )
            if kp is not None:
                kp = float(kp)
            condition = africa.get("kp_level") or (_resolve_kp_level(kp)[0] if kp is not None else "Quiet")
            condition_color = africa.get("kp_color") or (_resolve_kp_level(kp)[1] if kp is not None else "#1D9E75")
            mode = africa.get("mode", "live")
            source = africa.get("data_source", source)
            timestamp = africa.get("timestamp", timestamp)
            api_base = africa.get("_api_base")

        if kp is None and iono:
            kp = float(iono.get("kp_index", 0) or 0)
            if kp <= 0:
                kp = _fetch_noaa_kp()
            condition, condition_color = _resolve_kp_level(kp)
            mode = iono.get("mode", "live")
            source = iono.get("provider", source)
            timestamp = iono.get("updated_utc", timestamp)
            api_base = api_base or iono.get("_api_base")

        if kp is None:
            kp = _fetch_noaa_kp()

        if kp is None:
            return _fallback_data()

        kp = float(kp)
        condition, condition_color = _resolve_kp_level(kp)

        if not africa and not iono:
            mode = "live"
            source = "NOAA SWPC Planetary K-index (direct)"

        f107 = _fetch_noaa_f107() or 155.0

        s4 = float(iono.get("s4_index", 0)) if iono else 0.0
        delta_tec = float(iono.get("tec_daily_change", 0)) if iono else 0.0
        gnss_raw = iono.get("gnss_impact") if iono else None
        gnss_risk = _normalize_gnss_risk(gnss_raw) if gnss_raw else _gnss_impact_label(kp, s4, delta_tec)

        stations_online = stations_total = stations_degraded = stations_offline = None
        if health:
            summary = health.get("health_summary") or {}
            stations_online = summary.get("online")
            stations_degraded = summary.get("degraded")
            stations_offline = summary.get("offline")
            stations = health.get("stations") or []
            stations_total = len(stations) if stations else None
            api_base = api_base or health.get("_api_base")
            if stations_online is not None and stations_total:
                source = f"{source} · CORS health API"

        africa_impacts = africa.get("africa_impacts") if africa else None

        return {
            "kp": round(float(kp), 1),
            "kp_condition": condition,
            "kp_color": condition_color,
            "f107": round(float(f107), 1),
            "gnss_risk": gnss_risk,
            "gnss_risk_color": _GNSS_RISK_COLORS.get(gnss_risk, "#1D9E75"),
            "mode": mode,
            "source": source,
            "timestamp": timestamp,
            "africa_impacts": africa_impacts,
            "stations_online": stations_online,
            "stations_total": stations_total,
            "stations_degraded": stations_degraded,
            "stations_offline": stations_offline,
            "station_health": health,
            "api_base": api_base,
            "ionosphere_station": iono.get("station") if iono else None,
            "vtec_tecu": iono.get("vtec_tecu") if iono else None,
        }

    return _cached("space_weather", _fetch)


def get_warning_messages(sw: Dict[str, Any]) -> list[str]:
    """Human-readable status messages aligned with CORS_Program africa impacts."""
    warnings: list[str] = []
    kp = float(sw.get("kp", 0) or 0)
    risk = sw.get("gnss_risk", "Low")

    if kp >= 6:
        warnings.append("Geomagnetic storm — GNSS positioning may be unreliable across Zimbabwe.")
    elif kp >= 5:
        warnings.append("GNSS accuracy degradation expected — ionospheric disturbance active.")
    elif kp >= 4:
        warnings.append("Active geomagnetic conditions — verify RTK fixes near the equatorial belt.")
    elif kp >= 3:
        warnings.append("Unsettled geomagnetic activity — monitor CORS corrections.")

    if risk in ("High", "Critical"):
        warnings.append(f"GNSS risk is {risk} — check station-health and ionosphere status.")

    if not warnings:
        warnings.append("Conditions nominal — no significant ionospheric disturbance.")
    return warnings


# Backwards-compatible helpers used by Space Weather page
def _classify_kp(kp: float) -> tuple[str, str]:
    condition, _ = _resolve_kp_level(kp)
    risk = _gnss_impact_label(kp)
    return condition, risk


def _risk_color(risk: str) -> str:
    return _GNSS_RISK_COLORS.get(risk, "#1D9E75")
