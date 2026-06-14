"""Fetch real-time space weather and CORS health from ZINGSA CORS_Program APIs."""
from __future__ import annotations

import datetime
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
    (0, 3, "Quiet", "#1D9E75"),
    (3, 4, "Unsettled", "#22d3ee"),
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
NOAA_DST_URL = "https://services.swpc.noaa.gov/products/kyoto-dst.json"
NOAA_PLASMA_URL = "https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json"


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
    history = _fetch_noaa_kp_history()
    if not history:
        return None
    for row in reversed(history):
        value = _parse_kp_value(row)
        if value is not None:
            return value
    return None


def _fetch_noaa_kp_history() -> list[dict]:
    """Return the full NOAA SWPC 1-minute planetary K-index feed."""
    if not _REQUESTS_AVAILABLE:
        return []
    try:
        response = requests.get(NOAA_KP_URL, timeout=8)
        response.raise_for_status()
        rows = response.json()
        if not isinstance(rows, list):
            return []
        history: list[dict] = []
        for row in rows:
            if not isinstance(row, dict) or not row.get("time_tag"):
                continue
            history.append(
                {
                    "time_tag": row.get("time_tag"),
                    "kp_index": row.get("kp_index"),
                    "estimated_kp": row.get("estimated_kp"),
                }
            )
        return history
    except Exception:
        return []


def _fetch_noaa_f107() -> Optional[float]:
    history = _fetch_noaa_f107_history()
    if not history:
        return None
    for row in reversed(history):
        flux = row.get("flux")
        if flux is not None:
            return float(flux)
    return None


def _fetch_noaa_f107_history() -> list[dict]:
    if not _REQUESTS_AVAILABLE:
        return []
    try:
        response = requests.get(NOAA_F107_URL, timeout=8)
        response.raise_for_status()
        rows = response.json()
        if not isinstance(rows, list):
            return []
        history: list[dict] = []
        for row in rows:
            if not isinstance(row, dict) or not row.get("time_tag"):
                continue
            if row.get("flux") is None:
                continue
            history.append(
                {"time_tag": row.get("time_tag"), "flux": float(row["flux"])}
            )
        return sorted(history, key=lambda item: str(item["time_tag"]))
    except Exception:
        return []


def _fetch_noaa_dst() -> Optional[float]:
    """Fetch latest Kyoto Dst index (nT) from NOAA SWPC."""
    history = _fetch_noaa_dst_history()
    if not history:
        return None
    for row in reversed(history):
        if row.get("dst") is not None:
            return float(row["dst"])
    return None


def _fetch_noaa_dst_history() -> list[dict]:
    if not _REQUESTS_AVAILABLE:
        return []
    try:
        response = requests.get(NOAA_DST_URL, timeout=8)
        response.raise_for_status()
        rows = response.json()
        if not isinstance(rows, list):
            return []

        history: list[dict] = []
        for row in rows:
            if isinstance(row, dict) and row.get("time_tag") and row.get("dst") is not None:
                history.append(
                    {"time_tag": row["time_tag"], "dst": float(row["dst"])}
                )
                continue
            if (
                isinstance(row, list)
                and len(row) >= 2
                and row[0] != "time_tag"
                and row[1] is not None
            ):
                history.append({"time_tag": row[0], "dst": float(row[1])})
        return sorted(history, key=lambda item: str(item["time_tag"]))
    except Exception:
        return []


def _fetch_noaa_solar_wind() -> tuple[Optional[float], Optional[float]]:
    """Fetch latest solar wind speed (km/s) and density (p/cm³) from NOAA SWPC."""
    history = _fetch_noaa_solar_wind_history()
    if not history:
        return None, None
    latest = history[-1]
    return latest.get("speed"), latest.get("density")


