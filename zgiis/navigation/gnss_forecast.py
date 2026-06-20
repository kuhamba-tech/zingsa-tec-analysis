"""GNSS city forecast engine — Python port of frontend/lib/gnssForecastEngine.ts."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal

ForecastStatus = Literal["excellent", "moderate", "warning"]

FORECAST_SITES = [
    {"city": "HARARE", "displayName": "Harare", "stationCodes": ["hara", "zinh", "hacy"]},
    {"city": "MUTARE", "displayName": "Mutare", "stationCodes": ["muta"]},
    {"city": "VICTORIA FALLS", "displayName": "Victoria Falls", "stationCodes": ["vicf"]},
]

STATUS_EMOJI = {"excellent": "🟢", "moderate": "🟡", "warning": "🟠"}


@dataclass
class GnssForecastCity:
    city: str
    emoji: str
    status: ForecastStatus
    statusLabel: str
    fields: list[dict[str, str]]
    cause: str | None = None
    recommendation: str | None = None
    effects: list[str] | None = None


def _norm_code(value: Any) -> str:
    return str(value or "").strip().lower()


def _pick_station(stations: list[Any], codes: list[str]) -> Any | None:
    by_code = {_norm_code(getattr(s, "code", None)): s for s in stations if _norm_code(getattr(s, "code", None))}
    candidates = [by_code.get(_norm_code(c)) for c in codes]
    candidates = [c for c in candidates if c is not None]
    if not candidates:
        return None

    def rank(s: Any) -> int:
        verdict = getattr(s, "ntrip_verdict", None)
        status = getattr(s, "status", "")
        if verdict == "msm_streaming":
            return 0
        if status == "online" and verdict != "rtcm_no_msm":
            return 1
        if verdict == "rtcm_no_msm":
            return 2
        if status == "degraded":
            return 3
        return 4

    return sorted(candidates, key=rank)[0]


def _iono_stress(sw: dict[str, Any] | None) -> float:
    if not sw:
        return 50.0
    score = 0.0
    kp = sw.get("kp") or 0
    s4 = sw.get("s4") or 0
    dst = sw.get("dst") or 0
    wind = sw.get("plasma_speed") or 400

    if kp >= 7:
        score += 45
    elif kp >= 5:
        score += 32
    elif kp >= 4:
        score += 22
    elif kp >= 3:
        score += 12

    if s4 >= 0.5:
        score += 35
    elif s4 >= 0.3:
        score += 22
    elif s4 >= 0.1:
        score += 10

    if dst <= -100:
        score += 15
    elif dst <= -50:
        score += 8

    if wind > 600:
        score += 12
    elif wind > 450:
        score += 6

    risk = _norm_code(sw.get("gnss_risk"))
    if risk in ("critical", "high"):
        score += 18
    elif risk == "moderate":
        score += 8

    return min(100.0, score)


def _feed_reliability(station: Any | None) -> float:
    if station is None:
        return 0.0
    verdict = getattr(station, "ntrip_verdict", None)
    status = getattr(station, "status", "")
    if verdict == "msm_streaming":
        return 96.0
    if verdict == "rtcm_no_msm":
        return 48.0
    if verdict == "connected_no_data":
        return 28.0
    if status == "online":
        return 72.0
    if status == "degraded":
        return 45.0
    return 12.0


def _combined_status(iono: float, feed: float) -> ForecastStatus:
    blended = iono * 0.55 + (100 - feed) * 0.45
    if blended >= 55:
        return "warning"
    if blended >= 28:
        return "moderate"
    return "excellent"


def _status_label(status: ForecastStatus) -> str:
    return {"excellent": "Excellent", "moderate": "Moderate", "warning": "Warning"}[status]


def _expected_accuracy(iono: float, feed: float) -> str:
    stress = iono * 0.6 + (100 - feed) * 0.4
    if stress < 20:
        return "1–2 cm"
    if stress < 40:
        return "3–5 cm"
    if stress < 55:
        return "5–10 cm"
    if stress < 70:
        return "10–20 cm"
    return "> 20 cm"


def _survey_window(iono: float) -> str:
    return "07:00 – 11:00" if iono >= 40 else "07:00 – 14:00"


def _satellite_note(station: Any | None) -> str:
    if station is None:
        return "No CORS feed"
    constellations = getattr(station, "constellations", None) or []
    n = len(constellations)
    verdict = getattr(station, "ntrip_verdict", None)
    if verdict == "msm_streaming" and n >= 3:
        return f"Good geometry ({n} constellations, MSM live)"
    if verdict == "msm_streaming":
        return "MSM observations live"
    if n >= 2:
        return f"{n} constellations — RTCM without MSM"
    return getattr(station, "site_status_label", None) or getattr(station, "status", "")


def _build_cause(sw: dict[str, Any] | None, station: Any | None) -> str | None:
    parts: list[str] = []
    if sw and sw.get("kp") is not None:
        parts.append(f"Kp {sw['kp']:.1f} ({sw.get('kp_condition') or 'geomagnetic'})")
    if sw and sw.get("s4") is not None:
        parts.append(f"S4 {sw['s4']:.2f}")
    if sw and sw.get("dst") is not None:
        dst = sw["dst"]
        parts.append(f"Dst {'+' if dst >= 0 else ''}{dst} nT")
    if station and getattr(station, "ntrip_verdict", None):
        code = _norm_code(getattr(station, "code", "")).upper()
        parts.append(f"NTRIP {station.ntrip_verdict.replace('_', ' ')} @ {code}")
    elif station:
        parts.append(f"CORS {station.status} ({getattr(station, 'status_source', 'unknown')})")
    return " · ".join(parts) if parts else None


def _build_recommendation(status: ForecastStatus, station: Any | None) -> str | None:
    if status == "excellent":
        return None
    if station and getattr(station, "ntrip_verdict", None) == "rtcm_no_msm":
        return "Caster connected but no MSM — verify receiver/caster MSM output"
    if status == "warning":
        return "Postpone precision RTK/drone ops; use dual-frequency validation"
    return "Use network correction and monitor live space-weather indices"


def _build_effects(status: ForecastStatus, iono: float) -> list[str] | None:
    if status != "warning":
        return None
    effects = ["Longer RTK fixing time", "Reduced accuracy"]
    if iono >= 60:
        effects.append("Drone mapping risk")
    if iono >= 45:
        effects.append("Elevated after 16:00 local (afternoon scintillation window)")
    return effects


def _build_forecast(site: dict[str, Any], station: Any | None, sw: dict[str, Any] | None) -> GnssForecastCity:
    iono = _iono_stress(sw)
    feed = _feed_reliability(station)
    status = _combined_status(iono, feed)
    rtk_pct = round(max(5, min(99, feed - iono * 0.35)))

    fields = [
        {"label": "GNSS Condition", "value": _status_label(status)},
        {"label": "RTK Reliability", "value": f"{rtk_pct}%"},
        {"label": "Expected Accuracy", "value": _expected_accuracy(iono, feed)},
        {"label": "Best Survey Window", "value": _survey_window(iono)},
        {"label": "Satellites", "value": _satellite_note(station)},
    ]

    tec = getattr(station, "current_tec", None) if station else None
    if tec is not None and tec > 0:
        fields.append({"label": "VTEC (station)", "value": f"{tec:.1f} TECU"})
    site_code = _norm_code(getattr(station, "code", "")) if station else ""
    if site_code:
        fields.append({"label": "CORS site", "value": site_code.upper()})

    return GnssForecastCity(
        city=site["city"],
        emoji=STATUS_EMOJI[status],
        status=status,
        statusLabel=_status_label(status),
        fields=fields,
        cause=_build_cause(sw, station),
        recommendation=_build_recommendation(status, station),
        effects=_build_effects(status, iono),
    )


@dataclass
class GnssForecastBundle:
    forecasts: list[GnssForecastCity]
    computedAt: str
    inputSummary: str
    sources: dict[str, bool] = field(default_factory=dict)


def build_gnss_forecast_bundle(
    sw: dict[str, Any] | None,
    stations: list[Any],
) -> GnssForecastBundle:
    safe_stations = stations if isinstance(stations, list) else []
    forecasts = [
        _build_forecast(site, _pick_station(safe_stations, site["stationCodes"]), sw)
        for site in FORECAST_SITES
    ]

    has_sw = sw is not None and any(sw.get(k) is not None for k in ("kp", "s4", "gnss_risk"))
    has_cors = len(safe_stations) > 0
    has_ntrip = any(getattr(s, "ntrip_verdict", None) for s in safe_stations)

    parts: list[str] = []
    if has_sw and sw:
        kp_v = sw.get("kp")
        s4_v = sw.get("s4")
        kp_s = f"{kp_v:.1f}" if isinstance(kp_v, (int, float)) else "N/A"
        s4_s = f"{s4_v:.2f}" if isinstance(s4_v, (int, float)) else "N/A"
        parts.append(
            f"Space weather: Kp {kp_s}, S4 {s4_s}, risk {sw.get('gnss_risk', 'N/A')}"
        )
    if has_cors:
        msm = sum(1 for s in safe_stations if getattr(s, "ntrip_verdict", None) == "msm_streaming")
        parts.append(f"CORS/NTRIP: {len(safe_stations)} sites probed, {msm} MSM streaming")

    computed_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return GnssForecastBundle(
        forecasts=forecasts,
        computedAt=computed_at,
        inputSummary=" · ".join(parts) if parts else "Awaiting live feeds",
        sources={"spaceWeather": has_sw, "corsStations": has_cors, "ntripProbe": has_ntrip},
    )
