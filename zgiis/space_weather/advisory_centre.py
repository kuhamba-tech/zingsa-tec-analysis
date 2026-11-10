"""ZINGSA Space Weather Advisory Centre — classification and statements.

Separates:
  1. Global geomagnetic storm severity (observed Kp / Dst / NOAA G-scale)
  2. Zimbabwe GNSS disturbance severity (measured VTEC / S4 when available)
  3. Solar-wind / solar-activity watch conditions (screening only)
  4. Forecast vs observed wording

Never invents measurements. Missing feeds are disclosed, not treated as quiet.
"""
from __future__ import annotations

import math
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from zgiis.space_weather import advisory_centre_config as cfg


def _utc(dt: datetime | None = None) -> datetime:
    if dt is None:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _iso(dt: datetime | None) -> str | None:
    return _utc(dt).isoformat().replace("+00:00", "Z") if dt else None


def _cat(dt: datetime) -> str:
    local = _utc(dt) + timedelta(hours=2)
    return local.strftime("%Y-%m-%d %H:%M CAT")


def _finite(value: Any) -> float | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _max_level(*levels: str) -> str:
    best = "GREEN"
    for level in levels:
        if cfg.LEVEL_RANK.get(level, 0) > cfg.LEVEL_RANK.get(best, 0):
            best = level
    return best


def noaa_g_from_kp(kp: float | None) -> dict[str, Any]:
    if kp is None:
        return {"code": None, "title": None, "is_storm": False, "note": "Observed Kp unavailable"}
    if kp < cfg.KP_G1:
        return {"code": "G0", "title": "Below G1", "is_storm": False, "note": f"Kp {kp:.1f} is below NOAA G1 (Kp 5)"}
    if kp < cfg.KP_G2:
        return {"code": "G1", "title": "Minor", "is_storm": True, "note": f"Kp {kp:.1f} → NOAA G1 Minor"}
    if kp < cfg.KP_G3:
        return {"code": "G2", "title": "Moderate", "is_storm": True, "note": f"Kp {kp:.1f} → NOAA G2 Moderate"}
    if kp < 8:
        return {"code": "G3", "title": "Strong", "is_storm": True, "note": f"Kp {kp:.1f} → NOAA G3 Strong"}
    if kp < 9:
        return {"code": "G4", "title": "Severe", "is_storm": True, "note": f"Kp {kp:.1f} → NOAA G4 Severe"}
    return {"code": "G5", "title": "Extreme", "is_storm": True, "note": f"Kp {kp:.1f} → NOAA G5 Extreme"}


def classify_solar_watch(
    *,
    speed: float | None,
    bz: float | None,
    bt: float | None,
    density: float | None,
    feed_available: bool,
) -> dict[str, Any]:
    evidence: list[str] = []
    if not feed_available and speed is None and bz is None:
        return {
            "level": "GREEN",
            "status": "unavailable",
            "evidence": ["Solar-wind / IMF data temporarily unavailable — watch conditions cannot be fully assessed."],
            "watch_active": False,
        }
    level = "GREEN"
    if speed is not None and speed >= cfg.WIND_WATCH_KMS:
        level = "YELLOW"
        evidence.append(
            f"Solar-wind speed {speed:.0f} km/s is at or above the {cfg.WIND_WATCH_KMS:.0f} km/s watch line. "
            "This is a screening indicator only — speed alone is not a geomagnetic storm."
        )
        if speed >= cfg.WIND_STRONG_WATCH_KMS:
            evidence.append(f"Speed also exceeds the strong-watch line ({cfg.WIND_STRONG_WATCH_KMS:.0f} km/s).")
    if bz is not None and bz <= cfg.BZ_SOUTH_WATCH_NT:
        level = _max_level(level, "YELLOW")
        evidence.append(
            f"IMF Bz {bz:.1f} nT is southward at or below {cfg.BZ_SOUTH_WATCH_NT:.0f} nT (coupling watch)."
        )
        if bz <= cfg.BZ_SOUTH_STRONG_NT:
            evidence.append(f"Bz is at or below the strong southward line ({cfg.BZ_SOUTH_STRONG_NT:.0f} nT).")
    if bt is not None and bt >= cfg.BT_ELEVATED_NT:
        level = _max_level(level, "YELLOW")
        evidence.append(f"IMF Bt {bt:.1f} nT is elevated (≥ {cfg.BT_ELEVATED_NT:.0f} nT).")
    if density is not None and density >= cfg.DENSITY_ELEVATED_CM3:
        level = _max_level(level, "YELLOW")
        evidence.append(f"Solar-wind density {density:.1f} cm⁻³ is elevated.")
    if not evidence:
        evidence.append("No elevated solar-wind / IMF watch indicators in the current sample.")
    # Critical rule: solar-watch track never exceeds YELLOW by itself.
    return {
        "level": "YELLOW" if cfg.LEVEL_RANK[level] >= 1 else "GREEN",
        "status": "watch" if level != "GREEN" else "quiet",
        "evidence": evidence,
        "watch_active": level != "GREEN",
    }


