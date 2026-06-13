"""Fetch real-time space weather indices from NOAA and GFZ."""
from __future__ import annotations

import json
import datetime
from typing import Dict, Any, Optional

try:
    import requests
    _REQUESTS_AVAILABLE = True
except ImportError:
    _REQUESTS_AVAILABLE = False


_CACHE: Dict[str, Any] = {}
_CACHE_TTL_SECONDS = 900  # 15 minutes


def _cached(key: str, fetch_fn) -> Any:
    import time
    entry = _CACHE.get(key)
    if entry and time.time() - entry["ts"] < _CACHE_TTL_SECONDS:
        return entry["data"]
    data = fetch_fn()
    _CACHE[key] = {"ts": time.time(), "data": data}
    return data


def _fallback_data() -> Dict[str, Any]:
    """Return placeholder data when network is unavailable."""
    return {
        "kp": 2.3,
        "kp_condition": "Quiet",
        "f107": 142.5,
        "dst": -15,
        "ap": 9,
        "gnss_risk": "Low",
        "gnss_risk_color": "#00ff88",
        "source": "offline_placeholder",
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
    }


def _classify_kp(kp: float) -> tuple[str, str]:
    """Return (condition_label, gnss_risk_label)."""
    if kp < 3:
        return "Quiet", "Low"
    elif kp < 4:
        return "Unsettled", "Low"
    elif kp < 5:
        return "Active", "Moderate"
    elif kp < 6:
        return "Minor Storm (G1)", "Moderate"
    elif kp < 7:
        return "Moderate Storm (G2)", "High"
    elif kp < 8:
        return "Strong Storm (G3)", "High"
    elif kp < 9:
        return "Severe Storm (G4)", "Critical"
    else:
        return "Extreme Storm (G5)", "Critical"


def _risk_color(risk: str) -> str:
    return {"Low": "#00ff88", "Moderate": "#ff8c00", "High": "#ff4444", "Critical": "#cc00ff"}.get(risk, "#888")


def fetch_kp_index() -> Optional[float]:
    """Fetch latest 3-hour Kp from NOAA SWPC."""
    if not _REQUESTS_AVAILABLE:
        return None
    try:
        url = "https://services.swpc.noaa.gov/json/planetary_k_index_1m.json"
        r = requests.get(url, timeout=8)
        data = r.json()
        if data:
            return float(data[-1].get("kp_index", 0))
    except Exception:
        pass
    return None


def fetch_f107() -> Optional[float]:
    """Fetch latest F10.7 solar flux from NOAA."""
    if not _REQUESTS_AVAILABLE:
        return None
    try:
        url = "https://services.swpc.noaa.gov/json/f107_cm_flux.json"
        r = requests.get(url, timeout=8)
        data = r.json()
        if data:
            return float(data[-1].get("flux", 0))
    except Exception:
        pass
    return None


def get_space_weather() -> Dict[str, Any]:
    """Return a consolidated space weather dict, falling back gracefully."""
    def _fetch():
        kp = fetch_kp_index()
        f107 = fetch_f107()
        if kp is None and f107 is None:
            return _fallback_data()
        kp = kp or 2.3
        f107 = f107 or 142.5
        condition, risk = _classify_kp(kp)
        return {
            "kp": round(kp, 1),
            "kp_condition": condition,
            "f107": round(f107, 1),
            "dst": None,
            "ap": None,
            "gnss_risk": risk,
            "gnss_risk_color": _risk_color(risk),
            "source": "NOAA_SWPC",
            "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        }

    return _cached("space_weather", _fetch)


def get_warning_messages(sw: Dict[str, Any]) -> list[str]:
    """Return a list of human-readable warning strings based on space weather."""
    warnings = []
    kp = sw.get("kp", 0)
    risk = sw.get("gnss_risk", "Low")
    if kp >= 5:
        warnings.append("GNSS accuracy degradation expected — ionospheric disturbance active.")
    if kp >= 6:
        warnings.append("Possible RTK instability at equatorial and mid-latitude stations.")
    if kp >= 7:
        warnings.append("Aviation positioning may be affected — verify GNSS integrity.")
    if kp >= 8:
        warnings.append("CRITICAL: Severe geomagnetic storm in progress. GNSS navigation unreliable.")
    if risk == "Low" and not warnings:
        warnings.append("Conditions nominal — no significant ionospheric disturbance.")
    return warnings
