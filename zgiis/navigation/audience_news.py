"""Audience navigation news briefs — Python port of frontend/lib/gnssAudienceNews.ts."""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any, Literal

from zgiis.navigation.gnss_forecast import ForecastStatus, GnssForecastCity
from zgiis.navigation.zingsa_contact import (
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
        return "Earth's magnetic field: updating"
    if kp <= 2:
        return f"Earth's magnetic field is calm (Kp {_fmt_num(kp)})"
    if kp <= 4:
        return f"Earth's magnetic field is a little unsettled (Kp {_fmt_num(kp)})"
    if kp <= 6:
        return f"Mild magnetic storm under way (Kp {_fmt_num(kp)})"
    return f"Strong magnetic storm under way (Kp {_fmt_num(kp)})"


def _s4_layman(s4: float | int | None) -> str:
    if s4 is None:
        return "GPS signal strength: updating"
    if s4 < 0.15:
        return f"GPS signals are steady (S4 {_fmt_num(s4, 2)})"
    if s4 < 0.3:
        return f"GPS signals may flicker a little (S4 {_fmt_num(s4, 2)})"
    return f"GPS signals are disturbed (S4 {_fmt_num(s4, 2)})"


def _dst_layman(dst: float | int | None) -> str:
    if dst is None:
        return "Solar wind pressure: updating"
    if dst > -30:
        return f"No strong solar-wind push on Earth (Dst {_fmt_num(dst, 0)} nT)"
    if dst > -50:
        return f"Mild solar-wind pressure on Earth (Dst {_fmt_num(dst, 0)} nT)"
    if dst > -100:
        return f"Magnetic disturbance may affect GPS (Dst {_fmt_num(dst, 0)} nT)"
    return f"Strong magnetic disturbance (Dst {_fmt_num(dst, 0)} nT)"


def _risk_layman(risk: str | None) -> str:
    r = (risk or "unknown").lower()
    if r == "low":
        return "GPS risk today: Low — maps should work normally"
    if r == "moderate":
        return "GPS risk today: Moderate — location may be a bit slow or off"
    if r in ("high", "critical"):
        return "GPS risk today: High — do not trust a map pin alone"
    return f"GPS risk today: {risk or 'updating'}"


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
        "excellent": "Calm sky for GPS — maps should work normally",
        "moderate": "Mild space weather — GPS may be a little slow or off",
        "warning": "Active space weather — GPS may show the wrong place",
    }

    explainers: dict[ForecastStatus, str] = {
        "excellent": "Space weather is activity from the Sun that can affect GPS. Today it is quiet.",
        "moderate": (
            "The Sun is stirring the air high above us where GPS signals travel. Your phone still works, "
            "but the blue dot may drift a few metres."
        ),
        "warning": (
            "Strong activity from the Sun is disturbing GPS over Zimbabwe. Maps and location apps may be "
            "wrong until it settles."
        ),
    }

    impacts: dict[ForecastStatus, str] = {
        "excellent": "Use maps, taxis, and WhatsApp location as normal.",
        "moderate": "If your pin looks wrong, wait a moment or step outside for a clearer sky view.",
        "warning": (
            f"Do not trust a map pin alone. Confirm by phone or street signs. Help: {ZINGSA_PHONE}."
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
    poor_areas = [
        f.city.replace("VICTORIA FALLS", "Vic Falls")
        for f in forecasts
        if f.status != "excellent"
    ][:3]
    area_note = (
        f"Watch these areas: {', '.join(poor_areas)}."
        if poor_areas
        else "Nationwide outlook: good for everyday GPS."
    )

    headlines: dict[ForecastStatus, str] = {
        "excellent": "Good GPS day — your maps should work normally",
        "moderate": "GPS may wobble a little today",
        "warning": "GPS alert — check your location carefully",
    }

    summaries: dict[ForecastStatus, str] = {
        "excellent": (
            "Your phone uses satellites for Maps, WhatsApp location, and taxis. "
            "Today those signals are clear across Zimbabwe."
        ),
        "moderate": (
            "GPS is a bit unsettled. Your phone may take longer to find you, or show you a few metres "
            "from where you stand. This is not a broken phone."
        ),
        "warning": (
            f"GPS may show the wrong place today. Do not trust a map pin alone for meetings or travel. "
            f"Call ZINGSA on {ZINGSA_PHONE} if you need help."
        ),
    }

    bullets: dict[ForecastStatus, list[str]] = {
        "excellent": [
            "Use maps and location apps as normal",
            area_note,
            "ZINGSA is watching space weather for the country",
        ],
        "moderate": [
            "You may see a slow GPS lock or a blue dot a few metres off",
            area_note,
            "Step outside if your location looks wrong",
        ],
        "warning": [
            "Map pins or delivery pickups may be wrong",
            area_note,
            "Confirm places by phone or street signs",
        ],
    }

    actions: dict[ForecastStatus, str] = {
        "excellent": "No action needed.",
        "moderate": ZINGSA_NAVIGATION_MODERATE_ACTION,
        "warning": ZINGSA_NAVIGATION_WARNING_ACTION,
    }

    broadcast = _join_script([
        "🇿🇼 *ZINGSA Navigation News*",
        _format_utc(computed_at),
        "",
        f"*Today:* {headlines[status]}",
        summaries[status],
        "",
        *[f"• {b}" for b in bullets[status]],
        "",
        f"👉 *What to do:* {actions[status]}",
        "",
        *ZINGSA_BROADCAST_FOOTER,
    ])

    social = _join_script([
        "🇿🇼 ZINGSA Navigation News",
        headlines[status],
        summaries[status],
        f"What to do: {actions[status]}",
        "#ZINGSA #Zimbabwe #GPS",
    ])

    return NavigationNewsBrief(
        id="citizen",
        icon="🌌",
        title="For Everyone",
        audience="Ordinary citizens, schools & community groups",
        headline=headlines[status],
        summary=summaries[status],
        space_weather_today=f"{sw_ctx.headline}. {sw_ctx.explainer}",
        space_weather_bullets=sw_ctx.readout[:3],
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
        "excellent": "Good day for tractor GPS and field mapping",
        "moderate": "Do GPS field work in the morning if you can",
        "warning": "Caution: auto-steer and drone mapping may drift",
    }

    summaries: dict[ForecastStatus, str] = {
        "excellent": (
            "Tractor auto-steer, spraying, and boundary mapping should work well today. "
            "Satellite GPS for the farm is steady."
        ),
        "moderate": (
            "Farm GPS still works, but lines may wander a little after midday. Auto-steer may take longer "
            "to lock. Prefer morning planting, spraying, and mapping."
        ),
        "warning": (
            "Precision GPS may drift beyond normal farm limits. Check fence lines and spray paths before "
            "any legal or payment decisions. Use known ground marks if you must map today."
        ),
    }

    bullets: dict[ForecastStatus, list[str]] = {
        "excellent": [
            f"Field GPS: {_status_word(status)} (Harare area)",
            f"RTK: {rtk} · Accuracy: {accuracy}",
            f"Best work window: {window}",
        ],
        "moderate": [
            f"Field GPS: {_status_word(status)} (Harare area)",
            f"RTK: {rtk} · Accuracy: {accuracy}",
            f"Best window: {window} — finish GPS jobs before lunch if possible",
        ],
        "warning": [
            f"Field GPS: {_status_word(status)} (Harare area)",
            f"RTK: {rtk} · Accuracy: {accuracy}",
            "Postpone centimetre mapping if you can; check ground marks before accepting boundaries",
        ],
    }

    actions: dict[ForecastStatus, str] = {
        "excellent": "Go ahead with precision planting, spraying, and mapping.",
        "moderate": "Schedule GPS-heavy field work before 11:00.",
        "warning": "Do not rely on GPS alone for legal boundaries until conditions improve.",
    }

    broadcast = _join_script([
        "🌱 *ZINGSA Navigation News — Farmers*",
        f"📍 Harare & surrounds · {_format_utc(computed_at)}",
        "",
        headlines[status],
        summaries[status],
        "",
        *[f"• {b}" for b in bullets[status]],
        "",
        f"👉 *What to do:* {actions[status]}",
        "",
        *ZINGSA_BROADCAST_FOOTER,
    ])

    social = _join_script([
        "🌱 ZINGSA | Farmers",
        headlines[status],
        f"Window {window} · RTK {rtk}",
        "#Farming #GPS #Zimbabwe",
    ])

    return NavigationNewsBrief(
        id="farmer",
        icon="🌱",
        title="Farmer Brief",
        audience="Farmers, agronomists & smart-agri operators",
        headline=headlines[status],
        summary=summaries[status],
        space_weather_today=f"{sw_ctx.headline}. {sw_ctx.impact}",
        space_weather_bullets=sw_ctx.readout[:3],
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
    kp = _fmt_num(sw.get("kp") if sw else None)
    s4 = _fmt_num(sw.get("s4") if sw else None, 2)
    dst = _fmt_num(sw.get("dst") if sw else None, 0)
    risk = (sw.get("gnss_risk") if sw else None) or "updating"

    headlines: dict[ForecastStatus, str] = {
        "excellent": "CORS/RTK conditions favourable — proceed with survey",
        "moderate": "Allow extra RTK occupation time — ionospheric delay elevated",
        "warning": "Degraded GNSS — centimetre work needs redundancy",
    }

    summaries: dict[ForecastStatus, str] = {
        "excellent": (
            "Ionosphere quiet. Negligible space-weather contribution to RTK baselines and CORS corrections. "
            "Cadastral and engineering surveys can proceed to normal tolerances."
        ),
        "moderate": (
            "Elevated ionospheric delay and scintillation. Expect longer RTK initialisation and possible float "
            "slips around midday. Check receiver and caster before assuming a fault."
        ),
        "warning": (
            "Active ionospheric disturbance. Ambiguity-fixed centimetre GNSS alone may not meet legal accuracy "
            "today. Hold centimetre submissions or add total-station / independent control checks."
        ),
    }

    warning_bullets = [
        f"CORS focus: {site} · Status: {_status_word(status)}",
        f"Expected accuracy: {accuracy} · RTK: {rtk}",
        "Error budget dominated by space weather — verify control independently",
        (
            f"Drivers: {primary.cause}"
            if primary and primary.cause
            else f"Monitor Kp {kp} / S4 {s4} before mobilising"
        ),
    ]

    bullets: dict[ForecastStatus, list[str]] = {
        "excellent": [
            f"CORS focus: {site} · Status: {_status_word(status)}",
            f"Expected accuracy: {accuracy} · RTK reliability: {rtk}",
            f"Preferred occupation window: {window}",
            f"Indices: Kp {kp} · S4 {s4} · Dst {dst} nT",
        ],
        "moderate": [
            f"CORS focus: {site} · Status: {_status_word(status)}",
            f"Expected accuracy: {accuracy} · RTK reliability: {rtk}",
            "Allow ~15–30% longer time to Fix; prefer morning occupations",
            f"Window: {window} · Kp {kp} · S4 {s4}",
        ],
        "warning": warning_bullets,
    }

    actions: dict[ForecastStatus, str] = {
        "excellent": "Mobilise as planned. Space weather is not limiting today.",
        "moderate": "Brief crews on longer Fix times. Prefer morning occupations.",
        "warning": "Delay centimetre-critical lodgement or add total-station redundancy.",
    }

    broadcast = _join_script([
        "📐 *ZINGSA Navigation News — Surveyors*",
        f"📍 {site} · {_format_utc(computed_at)}",
        "",
        headlines[status],
        summaries[status],
        "",
        *[f"• {b}" for b in bullets[status]],
        "",
        f"👉 *Action:* {actions[status]}",
        "",
        *ZINGSA_BROADCAST_FOOTER,
    ])

    social = _join_script([
        "📐 ZINGSA | Surveyors",
        headlines[status],
        f"{site} · {accuracy} · RTK {rtk}",
        "#Surveying #RTK #CORS #Zimbabwe",
    ])

    return NavigationNewsBrief(
        id="surveyor",
        icon="📐",
        title="Surveyor Brief",
        audience="Land surveyors, engineers & cadastral teams",
        headline=headlines[status],
        summary=summaries[status],
        space_weather_today=f"{sw_ctx.headline}. Kp {kp} · S4 {s4} · Dst {dst} nT.",
        space_weather_bullets=[f"Kp {kp}", f"S4 {s4}", f"Dst {dst} nT", f"GNSS risk {risk}"],
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