def classify_geomagnetic(*, kp: float | None, dst: float | None, kp_available: bool) -> dict[str, Any]:
    evidence: list[str] = []
    if not kp_available and kp is None and dst is None:
        return {
            "level": "GREEN",
            "status": "unavailable",
            "g_scale": noaa_g_from_kp(None),
            "evidence": ["Geomagnetic indices temporarily unavailable — storm conditions cannot be fully assessed."],
            "observed_storm": False,
        }
    g = noaa_g_from_kp(kp)
    level = "GREEN"
    if kp is not None:
        evidence.append(g["note"])
        if kp >= cfg.KP_G3:
            level = "RED"
            evidence.append("Observed Kp meets NOAA G3 or stronger — ZINGSA severe geomagnetic track.")
        elif kp >= cfg.KP_G1:
            level = "ORANGE"
            evidence.append("Observed Kp meets NOAA G1–G2 — warning track, not severe.")
    if dst is not None:
        evidence.append(f"Latest Dst {dst:.0f} nT.")
        if dst <= cfg.DST_STRONG_NT and level != "RED":
            level = _max_level(level, "ORANGE")
            evidence.append(f"Dst ≤ {cfg.DST_STRONG_NT:.0f} nT supports a strong ring-current depression (not a NOAA G label by itself).")
        elif dst <= cfg.DST_STORM_NT:
            level = _max_level(level, "ORANGE" if kp is not None and kp >= cfg.KP_G1 else "YELLOW")
            evidence.append(f"Dst ≤ {cfg.DST_STORM_NT:.0f} nT indicates storm-time ring current context.")
    if not evidence:
        evidence.append("No observed geomagnetic storm indicators in the current sample.")
    return {
        "level": level,
        "status": "storm" if level in {"ORANGE", "RED"} else ("watch" if level == "YELLOW" else "quiet"),
        "g_scale": g,
        "evidence": evidence,
        "observed_storm": bool(g.get("is_storm")) or (dst is not None and dst <= cfg.DST_STORM_NT),
    }


def classify_zimbabwe_gnss(
    *,
    vtec: float | None,
    s4: float | None,
    gnss_risk: str | None,
    local_available: bool,
) -> dict[str, Any]:
    evidence: list[str] = []
    if not local_available and vtec is None and s4 is None and not (gnss_risk or "").strip():
        return {
            "level": "GREEN",
            "status": "unavailable",
            "evidence": [
                "Zimbabwe GNSS / TEC measurements temporarily unavailable — local reliability cannot be confirmed."
            ],
            "confirmed_local_impact": False,
        }
    level = "GREEN"
    risk = (gnss_risk or "").strip().lower()
    if s4 is not None:
        evidence.append(f"Network S4 {s4:.2f}.")
        if s4 >= cfg.S4_SEVERE:
            level = "RED"
            evidence.append("S4 at/above severe scintillation screening threshold.")
        elif s4 >= cfg.S4_WARNING:
            level = _max_level(level, "ORANGE")
            evidence.append("S4 at/above warning scintillation screening threshold.")
        elif s4 >= cfg.S4_WATCH:
            level = _max_level(level, "YELLOW")
            evidence.append("S4 at/above watch scintillation screening threshold.")
    if vtec is not None:
        evidence.append(f"Network-mean VTEC {vtec:.1f} TECU.")
        if vtec >= cfg.VTEC_WATCH_TECU:
            level = _max_level(level, "YELLOW")
            evidence.append(
                f"VTEC ≥ {cfg.VTEC_WATCH_TECU:.0f} TECU is elevated relative to the provisional watch line; "
                "elevated TEC alone is not proof of positioning failure."
            )
    if risk in {"critical", "high"}:
        level = _max_level(level, "ORANGE" if risk == "high" else "RED")
        evidence.append(f"Platform GNSS risk label: {gnss_risk} (provisional until validated local ΔTEC/ROTI/RTK rules).")
    elif risk == "moderate":
        level = _max_level(level, "YELLOW")
        evidence.append(f"Platform GNSS risk label: {gnss_risk} (provisional).")
    elif risk in {"low", "unknown"} and risk:
        evidence.append(f"Platform GNSS risk label: {gnss_risk}.")
    if not evidence:
        evidence.append("No elevated local GNSS disturbance indicators in the current sample.")
    confirmed = level in {"ORANGE", "RED"} and (s4 is not None or risk in {"critical", "high"})
    return {
        "level": level,
        "status": "disturbance" if confirmed else ("watch" if level == "YELLOW" else "quiet"),
        "evidence": evidence,
        "confirmed_local_impact": confirmed,
    }


