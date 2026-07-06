"""Audience navigation news briefs — Python port of frontend/lib/gnssAudienceNews.ts."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Literal

from zgiis.navigation.gnss_forecast import ForecastStatus, GnssForecastCity
from zgiis.navigation.national_navigation_social import build_national_navigation_social
from zgiis.navigation.zingsa_contact import (
    ZINGSA_AGENCY,
    ZINGSA_BROADCAST_FOOTER,
    ZINGSA_NAVIGATION_CHANNELS,
    ZINGSA_NAVIGATION_MODERATE_ACTION,
    ZINGSA_NAVIGATION_WARNING_ACTION,
    ZINGSA_PHONE,
)

AudienceId = Literal["farmer", "surveyor", "citizen", "driver", "aviation", "scientist"]


@dataclass
class NavigationNewsBrief:
    id: AudienceId
    icon: str
    title: str
    audience: str
    headline: str
    summary: str
    space_weather_today: str
    space_weather_bullets: list[str]
    bullets: list[str]
    action: str
    status_tone: ForecastStatus
    broadcast_script: str
    social_script: str
    channels: list[str]


@dataclass
class _SpaceWeatherLayman:
    headline: str
    explainer: str
    readout: list[str]
    impact: str


def _by_city(forecasts: list[GnssForecastCity]) -> dict[str, GnssForecastCity]:
    return {f.city: f for f in forecasts}


def _field(city: GnssForecastCity | None, label: str) -> str | None:
    if city is None:
        return None
    for f in city.fields:
        if f.get("label") == label:
            return f.get("value")
    return None


def _national_tone(forecasts: list[GnssForecastCity]) -> ForecastStatus:
    if any(f.status == "warning" for f in forecasts):
        return "warning"
    if any(f.status == "moderate" for f in forecasts):
        return "moderate"
    return "excellent"


_TONE_RANK: dict[ForecastStatus, int] = {"excellent": 0, "moderate": 1, "warning": 2}


def _space_weather_floor(sw: dict[str, Any] | None) -> ForecastStatus:
    if not sw:
        return "excellent"
    kp = sw.get("kp")
    dst = sw.get("dst")
    s4 = sw.get("s4")
    risk = str(sw.get("gnss_risk") or "").lower()

    if (
        (kp is not None and kp >= 7)
        or (dst is not None and dst <= -100)
        or (s4 is not None and s4 >= 0.5)
        or risk == "critical"
        or (kp is not None and kp >= 5 and dst is not None and dst <= -50)
    ):
        return "warning"
    if (
        (kp is not None and kp >= 5)
        or (dst is not None and dst <= -50)
        or (s4 is not None and s4 >= 0.3)
        or risk == "high"
    ):
        return "moderate"
    return "excellent"


def _effective_navigation_tone(forecasts: list[GnssForecastCity], sw: dict[str, Any] | None) -> ForecastStatus:
    from_forecasts = _national_tone(forecasts)
    from_sw = _space_weather_floor(sw)
    return from_forecasts if _TONE_RANK[from_forecasts] >= _TONE_RANK[from_sw] else from_sw


def _status_word(status: ForecastStatus) -> str:
    if status == "excellent":
        return "Excellent"
    if status == "moderate":
        return "Moderate"
    return "Poor"


def _format_utc(iso: str) -> str:
    return iso.replace("T", " ").replace("Z", " UTC")[:19]


def _join_script(lines: list[str]) -> str:
    return "\n".join(line for line in lines if line)


def _fmt_num(value: float | int | None, digits: int = 1) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return "N/A"
    return f"{float(value):.{digits}f}"


def _kp_layman(kp: float | int | None) -> str:
    if kp is None:
        return "Geomagnetic activity: data updating"
    if kp <= 2:
        return f"Geomagnetic activity is quiet (Kp {_fmt_num(kp)} — like calm weather for Earth's magnetic field)"
    if kp <= 4:
        return f"Geomagnetic activity is unsettled (Kp {_fmt_num(kp)} — minor solar influence on Earth's field)"
    if kp <= 6:
        return f"Geomagnetic activity is elevated (Kp {_fmt_num(kp)} — a minor geomagnetic storm is under way)"
    return f"Geomagnetic activity is strong (Kp {_fmt_num(kp)} — a significant geomagnetic storm is affecting Earth)"


def _s4_layman(s4: float | int | None) -> str:
    if s4 is None:
        return "GPS signal stability: data updating"
    if s4 < 0.15:
        return f"GPS signal path is stable (S4 {_fmt_num(s4, 2)} — the ionosphere is calm)"
    if s4 < 0.3:
        return f"GPS signals may flicker slightly (S4 {_fmt_num(s4, 2)} — the ionosphere is restless)"
    return f"GPS signals are disturbed (S4 {_fmt_num(s4, 2)} — strong ionospheric scintillation over Zimbabwe)"


def _dst_layman(dst: float | int | None) -> str:
    if dst is None:
        return "Solar wind pressure on Earth: data updating"
    if dst > -30:
        return f"Earth's magnetosphere is steady (Dst {_fmt_num(dst, 0)} nT)"
    if dst > -50:
        return f"Earth's magnetic field is being pushed (Dst {_fmt_num(dst, 0)} nT — mild solar wind pressure)"
    if dst > -100:
        return f"Magnetic field disturbance detected (Dst {_fmt_num(dst, 0)} nT — navigation may feel it)"
    return f"Strong magnetic disturbance (Dst {_fmt_num(dst, 0)} nT — part of an active space-weather event)"


def _risk_layman(risk: str | None) -> str:
    r = (risk or "unknown").lower()
    if r == "low":
        return "Overall GNSS risk today: Low — everyday positioning should be fine"
    if r == "moderate":
        return "Overall GNSS risk today: Moderate — some users may notice slower GPS"
    if r in ("high", "critical"):
        return "Overall GNSS risk today: High — expect positioning problems in affected areas"
    return f"Overall GNSS risk today: {risk or 'updating'}"


def build_space_weather_layman(
    sw: dict[str, Any] | None,
    tone: ForecastStatus,
) -> _SpaceWeatherLayman:
    kp = sw.get("kp") if sw else None
    s4 = sw.get("s4") if sw else None
    dst = sw.get("dst") if sw else None
    wind = sw.get("plasma_speed") if sw else None
    risk = sw.get("gnss_risk") if sw else None
    kp_cond = (sw.get("kp_condition") if sw else None) or "updating"

    headlines: dict[ForecastStatus, str] = {
        "excellent": "Quiet space weather — the Sun is not disturbing our navigation today",
        "moderate": "Mild space weather — the Sun is gently affecting signals above Zimbabwe",
        "warning": "Active space weather — solar and magnetic activity is impacting navigation",
    }

    explainers: dict[ForecastStatus, str] = {
        "excellent": (
            "Space weather is what the Sun and near-Earth space do to our planet — solar wind, flares, "
            "and magnetic storms. When conditions are quiet, the high-altitude layer that carries GPS signals "
            "(the ionosphere) stays smooth. Most people never see this science, but every map pin, taxi route, "
            "and farm GPS depends on it."
        ),
        "moderate": (
            "The Sun constantly sends charged particles toward Earth. Today those particles are stirring the "
            "ionosphere — the invisible shell where navigation satellites talk to your phone. Think of it like "
            "radio static in the sky: signals still get through, but they may wobble for a few seconds or drift "
            "a few metres."
        ),
        "warning": (
            "A burst of solar or geomagnetic activity is disturbing the ionosphere over southern Africa. "
            "Satellite signals are taking longer paths or fading in and out — the same physics behind auroras "
            "and radio blackouts, but felt on your phone as wrong map pins, lost GPS, or delayed location updates."
        ),
    }

    impacts: dict[ForecastStatus, str] = {
        "excellent": (
            "For most Zimbabweans this is invisible good news: maps, mobile money location checks, "
            "and in-car navigation should behave normally."
        ),
        "moderate": (
            "You may notice your phone taking longer to find you, delivery apps showing a wider blue dot, or "
            "precision equipment (surveyors, farmers) needing extra patience — especially in the afternoon."
        ),
        "warning": (
            "Ordinary navigation can mislead you today. Do not trust a map pin alone for remote travel or meeting "
            "someone at an exact spot. Space weather is temporary, but while it lasts, confirm locations by sight, "
            f"address, or phone — or call ZINGSA on {ZINGSA_PHONE} for navigation guidance."
        ),
    }

    readout: list[str] = [
        _kp_layman(kp),
        _s4_layman(s4),
        _dst_layman(dst),
        _risk_layman(risk),
    ]

    if wind is not None:
        readout.append(
            f"Solar wind is fast ({_fmt_num(wind, 0)} km/s — energetic particles reaching Earth)"
            if wind > 500
            else f"Solar wind speed: {_fmt_num(wind, 0)} km/s (typical background level)"
        )

    if kp_cond and kp_cond != "updating":
        readout.append(f"NOAA summary: {kp_cond} geomagnetic conditions")

    return _SpaceWeatherLayman(
        headline=headlines[tone],
        explainer=explainers[tone],
        readout=readout,
        impact=impacts[tone],
    )


def _citizen_brief(
    forecasts: list[GnssForecastCity],
    tone: ForecastStatus,
    sw: dict[str, Any] | None,
    computed_at: str,
) -> NavigationNewsBrief:
    status = tone
    sw_ctx = build_space_weather_layman(sw, tone)
    regions = " · ".join(
        f"{f.city.replace('VICTORIA FALLS', 'Vic Falls')}: {f.statusLabel}" for f in forecasts
    )

    headlines: dict[ForecastStatus, str] = {
        "excellent": "Space weather is calm — your everyday apps should work as usual",
        "moderate": "Space weather is mildly active — your phone location may wobble a little",
        "warning": "Space weather alert — satellite navigation may let you down today",
    }

    summaries: dict[ForecastStatus, str] = {
        "excellent": (
            "Did you know your phone's location comes from satellites passing through space weather? Today the Sun "
            "is quiet, Earth's magnetic field is stable, and the ionosphere over Zimbabwe is smooth. That means "
            "Google Maps, WhatsApp live location, and ride-hailing apps can find you reliably."
        ),
        "moderate": (
            "Space weather is the 'weather in space' — solar wind and magnetic storms that ripple through the "
            "ionosphere where GPS signals travel. Today those ripples are small but real. Your phone might take a "
            "few extra seconds to lock on, or show you standing across the street from where you actually are. It "
            "is not your phone breaking; it is the sky above you shifting."
        ),
        "warning": (
            "When the Sun throws energy at Earth, navigation satellites and your phone feel it first. Today "
            "geomagnetic and ionospheric activity is high enough to disturb positioning across parts of Zimbabwe. "
            f"Maps may show the wrong place and rides may pick up at the wrong corner — call {ZINGSA_AGENCY} on {ZINGSA_PHONE} if you "
            "need help understanding conditions in your area."
        ),
    }

    bullets: dict[ForecastStatus, list[str]] = {
        "excellent": [
            "What you can do today: use maps and location apps normally",
            f"Navigation outlook nationwide: {_status_word(status)}",
            f"Regional detail: {regions}",
            "Why it matters: even on calm days, ZINGSA monitors space weather to protect farmers, drivers, and surveyors",
        ],
        "moderate": [
            "What you might notice: slower GPS lock, blue dot a few metres off, apps saying ‘searching for GPS’",
            f"Navigation outlook nationwide: {_status_word(status)}",
            f"Regional detail: {regions}",
            "Step outside with a clear view of the sky if your location looks wrong — buildings plus space weather make it worse",
        ],
        "warning": [
            "What you might notice: wrong map pins, ‘GPS signal lost’, delivery drivers at the wrong gate",
            f"Navigation outlook nationwide: {_status_word(status)}",
            f"Regional detail: {regions}",
            "Tell family your travel route; keep offline maps or landmarks as backup",
        ],
    }

    actions: dict[ForecastStatus, str] = {
        "excellent": "No action needed. Enjoy the day — and know that quiet space weather is why your navigation works.",
        "moderate": ZINGSA_NAVIGATION_MODERATE_ACTION,
        "warning": ZINGSA_NAVIGATION_WARNING_ACTION,
    }

    broadcast = _join_script([
        "🇿🇼 *ZINGSA Navigation News — Space Weather & You*",
        _format_utc(computed_at),
        "",
        "🌌 *What is space weather?*",
        "Activity on the Sun and in near-Earth space — solar wind, flares, and magnetic storms — that changes the ionosphere where GPS signals travel.",
        "",
        f"*Today:* {sw_ctx.headline}",
        "",
        summaries[status],
        "",
        "*Live conditions (plain language):*",
        *[f"• {b}" for b in sw_ctx.readout],
        "",
        "*What this means for ordinary life:*",
        sw_ctx.impact,
        "",
        *[f"• {b}" for b in bullets[status]],
        "",
        f"👉 *Action:* {actions[status]}",
        "",
        *ZINGSA_BROADCAST_FOOTER,
    ])

    social = build_national_navigation_social(status, sw, computed_at=computed_at, forecasts=forecasts)

    return NavigationNewsBrief(
        id="citizen",
        icon="🌌",
        title="Space Weather & You",
        audience="General citizens, schools & community groups",
        headline=headlines[status],
        summary=summaries[status],
        space_weather_today=f"{sw_ctx.headline} {sw_ctx.explainer}",
        space_weather_bullets=sw_ctx.readout,
        bullets=bullets[status],
        action=actions[status],
        status_tone=status,
        broadcast_script=broadcast,
        social_script=social,
        channels=[*ZINGSA_NAVIGATION_CHANNELS, "Facebook Page", "X / Twitter", "Community WhatsApp", "Radio bulletins", "School outreach"],
    )


def _farmer_brief(
    harare: GnssForecastCity | None,
    tone: ForecastStatus,
    sw: dict[str, Any] | None,
    computed_at: str,
) -> NavigationNewsBrief:
    status = harare.status if harare else tone
    sw_ctx = build_space_weather_layman(sw, tone)
    window = _field(harare, "Best Survey Window") or "07:00 – 14:00"
    rtk = _field(harare, "RTK Reliability") or "See live forecast"
    accuracy = _field(harare, "Expected Accuracy") or "See live forecast"

    headlines: dict[ForecastStatus, str] = {
        "excellent": "Quiet space weather — good day for GPS-guided farming",
        "moderate": "Mild space weather — schedule precision field work for the morning",
        "warning": "Space weather disturbing GPS — caution with auto-steer and drone mapping",
    }

    summaries: dict[ForecastStatus, str] = {
        "excellent": (
            "Solar activity is low and the ionosphere over Harare is stable. Space weather is not interfering with "
            "tractor auto-steer, boundary mapping, or variable-rate spraying. Your GPS equipment is working in a calm sky."
        ),
        "moderate": (
            "Space weather is stirring the ionosphere. Tractor GPS and agricultural drones still work, but satellite "
            "signals may drift slightly — especially after midday when scintillation often peaks. Space weather is the "
            "invisible reason your receiver may need longer to ‘fix’."
        ),
        "warning": (
            "Active space weather is degrading precision GNSS over central Zimbabwe. The same solar and magnetic forces "
            "that cause auroras are now thickening and rippling the ionosphere, so RTK and auto-steer may drift beyond "
            "normal limits. Verify boundaries before any legal or financial commitments."
        ),
    }

    bullets: dict[ForecastStatus, list[str]] = {
        "excellent": [
            f"Field GPS outlook: {_status_word(status)} (Harare / HARA–ZINH)",
            f"RTK reliability: {rtk} · Accuracy: {accuracy}",
            f"Best work window: {window}",
            "Space weather impact on farming today: minimal",
        ],
        "moderate": [
            f"Field GPS outlook: {_status_word(status)} (Harare / HARA–ZINH)",
            f"RTK reliability: {rtk} · Accuracy: {accuracy}",
            f"Preferred window: {window} — before afternoon ionospheric disturbance",
            "Space weather may add minutes to GPS lock on long boundary runs",
        ],
        "warning": [
            f"Field GPS outlook: {_status_word(status)} (Harare / HARA–ZINH)",
            f"RTK reliability: {rtk} · Accuracy: {accuracy}",
            "Space weather is the driver — postpone centimetre-level mapping if possible",
            "Use known ground control points before accepting drone or auto-steer boundaries",
        ],
    }

    actions: dict[ForecastStatus, str] = {
        "excellent": "Proceed with precision agriculture. Quiet space weather supports reliable GPS.",
        "moderate": "Plan GPS-heavy tasks before 11:00 when space weather effects are usually lighter.",
        "warning": "Treat GPS boundaries with caution until space weather settles — use backup surveying if stakes are high.",
    }

    broadcast = _join_script([
        "🌱 *ZINGSA Navigation News — Farmers*",
        f"📍 Harare & surrounds · {_format_utc(computed_at)}",
        "",
        f"🌌 *Space weather today:* {sw_ctx.headline}",
        *[f"• {b}" for b in sw_ctx.readout[:3]],
        "",
        headlines[status],
        "",
        summaries[status],
        "",
        *[f"• {b}" for b in bullets[status]],
        "",
        f"👉 *Action:* {actions[status]}",
        "",
        *ZINGSA_BROADCAST_FOOTER,
    ])

    social = _join_script([
        "🌱 ZINGSA Navigation News | Farmers",
        sw_ctx.headline,
        headlines[status],
        f"Window {window} · RTK {rtk}",
        "#SpaceWeather #PrecisionAg #Zimbabwe",
    ])

    return NavigationNewsBrief(
        id="farmer",
        icon="🌱",
        title="Farmer Brief",
        audience="Farmers, agronomists & smart-agri operators",
        headline=headlines[status],
        summary=summaries[status],
        space_weather_today=f"{sw_ctx.headline} {sw_ctx.impact}",
        space_weather_bullets=sw_ctx.readout,
        bullets=bullets[status],
        action=actions[status],
        status_tone=status,
        broadcast_script=broadcast,
        social_script=social,
        channels=[*ZINGSA_NAVIGATION_CHANNELS, "WhatsApp farmer groups", "In-app alerts", "Facebook Page"],
    )


def _surveyor_brief(
    mutare: GnssForecastCity | None,
    harare: GnssForecastCity | None,
    tone: ForecastStatus,
    sw: dict[str, Any] | None,
    computed_at: str,
) -> NavigationNewsBrief:
    primary = mutare or harare
    status = primary.status if primary else tone
    sw_ctx = build_space_weather_layman(sw, tone)
    site = "Mutare (MUTA)" if primary and primary.city == "MUTARE" else "Harare (HARA/ZINH)"
    accuracy = _field(primary, "Expected Accuracy") or "See live forecast"
    rtk = _field(primary, "RTK Reliability") or "See live forecast"
    window = _field(primary, "Best Survey Window") or "07:00 – 14:00"

    headlines: dict[ForecastStatus, str] = {
        "excellent": "Quiet ionosphere — survey-grade GNSS is reliable today",
        "moderate": "Space weather adding noise — allow extra RTK occupation time",
        "warning": "Space weather event — expect degraded survey accuracy",
    }

    summaries: dict[ForecastStatus, str] = {
        "excellent": (
            "Geomagnetic and ionospheric conditions are calm. Space weather is not adding significant error to RTK "
            "baselines or CORS corrections. Standard cadastral and engineering surveys can proceed."
        ),
        "moderate": (
            "Elevated space weather is increasing ionospheric delay and scintillation. RTK initialization may take "
            "longer and fixed solutions may slip during midday. This is a space-weather effect, not necessarily a "
            "faulty receiver or caster."
        ),
        "warning": (
            "A space-weather disturbance is active. The ionosphere over eastern/central Zimbabwe is turbulent — "
            "the layer your satellite corrections pass through. Centimetre-level GNSS alone may not meet legal survey "
            "standards today; plan redundancy."
        ),
    }

    warning_bullets = [
        f"Survey site: {site} · GNSS: {_status_word(status)}",
        f"Expected accuracy: {accuracy}",
        "Space weather is dominating the error budget — verify control points independently",
        f"Live drivers: {primary.cause}" if primary and primary.cause else "Monitor Kp and S4 before mobilising",
    ]

    bullets: dict[ForecastStatus, list[str]] = {
        "excellent": [
            f"Survey site: {site} · GNSS: {_status_word(status)}",
            f"Expected accuracy: {accuracy} · RTK: {rtk}",
            f"Window: {window}",
            "Space weather contribution to error: negligible",
        ],
        "moderate": [
            f"Survey site: {site} · GNSS: {_status_word(status)}",
            f"Expected accuracy: {accuracy} · RTK: {rtk}",
            "Space weather: allow 15–30% longer initialization",
            f"Best occupation: {window}",
        ],
        "warning": warning_bullets,
    }

    actions: dict[ForecastStatus, str] = {
        "excellent": "Mobilise crews as planned. Space weather is not a limiting factor today.",
        "moderate": "Brief crews: space weather may extend fix times. Prefer morning occupations.",
        "warning": "Delay centimetre-critical submissions or deploy total-station redundancy until conditions ease.",
    }

    broadcast = _join_script([
        "📐 *ZINGSA Navigation News — Surveyors*",
        f"📍 {site} · {_format_utc(computed_at)}",
        "",
        f"🌌 *Space weather:* {sw_ctx.headline}",
        *[f"• {b}" for b in sw_ctx.readout],
        "",
        headlines[status],
        "",
        summaries[status],
        "",
        *[f"• {b}" for b in bullets[status]],
        "",
        f"👉 *Action:* {actions[status]}",
        "",
        *ZINGSA_BROADCAST_FOOTER,
    ])

    social = _join_script([
        "📐 ZINGSA Navigation News | Surveyors",
        sw_ctx.headline,
        f"{site} · {accuracy}",
        "#SpaceWeather #Surveying #RTK #Zimbabwe",
    ])

    return NavigationNewsBrief(
        id="surveyor",
        icon="📐",
        title="Surveyor Brief",
        audience="Land surveyors, engineers & cadastral teams",
        headline=headlines[status],
        summary=summaries[status],
        space_weather_today=f"{sw_ctx.headline} {sw_ctx.explainer}",
        space_weather_bullets=sw_ctx.readout,
        bullets=bullets[status],
        action=actions[status],
        status_tone=status,
        broadcast_script=broadcast,
        social_script=social,
        channels=[*ZINGSA_NAVIGATION_CHANNELS, "WhatsApp surveyor groups", "In-app alerts", "LinkedIn"],
    )


def _driver_brief(
    forecasts: list[GnssForecastCity],
    tone: ForecastStatus,
    sw: dict[str, Any] | None,
    computed_at: str,
) -> NavigationNewsBrief:
    status = tone
    sw_ctx = build_space_weather_layman(sw, tone)
    vicf = next((f for f in forecasts if f.city == "VICTORIA FALLS"), None)
    harare = next((f for f in forecasts if f.city == "HARARE"), None)

    if vicf and vicf.status == "warning":
        corridor_note = (
            "Western corridor (Victoria Falls): space weather may widen GPS error — read road signs, not only the app."
        )
    elif harare and harare.status == "excellent":
        corridor_note = "Harare urban routes: space weather is quiet — taxi and delivery GPS should be normal."
    else:
        corridor_note = "Some corridors may show map offsets when space weather disturbs the ionosphere."

    headlines: dict[ForecastStatus, str] = {
        "excellent": "Calm space weather — in-car and taxi navigation should be trustworthy",
        "moderate": "Mild space weather — watch for map pins that drift from the road",
        "warning": "Space weather alert for drivers — GPS may mislead you at junctions",
    }

    summaries: dict[ForecastStatus, str] = {
        "excellent": (
            "Space weather is not interfering with the satellite signals your dashboard, taxi meter, or ride-hailing "
            "app uses. Solar activity is low and the ionosphere is stable — the invisible conditions behind accurate "
            "ETAs and turn-by-turn directions."
        ),
        "moderate": (
            "Space weather is making the ionosphere slightly uneven. You may see your car icon jump lanes, routes "
            "recalculate more often, or a passenger pickup pin land on the wrong side of the road. The road is still "
            "there — the satellite geometry is temporarily messy."
        ),
        "warning": (
            "Active space weather is degrading GNSS for fleets and private drivers alike. Do not follow a turn arrow "
            "blindly in an unfamiliar area. The same magnetic and solar forces affecting surveyors and farmers are "
            "shifting the signals your navigation app depends on."
        ),
    }

    bullets: dict[ForecastStatus, list[str]] = {
        "excellent": [
            f"Driving GPS outlook: {_status_word(status)}",
            corridor_note,
            "Space weather impact on navigation: none significant",
            "Ride-hailing, buses, delivery: normal",
        ],
        "moderate": [
            f"Driving GPS outlook: {_status_word(status)}",
            corridor_note,
            "Space weather may offset map pins by 5–15 m in open areas",
            "Call passengers if the pickup dot does not match the street",
        ],
        "warning": [
            f"Driving GPS outlook: {_status_word(status)}",
            corridor_note,
            "Space weather may cause ‘recalculating route’ and wrong-lane guidance",
            "Fleet managers: warn drivers before afternoon shifts",
        ],
    }

    actions: dict[ForecastStatus, str] = {
        "excellent": "Drive as normal. Quiet space weather supports reliable navigation.",
        "moderate": "Trust road signs at junctions when space weather may be nudging your map.",
        "warning": "Slow down in unknown areas. Confirm pickups and drop-offs by phone, not GPS alone.",
    }

    broadcast = _join_script([
        "🚕 *ZINGSA Navigation News — Drivers & Fleet*",
        _format_utc(computed_at),
        "",
        f"🌌 *Space weather:* {sw_ctx.headline}",
        *[f"• {b}" for b in sw_ctx.readout[:3]],
        "",
        headlines[status],
        "",
        summaries[status],
        "",
        *[f"• {b}" for b in bullets[status]],
        "",
        f"👉 *Action:* {actions[status]}",
        "",
        *ZINGSA_BROADCAST_FOOTER,
    ])

    social = _join_script([
        "🚕 ZINGSA Navigation News | Drivers",
        sw_ctx.headline,
        corridor_note,
        "#SpaceWeather #Taxi #FleetGPS #Zimbabwe",
    ])

    return NavigationNewsBrief(
        id="driver",
        icon="🚕",
        title="Driver & Fleet Brief",
        audience="Taxi drivers, bus operators, couriers & everyday motorists",
        headline=headlines[status],
        summary=summaries[status],
        space_weather_today=f"{sw_ctx.headline} {sw_ctx.impact}",
        space_weather_bullets=sw_ctx.readout,
        bullets=bullets[status],
        action=actions[status],
        status_tone=status,
        broadcast_script=broadcast,
        social_script=social,
        channels=[*ZINGSA_NAVIGATION_CHANNELS, "WhatsApp driver groups", "Fleet dispatch SMS", "Facebook Page"],
    )


def _aviation_brief(
    forecasts: list[GnssForecastCity],
    tone: ForecastStatus,
    sw: dict[str, Any] | None,
    computed_at: str,
) -> NavigationNewsBrief:
    status = tone
    sw_ctx = build_space_weather_layman(sw, tone)
    harare = next((f for f in forecasts if f.city == "HARARE"), None)
    vicf = next((f for f in forecasts if f.city == "VICTORIA FALLS"), None)
    if vicf and vicf.status == "warning":
        route_note = (
            "Victoria Falls / western routes: expect wider GNSS error and possible HF radio noise on long sectors."
        )
    elif harare and harare.status == "excellent":
        route_note = (
            "Harare and central Zimbabwe: aviation GNSS and routine approaches should be within normal limits."
        )
    else:
        route_note = (
            "Some en-route and approach sectors may show GNSS degradation when the ionosphere is disturbed."
        )

    headlines: dict[ForecastStatus, str] = {
        "excellent": "Calm space weather — aviation GNSS and routine navigation should be reliable",
        "moderate": "Mild space weather — monitor GPS approaches and HF communications",
        "warning": "Space weather alert for aviation — expect GNSS and HF impacts",
    }

    summaries: dict[ForecastStatus, str] = {
        "excellent": (
            "Solar activity is low and the ionosphere is stable over Southern Africa. Space weather is not expected "
            "to interfere with GPS-based navigation (RNAV/GPS approaches), en-route GNSS, or standard HF radio links "
            "used on cross-border sectors."
        ),
        "moderate": (
            "Space weather is making the ionosphere uneven. Pilots and drone operators may see slightly longer GNSS "
            "acquisition, small position offsets on moving maps, or brief HF static on polar and long-haul HF routes. "
            "Most commercial GNSS with RAIM will continue to operate, but monitor NOTAMs and ZINGSA briefs through "
            "the afternoon."
        ),
        "warning": (
            "Active geomagnetic and ionospheric disturbance is affecting high-altitude navigation signals. "
            "GPS-guided approaches, unmanned aerial operations, and HF communications can all degrade during the "
            "storm main phase. Do not assume cockpit or controller displays match actual position without "
            "cross-checks — the same space weather affecting farmers and surveyors reaches aircraft at cruise altitude."
        ),
    }

    bullets: dict[ForecastStatus, list[str]] = {
        "excellent": [
            f"Aviation GNSS outlook: {_status_word(status)}",
            route_note,
            "Space weather impact: minimal for RNAV/GPS and en-route GNSS",
            "Drone ops (VLOS): normal with standard pre-flight checks",
        ],
        "moderate": [
            f"Aviation GNSS outlook: {_status_word(status)}",
            route_note,
            "Watch for RAIM alerts or longer approach lock-on during afternoon scintillation",
            "HF users: possible flutter on long paths; VHF/UHF mostly unaffected",
        ],
        "warning": [
            f"Aviation GNSS outlook: {_status_word(status)}",
            route_note,
            "GPS/RNAV approaches may be unavailable or require reversion to conventional navaids",
            "Drone operators: delay BVLOS and precision survey flights until conditions ease",
            "Crew: elevated high-altitude radiation possible on polar/long-haul routes during strong storms",
        ],
    }

    actions: dict[ForecastStatus, str] = {
        "excellent": (
            "Operate as normal. Include space weather in standard briefing — quiet ionosphere supports reliable GNSS."
        ),
        "moderate": (
            "Brief crews on possible GNSS wobble and HF noise. Prefer morning sectors for precision drone or survey flights."
        ),
        "warning": (
            "Activate storm procedures: verify navaid backups, delay non-essential drone ops, and monitor Kp/Dst until recovery."
        ),
    }

    broadcast = _join_script([
        "✈️ *ZINGSA Navigation News — Aviation*",
        _format_utc(computed_at),
        "",
        f"🌌 *Space weather:* {sw_ctx.headline}",
        *[f"• {b}" for b in sw_ctx.readout[:3]],
        "",
        headlines[status],
        "",
        summaries[status],
        "",
        *[f"• {b}" for b in bullets[status]],
        "",
        f"👉 *Action:* {actions[status]}",
        "",
        *ZINGSA_BROADCAST_FOOTER,
    ])

    social = _join_script([
        "✈️ ZINGSA Navigation News | Aviation",
        sw_ctx.headline,
        route_note,
        "#SpaceWeather #Aviation #GNSS #Zimbabwe",
    ])

    return NavigationNewsBrief(
        id="aviation",
        icon="✈️",
        title="Aviation Brief",
        audience="Pilots, air traffic controllers & drone operators",
        headline=headlines[status],
        summary=summaries[status],
        space_weather_today=f"{sw_ctx.headline} {sw_ctx.impact}",
        space_weather_bullets=sw_ctx.readout,
        bullets=bullets[status],
        action=actions[status],
        status_tone=status,
        broadcast_script=broadcast,
        social_script=social,
        channels=[*ZINGSA_NAVIGATION_CHANNELS, "ATC briefings", "Airline ops WhatsApp", "UAS operator groups"],
    )


def _scientist_brief(
    forecasts: list[GnssForecastCity],
    tone: ForecastStatus,
    sw: dict[str, Any] | None,
    computed_at: str,
) -> NavigationNewsBrief:
    status = tone
    sw_ctx = build_space_weather_layman(sw, tone)
    kp = sw.get("kp") if sw else None
    dst = sw.get("dst") if sw else None
    s4 = sw.get("s4") if sw else None
    vtec = sw.get("vtec") if sw else None
    gnss_risk = str(sw.get("gnss_risk") or "unknown") if sw else "unknown"
    national = _national_tone(forecasts)
    degraded_stations = sum(1 for f in forecasts if f.status != "excellent")

    headlines: dict[ForecastStatus, str] = {
        "excellent": "Quiet ionosphere — favourable window for GNSS science and CORS QC",
        "moderate": "Elevated space weather — expect measurable TEC bias and scintillation in afternoon data",
        "warning": "Storm conditions — flag CORS arcs, widen uncertainty on TEC/GNSS products",
    }

    summaries: dict[ForecastStatus, str] = {
        "excellent": (
            "Geomagnetic and ionospheric drivers are subdued over Zimbabwe. CORS-derived VTEC, dual-frequency "
            "combinations, and EKF-monitored residuals should stay within typical quiet-day envelopes — suitable "
            "for calibration runs, model validation, and publication-quality extracts from the ZINGSA archive."
        ),
        "moderate": (
            "Space weather is injecting extra delay and phase noise into the ionosphere. Researchers should expect "
            "elevated TEC gradients, higher S4 on low-elevation satellites, and longer RTK re-convergence in "
            "CORS time series — especially post-noon. Compare live Kp/Dst with ZINGSA EKF deviation alerts before "
            "assimilating data into storm studies."
        ),
        "warning": (
            "Active geomagnetic disturbance is dominating the ionospheric state. TEC maps, ROTI proxies, and "
            "carrier-phase solutions may contain outliers; do not treat automatic QC as sufficient without manual "
            "review. Cross-check NOAA/SWPC indices, WDC Kyoto Dst, and ZINGSA storm-watch logs — this is a high-value "
            "event for case studies but a poor window for baseline inter-comparisons."
        ),
    }

    metrics_line = (
        f"Live indices: Kp {_fmt_num(kp)} · Dst {_fmt_num(dst, 0)} nT · S4 {_fmt_num(s4, 2)} · "
        f"VTEC {_fmt_num(vtec, 2)} TECU · GNSS risk {gnss_risk}"
    )

    bullets: dict[ForecastStatus, list[str]] = {
        "excellent": [
            f"National GNSS outlook: {_status_word(national)} across {len(forecasts)} forecast cities",
            metrics_line,
            f"CORS network: {degraded_stations} cities outside excellent — routine QC only",
            "EKF pipeline: residuals expected near climatology; good day for filter tuning",
            "Data use: archive pulls, student labs, and inter-station TEC comparisons",
        ],
        "moderate": [
            f"National GNSS outlook: {_status_word(national)}",
            metrics_line,
            f"CORS network: {degraded_stations} cities showing moderate/warning positioning stress",
            "Watch afternoon scintillation (S4) on east-west baselines and low elevations",
            "EKF deviation alerts may fire on TEC/S4 — treat as science signal, not sensor fault",
        ],
        "warning": [
            f"National GNSS outlook: {_status_word(national)}",
            metrics_line,
            f"CORS network: {degraded_stations} cities degraded — flag RINEX before ingestion",
            "Prioritise storm case logging: Kp, Dst, solar wind, GIC if available",
            "Delay cm-level RTK research products; publish event bulletin instead",
        ],
    }

    actions: dict[ForecastStatus, str] = {
        "excellent": (
            "Proceed with routine processing and research extracts. Document quiet-day baselines for the archive."
        ),
        "moderate": (
            "Enable enhanced QC flags on CORS ingest; compare ZINGSA TEC with IGS/global maps."
        ),
        "warning": (
            "Activate storm-data protocol: snapshot indices hourly, segregate contaminated arcs, coordinate with ZINGSA ops before releasing operational TEC products."
        ),
    }

    broadcast = _join_script([
        "🔬 *ZINGSA Navigation News — Scientists & Researchers*",
        _format_utc(computed_at),
        "",
        f"🌌 *Space weather:* {sw_ctx.headline}",
        *[f"• {b}" for b in sw_ctx.readout[:4]],
        "",
        headlines[status],
        "",
        summaries[status],
        "",
        *[f"• {b}" for b in bullets[status]],
        "",
        f"👉 *Action:* {actions[status]}",
        "",
        *ZINGSA_BROADCAST_FOOTER,
    ])

    social = _join_script([
        "🔬 ZINGSA Navigation News | Scientists",
        sw_ctx.headline,
        metrics_line,
        "#SpaceWeather #Ionosphere #GNSS #Research #Zimbabwe",
    ])

    return NavigationNewsBrief(
        id="scientist",
        icon="🔬",
        title="Scientist Brief",
        audience="Researchers, geophysicists & GNSS data analysts",
        headline=headlines[status],
        summary=summaries[status],
        space_weather_today=f"{sw_ctx.headline} {sw_ctx.explainer}",
        space_weather_bullets=sw_ctx.readout,
        bullets=bullets[status],
        action=actions[status],
        status_tone=status,
        broadcast_script=broadcast,
        social_script=social,
        channels=[*ZINGSA_NAVIGATION_CHANNELS, "Research WhatsApp", "University mailing lists", "Data portal RSS"],
    )


def build_audience_news(
    forecasts: list[GnssForecastCity],
    computed_at: str,
    sw: dict[str, Any] | None = None,
) -> list[NavigationNewsBrief]:
    cities = _by_city(forecasts)
    tone = _effective_navigation_tone(forecasts, sw)

    return [
        _citizen_brief(forecasts, tone, sw, computed_at),
        _farmer_brief(cities.get("HARARE"), tone, sw, computed_at),
        _surveyor_brief(cities.get("MUTARE"), cities.get("HARARE"), tone, sw, computed_at),
        _aviation_brief(forecasts, tone, sw, computed_at),
        _driver_brief(forecasts, tone, sw, computed_at),
        _scientist_brief(forecasts, tone, sw, computed_at),
    ]


def get_audience_brief(
    forecasts: list[GnssForecastCity],
    computed_at: str,
    audience: AudienceId,
    sw: dict[str, Any] | None = None,
) -> NavigationNewsBrief | None:
    return next((b for b in build_audience_news(forecasts, computed_at, sw) if b.id == audience), None)
