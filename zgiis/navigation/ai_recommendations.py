"""Compact sector recommendations — Python mirror of frontend/lib/aiRecommendations.ts."""
from __future__ import annotations

from typing import Any, Literal

from zgiis.navigation.gnss_forecast import GnssForecastCity
from zgiis.navigation.audience_news import _effective_navigation_tone

AiRecommendationAudience = Literal["surveyors", "farmers", "pilots", "power", "telecom"]

_SURVEYOR_HEADLINE: dict[ForecastStatus, str] = {
    "excellent": "Proceed.",
    "moderate": "Allow extra RTK occupation time.",
    "warning": "Delay centimetre-critical surveys.",
}

_FARMER_HEADLINE: dict[ForecastStatus, str] = {
    "excellent": "Good day for precision planting.",
    "moderate": "Plan GPS-heavy field work before late morning.",
    "warning": "Verify boundaries before legal or financial commitments.",
}


def _field(city: GnssForecastCity | None, label: str) -> str | None:
    if city is None:
        return None
    for f in city.fields:
        if f.get("label") == label:
            return f.get("value")
    return None


def _surveyor_detail(city: GnssForecastCity | None) -> str | None:
    if city is None:
        return None
    accuracy = _field(city, "Expected Accuracy")
    rtk = _field(city, "RTK Reliability")
    window = _field(city, "Best Survey Window") or "07:00 – 14:00"
    if not accuracy:
        return f"Survey window {window}" if window else None
    if city.status == "warning":
        return f"Expected accuracy {accuracy}"
    parts = [f"Expected accuracy {accuracy}"]
    if rtk:
        parts.append(f"RTK {rtk}")
    parts.append(f"Window {window}")
    return " · ".join(parts)


def _scintillation_pilot_note(sw: dict[str, Any] | None, tone: ForecastStatus) -> str:
    s4 = sw.get("s4") if sw else None
    if tone == "warning" or (s4 is not None and s4 >= 0.5):
        return "Significant scintillation possible 16:00–21:00 local — monitor RAIM and HF."
    if tone == "moderate" or (s4 is not None and s4 >= 0.15):
        return "Minor scintillation possible after 18:00 local."
    return "En-route GNSS within normal limits today."


def _power_gic_note(sw: dict[str, Any] | None, gic: dict[str, Any] | None) -> str:
    kp = sw.get("kp") if sw else None
    dst = sw.get("dst") if sw else None
    levels = [
        str(s.get("latest_level") or "").lower()
        for s in (gic or {}).get("stations") or []
        if isinstance(s, dict)
    ]

    if any(l in ("severe", "high", "large") for l in levels):
        return "GIC warning — elevated transformer-neutral currents detected."
    if (
        (kp is not None and kp >= 7)
        or (dst is not None and dst <= -100)
        or any(l == "elevated" for l in levels)
    ):
        return "Elevated GIC risk — increase monitoring on long transmission lines."
    if (kp is not None and kp >= 5) or (dst is not None and dst <= -50):
        return "Routine GIC monitoring — minor geomagnetic disturbance under way."
    return "No GIC warning."


def _telecom_note(sw: dict[str, Any] | None, tone: ForecastStatus) -> str:
    s4 = sw.get("s4") if sw else None
    kp = sw.get("kp") if sw else None
    if tone == "warning" or (s4 is not None and s4 >= 0.5) or (kp is not None and kp >= 6):
        return "Timing holds may degrade — verify GNSS-disciplined clocks and PTP."
    if tone == "moderate" or (s4 is not None and s4 >= 0.25):
        return "Minor timing jitter possible this afternoon on GNSS-linked links."
    return "Timing stable."


def build_ai_recommendations(
    forecasts: list[GnssForecastCity],
    sw: dict[str, Any] | None,
    gic: dict[str, Any] | None = None,
    computed_at: str | None = None,
) -> dict[str, Any]:
    tone = _effective_navigation_tone(forecasts, sw)
    by_city = {f.city: f for f in forecasts}
    harare = by_city.get("HARARE")
    mutare = by_city.get("MUTARE")
    survey_city = mutare or harare
    survey_status = survey_city.status if survey_city else tone
    farmer_status = harare.status if harare else tone

    survey_detail = _surveyor_detail(survey_city)
    farmer_window = _field(harare, "Best Survey Window")

    pilot_headline = {
        "excellent": "Routine GNSS navigation expected.",
        "moderate": "Monitor GPS approaches through the afternoon.",
        "warning": "Storm procedures — verify navaid backups.",
    }[tone]

    recs = [
        {
            "id": "surveyors",
            "label": "Surveyors",
            "icon": "📐",
            "headline": _SURVEYOR_HEADLINE[survey_status],
            "detail": survey_detail,
            "tone": survey_status,
        },
        {
            "id": "farmers",
            "label": "Farmers",
            "icon": "🌾",
            "headline": _FARMER_HEADLINE[farmer_status],
            "detail": None if farmer_status == "excellent" else (f"Preferred window {farmer_window}" if farmer_window else None),
            "tone": farmer_status,
        },
        {
            "id": "pilots",
            "label": "Pilots",
            "icon": "✈️",
            "headline": pilot_headline,
            "detail": _scintillation_pilot_note(sw, tone),
            "tone": tone,
        },
        {
            "id": "power",
            "label": "Power Utilities",
            "icon": "⚡",
            "headline": _power_gic_note(sw, gic),
            "detail": (
                f"Kp {sw['kp']} · Dst {'+' if sw['dst'] >= 0 else ''}{sw['dst']} nT"
                if sw and sw.get("kp") is not None and sw.get("dst") is not None
                else None
            ),
            "tone": tone,
        },
        {
            "id": "telecom",
            "label": "Telecommunications",
            "icon": "📡",
            "headline": _telecom_note(sw, tone),
            "detail": (
                f"S4 {sw['s4']:.2f} · ionospheric amplitude scintillation index"
                if sw and sw.get("s4") is not None
                else None
            ),
            "tone": tone,
        },
    ]

    return {
        "recommendations": recs,
        "tone": tone,
        "computed_at": computed_at,
    }