def overall_advisory_level(solar: dict[str, Any], geo: dict[str, Any], gnss: dict[str, Any]) -> str:
    """Combine tracks without letting wind-alone force ORANGE/RED."""
    solar_level = solar["level"]  # at most YELLOW by construction
    geo_level = geo["level"]
    gnss_level = gnss["level"]
    combined = _max_level(solar_level, geo_level, gnss_level)
    # If only solar watch is active and geo/gnss are quiet/unavailable-as-green, stay YELLOW.
    if solar.get("watch_active") and geo_level == "GREEN" and gnss_level == "GREEN":
        return "YELLOW"
    return combined


def stakeholder_advice(level: str, *, gnss: dict[str, Any], geo: dict[str, Any]) -> list[dict[str, str]]:
    local = gnss.get("confirmed_local_impact")
    storm = geo.get("observed_storm")
    base = {
        "surveying": {
            "title": "Surveying, mining and construction",
            "advice": (
                "Verify RTK solution quality, monitor correction availability, and perform independent "
                "positioning checks during disturbed conditions."
                if level != "GREEN"
                else "Continue normal precision operations while monitoring routine space-weather updates."
            ),
        },
        "aviation": {
            "title": "Aviation",
            "advice": (
                "Use this product for situational awareness only. "
                "ZINGSA space weather information does not replace approved aviation meteorological information, "
                "aeronautical warnings, certified SBAS integrity messages, or instructions issued by the relevant "
                "aviation authorities."
            ),
        },
        "satellite": {
            "title": "Satellite operators",
            "advice": (
                "Monitor GNSS-based orbit determination and communication links; atmospheric drag risk rises mainly "
                "during significant geomagnetic storms (observed G3+ context), not from solar-wind speed alone."
                if storm or level in {"ORANGE", "RED"}
                else "No elevated satellite-ops space-weather contingency is indicated from current observed indices."
            ),
        },
        "telecom": {
            "title": "Telecommunications",
            "advice": (
                "HF and GNSS-dependent timing users should watch for degradation and verify timing holdover during "
                "elevated geomagnetic or ionospheric conditions."
                if level != "GREEN"
                else "No elevated telecom contingency is indicated from current observed indices."
            ),
        },
        "power": {
            "title": "Power utilities",
            "advice": (
                "Geomagnetic disturbance context may elevate GIC interest. Confirmed GIC impacts are not claimed "
                "without actual GIC measurements or validated modelling."
                if storm or level in {"ORANGE", "RED"}
                else "No confirmed GIC impact is indicated; continue routine monitoring where instruments exist."
            ),
        },
    }
    if local and level in {"ORANGE", "RED"}:
        base["surveying"]["advice"] = (
            "Local GNSS disturbance indicators are elevated. Verify RTK solution quality, monitor correction "
            "availability, and perform independent positioning checks. Do not assume the disturbance equals a "
            "global geomagnetic storm unless observed Kp/Dst also support that classification."
        )
    return [{"id": key, **value} for key, value in base.items()]