def _fetch_noaa_solar_wind_history() -> list[dict]:
    if not _REQUESTS_AVAILABLE:
        return []
    try:
        response = requests.get(NOAA_PLASMA_URL, timeout=8)
        response.raise_for_status()
        rows = response.json()
        if not rows or len(rows) < 2:
            return []
        header = rows[0]
        speed_idx = next((i for i, h in enumerate(header) if "speed" in str(h).lower()), None)
        density_idx = next((i for i, h in enumerate(header) if "density" in str(h).lower()), None)
        history: list[dict] = []
        for row in rows[1:]:
            if not isinstance(row, list) or not row:
                continue
            try:
                speed = (
                    float(row[speed_idx])
                    if speed_idx is not None and row[speed_idx] not in (None, "")
                    else None
                )
                density = (
                    float(row[density_idx])
                    if density_idx is not None and row[density_idx] not in (None, "")
                    else None
                )
            except (TypeError, ValueError, IndexError):
                continue
            if speed is None and density is None:
                continue
            history.append(
                {
                    "time_tag": row[0],
                    "speed": speed,
                    "density": density,
                }
            )
        return history
    except Exception:
        return []


_RISK_SCORES = {"Low": 0.0, "Moderate": 1.0, "High": 2.0, "Critical": 3.0}


def _build_gnss_risk_history(
    kp_history: list[dict],
    *,
    s4: Optional[float] = None,
) -> list[dict]:
    rows: list[dict] = []
    for record in kp_history:
        if not isinstance(record, dict) or not record.get("time_tag"):
            continue
        kp = _parse_kp_value(record)
        if kp is None:
            continue
        risk = _gnss_impact_label(float(kp), s4 or 0.0)
        rows.append(
            {
                "time_tag": record["time_tag"],
                "risk_score": _RISK_SCORES.get(risk, 0.0),
            }
        )
    return rows


def _build_snapshot_history(
    kp_history: list[dict],
    value: Optional[float],
    *,
    field: str,
) -> list[dict]:
    if value is None:
        return []
    rows: list[dict] = []
    for record in kp_history:
        if not isinstance(record, dict) or not record.get("time_tag"):
            continue
        rows.append({"time_tag": record["time_tag"], field: float(value)})
    return rows


