"""National Navigation & Space Weather social post templates (Facebook / X).

Short, sector-clear copy for public broadcasts — one template per storm tier.
Live posts pick the tier from current Kp/Dst/GNSS risk and regional forecast tone.
"""
from __future__ import annotations

from typing import Any, Literal

from zgiis.navigation.gnss_forecast import ForecastStatus, GnssForecastCity
from zgiis.navigation.national_gnss_status import build_national_gnss_status_block

StormSocialTier = Literal["mild", "moderate", "severe", "extreme"]

_TEMPLATES: dict[StormSocialTier, str] = {
    "mild": """🟡 Mild space weather

🇿🇼 ZINGSA Navigation Update

GPS for everyday use should work. Small wobbles possible.

🚗 Drivers – Map pin may drift briefly, then correct.
📐 Surveyors – RTK OK; allow a little extra time to Fix.
🌾 Farmers – Tractor GPS and planting can continue.
⚡ Power – Keep routine GIC watch on the grid.

Most people: use Maps as normal.

#ZINGSA #Zimbabwe #GPS""",
    "moderate": """🟠 Moderate space weather

🇿🇼 ZINGSA Navigation Alert

GPS may be slower or a few metres off — especially for precise work.

🚗 Drivers – Check the road, not only the app, at junctions.
📐 Surveyors – Longer RTK init; prefer morning occupations.
🌾 Farmers – Finish GPS field work before late morning.
⚡ Power – Watch GIC / transformer neutrals; minor geomagnetic disturbance.

Everyday maps still usable. Precision users: take care.

#ZINGSA #Zimbabwe #GPS #RTK""",
    "severe": """🔴 Severe space weather

🇿🇼 ZINGSA Navigation Warning

GPS may show the wrong place. Do not trust a pin alone.

🚗 Drivers – Confirm pickups by phone; watch junctions.
📐 Surveyors – Expect RTK drops; add control checks.
🌾 Farmers – Pause critical auto-steer / legal boundary work if you can.
⚡ Power – Heighten GIC monitoring on long HV lines.

ZINGSA is monitoring. Updates to follow.

#ZINGSA #Zimbabwe #GPS #SpaceWeather""",
    "extreme": """🟣 Extreme space weather

🇿🇼 ZINGSA National Advisory

GPS and precision GNSS may fail in places. Confirm locations by other means.

🚗 Drivers – GPS unreliable in some areas.
📐 Surveyors – Do not rely on cm GNSS until conditions ease.
🌾 Farmers – Delay centimetre farm GPS jobs.
⚡ Power – Increase grid / GIC monitoring.
📡 Telecom – Watch GNSS timing holds.

ZINGSA is monitoring via the national CORS network.

#ZINGSA #Zimbabwe #SpaceWeather #GPS""",
}


def resolve_storm_social_tier(tone: ForecastStatus, sw: dict[str, Any] | None) -> StormSocialTier:
    """Map live forecast tone + indices to one of four public social templates."""
    if tone == "excellent":
        return "mild"
    if tone == "moderate":
        return "moderate"
    kp = sw.get("kp") if sw else None
    dst = sw.get("dst") if sw else None
    risk = str(sw.get("gnss_risk") or "").lower() if sw else ""
    if (
        (kp is not None and kp >= 8)
        or (dst is not None and dst <= -150)
        or risk == "critical"
    ):
        return "extreme"
    return "severe"


def build_national_navigation_social(
    tone: ForecastStatus,
    sw: dict[str, Any] | None,
    *,
    computed_at: str | None = None,
    forecasts: list[GnssForecastCity] | None = None,
) -> str:
    """Return the national Facebook/X Navigation News post for the current storm tier."""
    tier = resolve_storm_social_tier(tone, sw)
    parts = [_TEMPLATES[tier]]
    if forecasts:
        parts.extend(["", build_national_gnss_status_block(forecasts, tone, sw)])
    if computed_at:
        stamp = computed_at.replace("T", " ").replace("Z", " UTC")[:19]
        parts.extend(["", f"Updated {stamp}"])
    return "\n".join(parts)