def build_statement(assessment: dict[str, Any]) -> dict[str, Any]:
    level = assessment["advisory_level"]
    label = cfg.LEVEL_LABEL[level]
    issued = _utc(datetime.fromisoformat(assessment["issued_utc"].replace("Z", "+00:00")))
    ref = assessment["advisory_id"]
    solar = assessment["tracks"]["solar_watch"]
    geo = assessment["tracks"]["geomagnetic"]
    gnss = assessment["tracks"]["zimbabwe_gnss"]

    if level == "GREEN":
        body = (
            "Space weather conditions are currently not indicating significant disturbances affecting GNSS "
            "positioning services in Zimbabwe. Stakeholders may continue normal operations while monitoring "
            "routine updates."
        )
    elif level == "YELLOW":
        body = (
            "Elevated solar wind or solar activity has been observed. Although significant geomagnetic "
            "disturbances may not currently be confirmed, stakeholders are advised to monitor space weather "
            "developments and verify GNSS positioning performance during precision operations."
        )
    elif level == "ORANGE":
        if gnss.get("confirmed_local_impact") and not geo.get("observed_storm"):
            body = (
                "Significant GNSS disturbance indicators have been detected over Zimbabwe. This is a local "
                "reliability warning and is not by itself a global geomagnetic storm classification. Surveyors, "
                "aviation operators, satellite operators and other stakeholders are advised to monitor operational "
                "performance and implement appropriate precautions."
            )
        else:
            body = (
                "Geomagnetic storm conditions or significant GNSS disturbances have been detected. Surveyors, "
                "aviation operators, satellite operators and other stakeholders are advised to monitor operational "
                "performance and implement appropriate precautions."
            )
    else:
        body = (
            "Severe space weather conditions or significant GNSS disruptions have been detected. Stakeholders "
            "should implement appropriate operational contingency procedures and monitor official updates."
        )

    evidence_lines = [
        *solar.get("evidence", [])[:3],
        *geo.get("evidence", [])[:3],
        *gnss.get("evidence", [])[:3],
    ]
    return {
        "title": "ZINGSA SPACE WEATHER ADVISORY",
        "reference": ref,
        "issued_utc": assessment["issued_utc"],
        "issued_cat": _cat(issued),
        "level": level,
        "level_label": label,
        "status_line": f"Status: {level} — {label}",
        "body": body,
        "observed_conditions": evidence_lines,
        "forecast_note": assessment.get("forecast_note"),
        "potential_impacts": [
            item["advice"] for item in assessment["stakeholders"] if level != "GREEN" or item["id"] == "aviation"
        ],
        "precautions": [s["advice"] for s in assessment["stakeholders"]],
        "data_sources": assessment["data_sources"],
        "confidence": assessment["confidence"],
        "next_review_utc": assessment["next_review_utc"],
        "attribution": "ZINGSA Space Science Department — Space Weather Advisory Centre",
        "plain_text": _plain_text(ref, level, label, body, issued, assessment),
    }


def _plain_text(ref: str, level: str, label: str, body: str, issued: datetime, assessment: dict[str, Any]) -> str:
    evidence: list[str] = []
    for track in assessment["tracks"].values():
        evidence.extend(track.get("evidence") or [])
    lines = [
        "ZINGSA SPACE WEATHER ADVISORY",
        f"Reference: {ref}",
        f"Issued: {_iso(issued)} / {_cat(issued)}",
        f"Status: {level} — {label}",
        "",
        body,
        "",
        "Evidence:",
        *[f"- {e}" for e in evidence[:8]],
        "",
        f"Confidence: {assessment['confidence']['label']} — {assessment['confidence']['rationale']}",
        f"Next review: {assessment['next_review_utc']}",
        "ZINGSA Space Science Department — Space Weather Advisory Centre",
    ]
    return "\n".join(lines)