def _unavailable_data() -> Dict[str, Any]:
    """Return explicit unavailable values; never synthesize observations."""
    return {
        "kp": None,
        "kp_condition": "Unavailable",
        "kp_color": "#ffffff",
        "f107": None,
        "gnss_risk": "Unavailable",
        "gnss_risk_color": "#ffffff",
        "mode": "unavailable",
        "source": "Live data unavailable",
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z",
        "africa_impacts": None,
        "kp_history": [],
        "dst_history": [],
        "f107_history": [],
        "solar_wind_history": [],
        "gnss_risk_history": [],
        "s4_history": [],
        "stations_online_history": [],
        "stations_online": None,
        "stations_total": None,
        "stations_degraded": None,
        "stations_offline": None,
        "station_health": None,
        "api_base": None,
        "s4": None,
        "dst": None,
        "solar_wind_speed": None,
        "solar_wind_density": None,
        "station_data_status": "unavailable",
        "station_data_note": "No live CORS telemetry available.",
        "ionosphere_data_status": "unavailable",
        "ionosphere_data_note": "No observed ionosphere record available.",
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
        mode = "live"
        source = "ZINGSA CORS_Program APIs"
        timestamp = datetime.datetime.utcnow().isoformat() + "Z"
        api_base = None

        if africa:
            history = africa.get("history") or []
            kp = _parse_kp_value(
                {
                    "kp_index": africa.get("kp_index"),
                    "estimated_kp": africa.get("estimated_kp"),
                }
            )
            if kp is None:
                latest_hist = history[-1] if history else None
                kp = _parse_kp_value(latest_hist)
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
            if kp is not None:
                condition, condition_color = _resolve_kp_level(kp)
            mode = iono.get("mode", "live")
            source = iono.get("provider", source)
            timestamp = iono.get("updated_utc", timestamp)
            api_base = api_base or iono.get("_api_base")

        if kp is None:
            kp = _fetch_noaa_kp()

        if kp is None:
            result = _unavailable_data()
            result["f107"] = _fetch_noaa_f107()
            result["dst"] = _fetch_noaa_dst()
            sw_speed, sw_density = _fetch_noaa_solar_wind()
            result["solar_wind_speed"] = sw_speed
            result["solar_wind_density"] = sw_density
            return result

        kp = float(kp)
        condition, condition_color = _resolve_kp_level(kp)

        if not africa and not iono:
            mode = "live"
            source = "NOAA SWPC Planetary K-index (direct)"

        f107 = _fetch_noaa_f107()
        dst = _fetch_noaa_dst()
        sw_speed, sw_density = _fetch_noaa_solar_wind()

        s4 = None
        delta_tec = 0.0
        ionosphere_status = "unavailable"
        ionosphere_note = "No observed ionosphere record available."
        if iono:
            selected_station = next(
                (
                    row
                    for row in (iono.get("stations") or [])
                    if str(row.get("id", "")).upper()
                    == str(iono.get("station", "")).upper()
                ),
                None,
            )
            if selected_station and selected_station.get("archive_backed"):
                s4 = float(iono.get("s4_index")) if iono.get("s4_index") is not None else None
                delta_tec = float(iono.get("tec_daily_change", 0) or 0)
                ionosphere_status = "observed_archive"
                archive_date = selected_station.get("archive_date") or "unknown date"
                ionosphere_note = f"Observed RINEX archive record dated {archive_date}; not live telemetry."
            else:
                ionosphere_note = "CORS API response is modelled or not backed by an observed RINEX record."
        gnss_raw = iono.get("gnss_impact") if iono else None
        gnss_risk = (
            _normalize_gnss_risk(gnss_raw)
            if gnss_raw and ionosphere_status == "observed_archive"
            else _gnss_impact_label(kp, s4 or 0.0, delta_tec)
        )

        stations_online = stations_total = stations_degraded = stations_offline = None
        station_data_status = "unavailable"
        station_data_note = "No live CORS telemetry available."
        if health:
            summary = health.get("health_summary") or {}
            stations = health.get("stations") or []
            stations_total = len(stations) if stations else None
            api_base = api_base or health.get("_api_base")
            telemetry_live = int(summary.get("telemetry_live") or 0)
            if telemetry_live > 0:
                stations_online = summary.get("online")
                stations_degraded = summary.get("degraded")
                stations_offline = summary.get("offline")
                station_data_status = "live"
                station_data_note = f"{telemetry_live} stations have live telemetry."
                source = f"{source} · CORS live telemetry"
            else:
                station_data_note = (
                    "Production CORS API reports zero live telemetry; archive/catalog "
                    "statuses are not presented as live station availability."
                )

        africa_impacts = africa.get("africa_impacts") if africa else None
        kp_history = africa.get("history") if africa else []
        if not isinstance(kp_history, list):
            kp_history = []
        noaa_history = _fetch_noaa_kp_history()
        if len(noaa_history) > len(kp_history):
            kp_history = noaa_history

        dst_history = _fetch_noaa_dst_history()
        f107_history = _fetch_noaa_f107_history()
        solar_wind_history = _fetch_noaa_solar_wind_history()
        gnss_risk_history = _build_gnss_risk_history(kp_history, s4=s4)
        s4_history = _build_snapshot_history(kp_history, s4, field="s4")
        stations_online_history = _build_snapshot_history(
            kp_history,
            float(stations_online) if stations_online is not None else None,
            field="online",
        )

        return {
            "kp": round(float(kp), 1),
            "kp_condition": condition,
            "kp_color": condition_color,
            "f107": round(float(f107), 1) if f107 is not None else None,
            "gnss_risk": gnss_risk,
            "gnss_risk_color": _GNSS_RISK_COLORS.get(gnss_risk, "#1D9E75"),
            "mode": mode,
            "source": source,
            "timestamp": timestamp,
            "africa_impacts": africa_impacts,
            "kp_history": kp_history,
            "dst_history": dst_history,
            "f107_history": f107_history,
            "solar_wind_history": solar_wind_history,
            "gnss_risk_history": gnss_risk_history,
            "s4_history": s4_history,
            "stations_online_history": stations_online_history,
            "stations_online": stations_online,
            "stations_total": stations_total,
            "stations_degraded": stations_degraded,
            "stations_offline": stations_offline,
            "station_health": health,
            "api_base": api_base,
            "ionosphere_station": iono.get("station") if iono else None,
            "vtec_tecu": iono.get("vtec_tecu") if iono else None,
            "s4": round(s4, 2) if s4 is not None else None,
            "dst": round(dst, 1) if dst is not None else None,
            "solar_wind_speed": round(sw_speed) if sw_speed is not None else None,
            "solar_wind_density": round(sw_density, 1) if sw_density is not None else None,
            "station_data_status": station_data_status,
            "station_data_note": station_data_note,
            "ionosphere_data_status": ionosphere_status,
            "ionosphere_data_note": ionosphere_note,
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