def compute_confidence(
    *,
    solar_ok: bool,
    geo_ok: bool,
    local_ok: bool,
    level: str,
) -> dict[str, str]:
    missing = []
    if not solar_ok:
        missing.append("solar-wind/IMF")
    if not geo_ok:
        missing.append("geomagnetic indices")
    if not local_ok:
        missing.append("Zimbabwe GNSS/TEC")
    if missing:
        return {
            "label": "Limited",
            "rationale": "Data temporarily incomplete (" + ", ".join(missing) + "); missing feeds are not treated as quiet.",
        }
    if level in {"ORANGE", "RED"}:
        return {
            "label": "Supported by observations",
            "rationale": "Classification is tied to measured indices and/or local GNSS indicators in this assessment.",
        }
    return {
        "label": "Routine monitoring",
        "rationale": "Available feeds are present; no elevated multi-track disturbance is confirmed.",
    }


def assess_advisory(
    *,
    kp: float | None = None,
    dst: float | None = None,
    plasma_speed: float | None = None,
    bz: float | None = None,
    bt: float | None = None,
    density: float | None = None,
    mean_vtec: float | None = None,
    s4: float | None = None,
    gnss_risk: str | None = None,
    updated_utc: str | None = None,
    solar_feed_available: bool = True,
    geo_feed_available: bool = True,
    local_feed_available: bool = True,
    forecast_note: str | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    moment = _utc(now)
    solar = classify_solar_watch(
        speed=_finite(plasma_speed),
        bz=_finite(bz),
        bt=_finite(bt),
        density=_finite(density),
        feed_available=solar_feed_available,
    )
    geo = classify_geomagnetic(kp=_finite(kp), dst=_finite(dst), kp_available=geo_feed_available)
    gnss = classify_zimbabwe_gnss(
        vtec=_finite(mean_vtec),
        s4=_finite(s4),
        gnss_risk=gnss_risk,
        local_available=local_feed_available,
    )
    level = overall_advisory_level(solar, geo, gnss)
    advisory_id = f"ZSWA-{moment.strftime('%Y%m%d')}-{uuid.uuid4().hex[:8].upper()}"
    confidence = compute_confidence(
        solar_ok=solar.get("status") != "unavailable",
        geo_ok=geo.get("status") != "unavailable",
        local_ok=gnss.get("status") != "unavailable",
        level=level,
    )
    assessment: dict[str, Any] = {
        "advisory_id": advisory_id,
        "issued_utc": _iso(moment),
        "issued_cat": _cat(moment),
        "advisory_level": level,
        "advisory_label": cfg.LEVEL_LABEL[level],
        "tracks": {
            "solar_watch": solar,
            "geomagnetic": geo,
            "zimbabwe_gnss": gnss,
        },
        "separation": {
            "global_geomagnetic_level": geo["level"],
            "zimbabwe_gnss_level": gnss["level"],
            "solar_watch_level": solar["level"],
            "note": (
                "Space-weather hazard and GNSS reliability are assessed separately. "
                "A global storm does not automatically imply Zimbabwe GNSS failure, and local "
                "ionospheric irregularities may disrupt GNSS without a major global storm."
            ),
        },
        "observations": {
            "kp": _finite(kp),
            "dst": _finite(dst),
            "plasma_speed": _finite(plasma_speed),
            "bz": _finite(bz),
            "bt": _finite(bt),
            "density": _finite(density),
            "mean_vtec": _finite(mean_vtec),
            "s4": _finite(s4),
            "gnss_risk": gnss_risk,
            "source_updated_utc": updated_utc,
        },
        "forecast_note": forecast_note
        or "Forecast products are shown separately from observed conditions when available; forecasts are not confirmed observations.",
        "stakeholders": stakeholder_advice(level, gnss=gnss, geo=geo),
        "confidence": confidence,
        "data_sources": [
            "NOAA SWPC / RTSW (solar wind, IMF) when available",
            "NOAA / GFZ planetary Kp when available",
            "Kyoto Dst when available",
            "ZINGSA CORS network VTEC / S4 when available",
        ],
        "thresholds": cfg.as_dict(),
        "next_review_utc": _iso(moment + timedelta(minutes=cfg.REVIEW_MINUTES)),
        "publication": {
            "state": "draft",
            "approved_by": None,
            "approved_at": None,
            "published_at": None,
        },
    }
    assessment["statement"] = build_statement(assessment)
    assessment["statement"]["plain_text"] = _plain_text(
        advisory_id, level, cfg.LEVEL_LABEL[level], assessment["statement"]["body"], moment, assessment
    )
    return assessment
