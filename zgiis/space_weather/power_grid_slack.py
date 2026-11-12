"""Live ZESA / ZETDC power-grid advisory for Slack.

Readings come from NOAA SWPC solar wind and the ZINGSA live space-weather
snapshot. Missing values are omitted. Nothing in this module invents a reading.
"""
from __future__ import annotations

import json
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any

from zgiis.space_weather.advisory_centre_config import (
    BT_ELEVATED_NT,
    DENSITY_ELEVATED_CM3,
    DST_STORM_NT,
    DST_STRONG_NT,
    KP_G1,
    KP_G3,
    LEVEL_RANK,
    WIND_WATCH_KMS,
    BZ_SOUTH_WATCH_NT,
)
from zgiis.space_weather.slack_alerts import post_slack
from zgiis.space_weather.solar_activity import (
    NOAA_MAG_1D_URL,
    NOAA_PLASMA_1D_URL,
    _dynamic_pressure_npa,
    _float_or_none,
    _latest_product_row,
    _product_value,
    _southward_duration_minutes,
)

CAT = timezone(timedelta(hours=2))
_LIVE_CURRENT = (
    "https://zingsa-gnss-tec.vercel.app/api/space-weather-router/?__zr="
    "/space-weather/current"
)
_LEVELS = {
    "GREEN": ("🟢", "GREEN — NORMAL"),
    "YELLOW": ("🟡", "YELLOW — ELEVATED SPACE WEATHER WATCH"),
    "ORANGE": ("🟠", "ORANGE — GEOMAGNETIC STORM WARNING"),
    "RED": ("🔴", "RED — SEVERE GEOMAGNETIC ALERT"),
}


def _max_level(left: str, right: str) -> str:
    return left if LEVEL_RANK[left] >= LEVEL_RANK[right] else right


def classify_power_grid_level(readings: dict[str, Any]) -> str:
    """Screening level from the same thresholds as the Advisory Centre."""
    level = "GREEN"
    speed = _float_or_none(readings.get("speed"))
    bz = _float_or_none(readings.get("bz"))
    bt = _float_or_none(readings.get("bt"))
    density = _float_or_none(readings.get("density"))
    kp = _float_or_none(readings.get("kp"))
    dst = _float_or_none(readings.get("dst"))
    if speed is not None and speed >= WIND_WATCH_KMS:
        level = "YELLOW"
    if bz is not None and bz <= BZ_SOUTH_WATCH_NT:
        level = _max_level(level, "YELLOW")
    if bt is not None and bt >= BT_ELEVATED_NT:
        level = _max_level(level, "YELLOW")
    if density is not None and density >= DENSITY_ELEVATED_CM3:
        level = _max_level(level, "YELLOW")
    if dst is not None and dst <= DST_STORM_NT:
        level = _max_level(level, "ORANGE" if kp is not None and kp >= KP_G1 else "YELLOW")
    if dst is not None and dst <= DST_STRONG_NT:
        level = _max_level(level, "ORANGE")
    if kp is not None and kp >= KP_G1:
        level = _max_level(level, "ORANGE")
    if kp is not None and kp >= KP_G3:
        level = "RED"
    return level


def _num(value: float, digits: int) -> str:
    number = round(float(value), digits)
    if digits == 0 or abs(number - round(number)) < 10 ** (-digits):
        return str(int(round(number)))
    return f"{number:.{digits}f}"


def _signed(value: float, digits: int) -> str:
    text = _num(abs(value), digits)
    if value < 0:
        return f"\u2212{text}"
    return text


def _bz_note(bz: float, minutes: int | None) -> str:
    if bz < 0:
        note = "Southward"
        if minutes is not None and minutes > 0:
            note += f", held {minutes} min"
        note += f"; coupling watch: \u2264 \u2212{abs(BZ_SOUTH_WATCH_NT):.0f} nT"
        return note
    if bz > 0:
        return "Northward"
    return "Near zero"


def _assessment(level: str, readings: dict[str, Any]) -> str:
    kp = _float_or_none(readings.get("kp"))
    dst = _float_or_none(readings.get("dst"))
    speed = _float_or_none(readings.get("speed"))
    if level == "RED":
        return (
            "Severe geomagnetic conditions are observed. Apply the utility's heightened "
            "monitoring and contingency procedures. This is not by itself a confirmed GIC "
            "impact on the Zimbabwe network."
        )
    if level == "ORANGE":
        return (
            "Observed geomagnetic indices meet storm conditions. Increase surveillance of "
            "vulnerable transformers and transmission lines. A GIC impact is not confirmed "
            "without measured transformer neutral current."
        )
    if level == "YELLOW":
        speed_note = ""
        if speed is not None and speed >= WIND_WATCH_KMS and (kp is None or kp < KP_G1) and (dst is None or dst > DST_STORM_NT):
            speed_note = " Solar-wind speed is above the watch line. Speed alone is not a geomagnetic storm."
        return (
            "These live readings warrant enhanced monitoring, but do not confirm an ongoing "
            "geomagnetic storm."
            + speed_note
        )
    return (
        "Live readings are below the watch lines. No geomagnetic storm is indicated. "
        "Continue routine monitoring."
    )


def _current_line(level: str) -> str:
    if level == "RED":
        return "Severe geomagnetic conditions are observed. Heightened monitoring is recommended."
    if level == "ORANGE":
        return "A geomagnetic storm warning is in effect from the observed indices. No GIC impact is confirmed from these readings alone."
    if level == "YELLOW":
        return "No geomagnetic storm or power grid disturbance is confirmed by these live readings. Enhanced monitoring is recommended."
    return "No elevated geomagnetic disturbance is indicated by these live readings. Routine monitoring continues."


_STATUS = {
    "GREEN": "Routine Monitoring",
    "YELLOW": "Precautionary Monitoring Advisory",
    "ORANGE": "Geomagnetic Storm Warning",
    "RED": "Severe Geomagnetic Alert",
}

_NEGATIVE_BZ_LINE = (
    "Negative Bz means the interplanetary magnetic field points southward, "
    "increasing the chance that solar-wind energy can enter Earth's magnetosphere."
)


def format_power_grid_advisory(readings: dict[str, Any], *, issued_at: datetime | None = None) -> str:
    """Build the ZESA advisory. Raises ValueError when no live reading is available."""
    speed = _float_or_none(readings.get("speed"))
    bz = _float_or_none(readings.get("bz"))
    bt = _float_or_none(readings.get("bt"))
    density = _float_or_none(readings.get("density"))
    kp = _float_or_none(readings.get("kp"))
    dst = _float_or_none(readings.get("dst"))
    if all(value is None for value in (speed, bz, bt, density, kp, dst)):
        raise ValueError("no live power-grid readings")

    issued = issued_at or datetime.now(CAT)
    if issued.tzinfo is None:
        issued = issued.replace(tzinfo=CAT)
    issued_cat = issued.astimezone(CAT)
    level = classify_power_grid_level(readings)
    _emoji, label = _LEVELS[level]
    rows: list[str] = []
    if speed is not None:
        rows.append(f"Solar wind speed — {_num(speed, 0)} km/s — Watch: >{WIND_WATCH_KMS:.0f} km/s")
    if bz is not None:
        rows.append(f"IMF Bz — {_signed(bz, 1)} nT — {_bz_note(bz, readings.get('bz_south_minutes'))}")
    if bt is not None:
        rows.append(f"IMF Bt — {_num(bt, 1)} nT — Elevated line: \u2265 {BT_ELEVATED_NT:.0f} nT")
    if kp is not None:
        rows.append(f"Planetary Kp — {_num(kp, 1)} — Kp \u2265 {KP_G1:.0f} indicates a storm")
    if dst is not None:
        rows.append(f"Dst index — {_signed(dst, 0)} nT — Storm-context line: \u2264 \u2212{abs(DST_STORM_NT):.0f} nT")
    if density is not None:
        rows.append(f"Solar wind density — {_num(density, 2)} cm⁻³ — Elevated line: \u2265 {DENSITY_ELEVATED_CM3:.0f} cm⁻³")
    source_bits = []
    if readings.get("solar_time"):
        source_bits.append(f"Solar wind and IMF: NOAA SWPC RTSW {readings['solar_time']} UTC")
    if readings.get("index_time"):
        source_bits.append(f"Kp and Dst: Live Space Weather {readings['index_time']} UTC")
    lines = [
        "*ZINGSA SPACE WEATHER ADVISORY*",
        "*Geomagnetic Disturbance and Power Grid Monitoring*",
        "",
        "*Recipient:* ZESA Holdings / ZETDC",
        f"*Advisory Level:* {label}",
        "*Issued by:* ZINGSA Space Science Department",
        f"*Date:* {issued_cat.strftime('%d %B %Y').lstrip('0')}, {issued_cat.strftime('%H:%M')} CAT",
        f"*Status:* {_STATUS[level]}",
        "",
        "*1. Current Space Weather Conditions*",
        "",
        "The Zimbabwe National Geospatial and Space Agency (ZINGSA) advises that elevated solar wind activity may increase the likelihood of geomagnetic disturbances if accompanied by sustained southward interplanetary magnetic field (IMF Bz) conditions.",
        "",
        "Live readings:",
        *rows,
        "",
        _NEGATIVE_BZ_LINE,
    ]
    if source_bits:
        lines.extend(["", " ".join(source_bits) + "."])
    lines.extend(
        [
            "",
            f"*Assessment:* {_assessment(level, readings)}",
            "",
            "*2. Potential Implications for Zimbabwe's Power Grid*",
            "",
            "During sufficiently strong geomagnetic disturbances, variations in Earth's magnetic field can induce electric fields at ground level, potentially generating geomagnetically induced currents (GICs) in transmission networks.",
            "",
            "Possible impacts include:",
            "",
            "• Increased transformer reactive power consumption.",
            "• Transformer half-cycle saturation and abnormal heating.",
            "• Harmonic generation and voltage regulation challenges.",
            "• Unusual neutral currents in susceptible transformers.",
            "• Increased risk of operational disturbances during severe geomagnetic storms.",
            "",
            "The actual vulnerability of Zimbabwe's power network depends on transmission line configuration, transformer design, grounding, geology and the intensity of local geomagnetic variations.",
            "",
            "*No power grid disturbance or GIC event is confirmed by these live readings.*",
            "",
            "*3. Recommended Precautionary Measures*",
            "",
            "ZINGSA recommends that ZESA/ZETDC consider the following measures in accordance with established grid operating procedures:",
            "",
            "1. *Enhance monitoring:* Observe transformer neutral currents where sensors are installed, reactive power demand, voltage fluctuations and harmonic distortion.",
            "2. *Review grid readiness:* Confirm availability of voltage control and reactive power support systems.",
            "3. *Monitor vulnerable assets:* Give additional attention to transformers and long transmission lines identified through previous network vulnerability assessments.",
            "4. *Maintain operational coordination:* Ensure communication between grid control engineers, substation operators and ZINGSA.",
            "5. *Prepare contingency procedures:* Review existing responses for abnormal transformer behaviour, voltage instability and other relevant disturbances.",
            "6. *Avoid unnecessary switching:* Do not undertake network reconfiguration or equipment disconnection solely on the basis of a precautionary space weather watch.",
            "",
            "*4. Conditions Requiring Escalation*",
            "",
            "ZINGSA will reassess the advisory if:",
            "",
            "• IMF Bz becomes strongly and persistently southward.",
            "• Solar wind pressure increases sharply.",
            "• Kp reaches or exceeds 5.",
            "• Dst or SYM-H indicates significant geomagnetic intensification.",
            "• Local geomagnetic measurements indicate rapid magnetic field changes.",
            "• Grid monitoring identifies abnormal behaviour potentially consistent with GIC activity.",
            "",
            "A severe alert will require stronger scientific evidence and consideration of locally observed conditions.",
            "",
            "*5. Advisory Conclusion*",
            "",
            f"*Current advisory: {label}*",
            "",
            _current_line(level),
            "",
            "ZINGSA will continue monitoring space weather conditions. A live update is sent every 15 minutes. Daily briefs remain at 06:00, 12:00, 18:00 and 00:00 CAT. A separate alert is sent when a threshold is newly crossed.",
            "",
            "*Issued by:*",
            "Space Science Department",
            "Zimbabwe National Geospatial and Space Agency (ZINGSA)",
            "",
            "*Space Weather Monitoring Platform:*",
            "https://zingsa-gnss-tec.vercel.app/space-weather/",
        ]
    )
    return "\n".join(lines)


def _series_points(rows: Any, keys: tuple[str, ...]) -> list[tuple[datetime, float]]:
    points: list[tuple[datetime, float]] = []
    if not isinstance(rows, list):
        return points
    for row in rows:
        if not isinstance(row, dict) or row.get("active") is False:
            continue
        stamp = row.get("time_tag")
        value = None
        for key in keys:
            if row.get(key) is not None:
                value = _float_or_none(row.get(key))
                break
        if stamp is None or value is None:
            continue
        try:
            parsed = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        points.append((parsed, value))
    points.sort(key=lambda item: item[0])
    return points


def _sustained_minutes(rows: Any, keys: tuple[str, ...], predicate) -> float | None:
    """Minutes the latest sample has continuously satisfied predicate."""
    points = _series_points(rows, keys)
    if len(points) < 2:
        return None
    latest_time, latest_value = points[-1]
    if not predicate(latest_value):
        return 0.0
    start = latest_time
    for stamp, value in reversed(points):
        if not predicate(value):
            break
        start = stamp
    return max(0.0, (latest_time - start).total_seconds() / 60.0)


def _fetch_json(url: str, timeout: float = 25.0) -> Any:
    request = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "ZINGSA-space-weather"})
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode())


def collect_power_grid_readings() -> dict[str, Any]:
    """Latest solar-wind sample plus the live Kp/Dst snapshot."""
    readings: dict[str, Any] = {}
    try:
        plasma = _fetch_json(NOAA_PLASMA_1D_URL)
        row = _latest_product_row(plasma)
        if isinstance(row, dict):
            readings["speed"] = _float_or_none(_product_value(plasma, row, "proton_speed", "speed"))
            readings["density"] = _float_or_none(_product_value(plasma, row, "proton_density", "density"))
            readings["solar_time"] = row.get("time_tag")
            readings["dynamic_pressure"] = _dynamic_pressure_npa(readings["density"], readings["speed"])
            readings["speed_high_minutes"] = _sustained_minutes(plasma, ("proton_speed", "speed"), lambda value: value >= WIND_WATCH_KMS)
            readings["density_high_minutes"] = _sustained_minutes(plasma, ("proton_density", "density"), lambda value: value >= DENSITY_ELEVATED_CM3)
    except Exception:
        pass
    try:
        mag = _fetch_json(NOAA_MAG_1D_URL)
        row = _latest_product_row(mag)
        if isinstance(row, dict):
            readings["bt"] = _float_or_none(_product_value(mag, row, "bt"))
            readings["bz"] = _float_or_none(_product_value(mag, row, "bz_gsm", "bz"))
            readings["bz_south_minutes"] = _southward_duration_minutes(mag)
            readings["bz_watch_minutes"] = _sustained_minutes(mag, ("bz_gsm", "bz"), lambda value: value <= BZ_SOUTH_WATCH_NT)
            readings["bt_high_minutes"] = _sustained_minutes(mag, ("bt",), lambda value: value >= BT_ELEVATED_NT)
            readings["solar_time"] = readings.get("solar_time") or row.get("time_tag")
    except Exception:
        pass
    try:
        current = _fetch_json(_LIVE_CURRENT, timeout=40.0)
        if isinstance(current, dict):
            readings["kp"] = _float_or_none(current.get("kp"))
            readings["dst"] = _float_or_none(current.get("dst"))
            readings["vtec"] = _float_or_none(current.get("mean_vtec"))
            risk = current.get("gnss_risk")
            readings["gnss_risk"] = str(risk).strip() if isinstance(risk, str) and risk.strip() else None
            readings["index_time"] = current.get("updated_utc")
            if readings.get("speed") is None:
                readings["speed"] = _float_or_none(current.get("plasma_speed"))
    except Exception:
        pass
    return readings


# Quiet-day Zimbabwe network-mean VTEC bands (CAT), the same envelopes used in
# the archived assessments. Hours outside these windows have no published band.
_TEC_BANDS = (
    ((6, 7, 8, 9, 10), "Morning", 8.0, 30.0, "After sunrise, TEC normally rises as solar EUV ionises the ionosphere."),
    ((11, 12, 13, 14, 15), "Daytime", 12.0, 45.0, "Daytime TEC normally peaks near local noon and afternoon."),
    ((16, 17, 18, 19), "Evening / post-sunset", None, None, "After sunset, TEC normally falls as solar ionisation diminishes. A separate quiet-day band is not published for these hours."),
    ((20, 21, 22, 23, 0, 1, 2, 3), "Nighttime / post-sunset", 1.0, 12.0, "At night, TEC normally decreases as solar ionisation diminishes. Elevated nighttime TEC can still occur from the equatorial ionisation anomaly, seasonal effects, and post-sunset dynamics."),
    ((4, 5), "Pre-sunrise", None, None, "TEC is usually near its nighttime minimum before sunrise. A separate quiet-day band is not published for these hours."),
)


def _tec_block(readings: dict[str, Any], issued_cat: datetime) -> list[str]:
    """Zimbabwe TEC lines. A missing live value is reported as unavailable."""
    hour = issued_cat.hour
    period = "Unspecified"
    low = high = None
    note = "A quiet-day expected band is not published for this hour."
    for hours, name, band_low, band_high, text in _TEC_BANDS:
        if hour in hours:
            period, low, high, note = name, band_low, band_high, text
            break
    vtec = _float_or_none(readings.get("vtec"))
    lines = [
        "🛰️ ZIMBABWE IONOSPHERIC TEC ASSESSMENT",
        "",
        f"Observation time: {issued_cat.strftime('%H:%M')} CAT",
        f"Ionospheric period: {period}",
    ]
    if vtec is None:
        lines.extend(
            [
                "Observed VTEC: unavailable",
                "Expected VTEC: unavailable",
                "TEC deviation: unavailable",
                "TEC status: Unavailable",
                "",
                "No TEC anomaly can be confirmed until a validated live VTEC measurement is available.",
            ]
        )
        return lines
    lines.append(f"Observed VTEC: {_num(vtec, 1)} TECU")
    if low is None or high is None:
        lines.extend(
            [
                "Expected VTEC: no published quiet-day band for this hour",
                "TEC deviation: not calculated",
                "TEC status: Unavailable",
                "",
                note,
            ]
        )
    else:
        if vtec < low:
            deviation = vtec - low
            status = "Anomalous" if (low - vtec) > (high - low) else "Depressed"
        elif vtec > high:
            deviation = vtec - high
            status = "Anomalous" if (vtec - high) > (high - low) else "Elevated"
        else:
            deviation = 0.0
            status = "Normal"
        lines.extend(
            [
                f"Expected VTEC: {_num(low, 0)}–{_num(high, 0)} TECU (quiet-day {period.lower()} band)",
                f"TEC deviation: {_signed(deviation, 1)} TECU from the nearest edge of that band",
                f"TEC status: {status}",
                "",
                note,
            ]
        )
        if status in {"Elevated", "Anomalous"} and deviation > 0:
            lines.append(
                f"The observed value is {_num(deviation, 1)} TECU above the quiet-day band. Duration is not stated because this issue uses the current network mean only."
            )
    risk = readings.get("gnss_risk")
    lines.extend(
        [
            "",
            "Elevated TEC alone does not confirm GNSS interference. TEC gradients, ROTI, cycle slips and RTK positioning performance should also be examined.",
        ]
    )
    if isinstance(risk, str) and risk:
        lines.append(f"Live GNSS risk on the platform: {risk}.")
    return lines


def format_power_grid_quarter(readings: dict[str, Any], *, issued_at: datetime | None = None) -> str:
    """Fifteen-minute ZESA advisory. Uses the same live readings as the daily brief."""
    speed = _float_or_none(readings.get("speed"))
    bz = _float_or_none(readings.get("bz"))
    bt = _float_or_none(readings.get("bt"))
    density = _float_or_none(readings.get("density"))
    kp = _float_or_none(readings.get("kp"))
    dst = _float_or_none(readings.get("dst"))
    if all(value is None for value in (speed, bz, bt, density, kp, dst)):
        raise ValueError("no live power-grid readings")
    issued = issued_at or datetime.now(CAT)
    if issued.tzinfo is None:
        issued = issued.replace(tzinfo=CAT)
    issued_cat = issued.astimezone(CAT)
    level = classify_power_grid_level(readings)
    emoji, label = _LEVELS[level]
    lines = [
        f"{emoji} ZINGSA SPACE WEATHER ADVISORY",
        "Geomagnetic Disturbance, Ionospheric TEC & Power Grid Monitoring",
        "",
        f"📅 Date: {issued_cat.strftime('%d %B %Y').lstrip('0')}, {issued_cat.strftime('%H:%M')} CAT",
        "🏢 Stakeholders: ZESA Holdings / ZETDC",
        f"⚠️ Advisory Level: {label}",
        "",
        "☀️ SPACE WEATHER CONDITIONS",
        "",
        "Elevated solar wind activity, particularly when accompanied by sustained southward IMF Bz, may increase the likelihood of geomagnetic disturbances.",
        "",
        "Live monitoring readings:",
    ]
    if speed is not None:
        lines.append(f"🌞 Solar Wind Speed: {_num(speed, 0)} km/s (Watch: >{WIND_WATCH_KMS:.0f} km/s)")
    if bz is not None:
        lines.append(f"🧲 IMF Bz: {_signed(bz, 1)} nT ({_bz_note(bz, readings.get('bz_south_minutes'))})")
    if bt is not None:
        lines.append(f"🧲 IMF Bt: {_num(bt, 1)} nT (Elevated line: \u2265 {BT_ELEVATED_NT:.0f} nT)")
    if kp is not None:
        relation = "At or above" if kp >= KP_G1 else "Below"
        lines.append(f"📊 Geomagnetic Kp: {_num(kp, 1)} ({relation} storm threshold of {KP_G1:.0f})")
    if dst is not None:
        lines.append(f"📉 Dst Index: {_signed(dst, 0)} nT (Storm-context line: \u2264 \u2212{abs(DST_STORM_NT):.0f} nT)")
    if density is not None:
        lines.append(f"💨 Solar Wind Density: {_num(density, 2)} cm⁻³ (Elevated line: \u2265 {DENSITY_ELEVATED_CM3:.0f} cm⁻³)")
    lines.extend(["", _NEGATIVE_BZ_LINE])
    if readings.get("solar_time") or readings.get("index_time"):
        lines.extend(["", f"Sources: NOAA SWPC RTSW {readings.get('solar_time') or 'unavailable'} UTC. Live Space Weather {readings.get('index_time') or 'unavailable'} UTC."])
    lines.extend(
        [
            "",
            f"Assessment: {_assessment(level, readings)}",
            "",
            *_tec_block(readings, issued_cat),
            "",
            "⚡ POTENTIAL POWER GRID IMPACTS",
            "",
            (
                "Current grid assessment: no GIC-related disturbance is confirmed by these measurements."
                if level in {"GREEN", "YELLOW"}
                else "Current grid assessment: geomagnetic indices meet a storm screening level. A GIC impact is not confirmed without measured transformer neutral current."
            ),
            "",
            "If geomagnetic disturbances intensify, geomagnetically induced currents (GICs) may contribute to:",
            "",
            "• Transformer saturation and abnormal heating",
            "• Increased reactive power consumption",
            "• Voltage fluctuations and harmonic distortion",
            "• Abnormal transformer neutral currents",
            "",
            "🛠️ RECOMMENDED ACTIONS FOR ZESA/ZETDC",
            "",
            "✅ Monitor transformer neutral currents, voltage and reactive power demand.",
            "✅ Review grid stability and contingency procedures.",
            "✅ Increase surveillance of vulnerable transformers and transmission lines.",
            "✅ Maintain communication with ZINGSA for space weather updates.",
            "✅ Avoid unnecessary network switching based solely on this watch.",
            "",
            "🚨 ESCALATION INDICATORS",
            "",
            "Further assessment is required if:",
            "",
            "• Kp reaches 5 or above",
            "• IMF Bz remains strongly southward",
            "• Dst/SYM-H indicates intensifying geomagnetic activity",
            "• Local geomagnetic field variations increase significantly",
            "• Abnormal GIC-related measurements are detected",
            "• Significant TEC gradients or ionospheric irregularities affect GNSS reliability",
            "",
            f"📢 CURRENT ADVISORY: {label}",
            "",
            _current_line(level),
            "",
            "This power-grid watch alternates every 15 minutes with the solar activity forecast. Daily briefs remain at 06:00, 12:00, 18:00 and 00:00 CAT. A separate alert is sent when a threshold is newly crossed.",
            "",
            "🔗 ZINGSA Space Weather Monitoring Platform:",
            "https://zingsa-gnss-tec.vercel.app/space-weather/",
            "",
            "Issued by:",
            "ZINGSA Space Science Department",
            "Zimbabwe National Geospatial and Space Agency",
        ]
    )
    return "\n".join(lines)


def advisory_kind(issued_at: datetime) -> str:
    """Quarter-hour posts alternate. :00 and :30 stay the power-grid watch; :15 and :45 are the solar forecast."""
    issued = issued_at if issued_at.tzinfo else issued_at.replace(tzinfo=CAT)
    slot = issued.astimezone(CAT).minute // 15
    return "solar" if slot % 2 else "grid"


_MONTH_NUMBERS = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
    "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
    "august": 8, "aug": 8, "september": 9, "sep": 9, "october": 10, "oct": 10,
    "november": 11, "nov": 11, "december": 12, "dec": 12,
}


def _window_is_past(window: str, issued: datetime) -> bool:
    """True when the outlook names a calendar day already behind the issue time."""
    import re

    text = (window or "").lower()
    issued_day = issued.astimezone(CAT).date()
    for name, month in _MONTH_NUMBERS.items():
        if name not in text:
            continue
        for match in re.finditer(r"(\d{1,2})", text):
            day = int(match.group(1))
            if not 1 <= day <= 31:
                continue
            try:
                when = datetime(issued_day.year, month, day).date()
            except ValueError:
                continue
            age = (issued_day - when).days
            if 1 <= age < 200:
                return True
    return False


def _flare_clause(day: dict[str, Any] | None) -> str | None:
    if not isinstance(day, dict):
        return None
    parts: list[str] = []
    for key, name in (("c_count", "C-class"), ("m_count", "M-class"), ("x_count", "X-class")):
        count = day.get(key)
        if isinstance(count, int) and count > 0:
            noun = "flare" if count == 1 else "flares"
            parts.append(f"{count} {name} {noun}")
    if parts:
        return " and ".join(parts) + " reported"
    if day.get("label"):
        return str(day["label"])
    return None


def _region_sentence(brief: dict[str, Any]) -> str | None:
    count = brief.get("spotted_region_count")
    if count is None:
        count = brief.get("earth_facing_region_count")
    if not isinstance(count, int):
        return None
    if count == 0:
        return "The Earth-facing Sun has no visible sunspot regions."
    if count == 1:
        return "The Earth-facing Sun has one visible sunspot region."
    return f"The Earth-facing Sun has {count} visible sunspot regions."


def format_solar_forecast(
    readings: dict[str, Any],
    brief: dict[str, Any],
    *,
    issued_at: datetime | None = None,
) -> str:
    """Solar-activity forecast. Uses the supplied live brief and readings only."""
    issued = issued_at or datetime.now(CAT)
    if issued.tzinfo is None:
        issued = issued.replace(tzinfo=CAT)
    issued_cat = issued.astimezone(CAT)
    level = classify_power_grid_level(readings)
    emoji, label = _LEVELS[level]
    speed = _float_or_none(readings.get("speed"))
    bz = _float_or_none(readings.get("bz"))
    bt = _float_or_none(readings.get("bt"))
    density = _float_or_none(readings.get("density"))
    kp = _float_or_none(readings.get("kp"))
    dst = _float_or_none(readings.get("dst"))
    lines = [
        "☀️ SOLAR ACTIVITY & SPACE WEATHER FORECAST",
        "",
        f"Solar Activity Summary — {issued_cat.strftime('%d %B %Y').lstrip('0')}, {issued_cat.strftime('%H:%M')} CAT",
        "",
    ]
    region = _region_sentence(brief)
    if region:
        lines.append(region)
    cme = brief.get("earth_directed_cme")
    if cme is False:
        lines.append("No Earth-directed coronal mass ejections (CMEs) are seen from the NASA SDO.")
    elif cme is True:
        lines.append("An Earth-directed coronal mass ejection is seen from the NASA SDO.")
    lines.extend(["", "Solar Flare Probabilities"])
    chances = (
        ("C-class flares", brief.get("c_percent")),
        ("M-class flares", brief.get("m_percent")),
        ("X-class flares", brief.get("x_percent")),
    )
    wrote_chance = False
    for name, value in chances:
        if isinstance(value, (int, float)):
            lines.append(f"- {name}: {int(value)}%")
            wrote_chance = True
    if not wrote_chance:
        lines.append("- NOAA flare probabilities are not available for this issue.")
    lines.extend(["", "Solar Flaring Activity"])
    today = _flare_clause(brief.get("flares_today") if isinstance(brief.get("flares_today"), dict) else None)
    yesterday = _flare_clause(brief.get("flares_yesterday") if isinstance(brief.get("flares_yesterday"), dict) else None)
    lines.append(f"- Today: {today or 'GOES flare count unavailable'}")
    lines.append(f"- Yesterday: {yesterday or 'GOES flare count unavailable'}")
    lines.extend(["", "🌍 GEOMAGNETIC CONDITIONS", ""])
    if kp is not None:
        quiet = "Quiet" if kp < 3 else "Unsettled" if kp < 4 else "Active" if kp < 5 else "Storm level"
        lines.append(f"- Planetary Kp Index: {_num(kp, 1)} — {quiet}")
    if speed is not None:
        watch = "Above monitoring threshold" if speed >= WIND_WATCH_KMS else "Below monitoring threshold"
        lines.append(f"- Solar Wind Speed: {_num(speed, 0)} km/s — {watch}")
    if density is not None:
        band = "Low" if density < 3 else "Elevated" if density >= DENSITY_ELEVATED_CM3 else "Moderate"
        lines.append(f"- Solar Wind Density: {_num(density, 2)} cm⁻³ — {band}")
    if bt is not None:
        band = "Weak" if bt < 5 else "Elevated" if bt >= BT_ELEVATED_NT else "Moderate"
        lines.append(f"- IMF Bt: {_num(bt, 1)} nT — {band}")
    if bz is not None:
        if bz <= -0.5:
            facing = "Weakly southward" if bz > BZ_SOUTH_WATCH_NT else "Southward"
        elif bz >= 0.5:
            facing = "Northward"
        else:
            facing = "Near zero"
        lines.append(f"- IMF Bz: {_signed(bz, 1)} nT — {facing}")
    if dst is not None:
        storm = "No geomagnetic storm indicated" if dst > DST_STORM_NT else "Storm range"
        lines.append(f"- Dst Index: {_signed(dst, 0)} nT — {storm}")
    lines.extend(["", _NEGATIVE_BZ_LINE, "", "🔮 SPACE WEATHER FORECAST", ""])
    window = str(brief.get("expected_kp_window") or "")
    expected = _float_or_none(brief.get("expected_kp"))
    if expected is not None and window and not _window_is_past(window, issued_cat):
        lines.append(f"NOAA's greatest expected 3-hour Kp for {window} is {_num(expected, 1)}.")
    elif brief.get("coronal_hole_stream") and _window_is_past(window, issued_cat):
        lines.append("A coronal-hole high-speed stream was in an earlier NOAA note. That arrival date has passed and is not a new forecast.")
    elif brief.get("coronal_hole_stream"):
        lines.append("The current NOAA discussion includes a coronal-hole high-speed solar wind stream.")
    if speed is not None and kp is not None:
        wind = "elevated solar wind speed" if speed >= WIND_WATCH_KMS else "solar wind near background levels"
        geo = "quiet geomagnetic conditions" if kp < 4 else "active geomagnetic conditions"
        lines.append(f"The latest measurements show {wind} but {geo}.")
    lines.append("Further geomagnetic activity is possible if stronger and sustained southward IMF Bz develops.")
    lines.extend(
        [
            "",
            "⚡ IMPLICATIONS FOR ZIMBABWE'S POWER GRID",
            "",
            "Current Assessment: No geomagnetic storm is confirmed by these measurements." if level == "YELLOW" or level == "GREEN" else "Current Assessment: Geomagnetic conditions meet a storm screening level. Check the indices above.",
            "",
            "The available measurements are for monitoring. They do not by themselves establish a GIC impact on ZESA/ZETDC infrastructure.",
            "",
            "Continued monitoring of solar wind conditions, geomagnetic indices and available local GIC measurements is recommended.",
            "",
            f"ZINGSA Advisory: {label}",
            "",
            "Yellow is a ZINGSA operational monitoring classification when it is shown. It is not a confirmed geomagnetic storm.",
            "",
            "This solar forecast alternates with the power-grid watch every 15 minutes.",
            "",
            "Live metrics and solar activity images for this message follow.",
            "",
            "Source: NOAA SWPC solar discussion, flare probabilities and GOES flare list, NASA SDO, with ZINGSA live monitoring readings.",
            "",
            "Issued by:",
            "ZINGSA Space Science Department",
            "Zimbabwe National Geospatial and Space Agency",
        ]
    )
    return "\n".join(lines)


def _attach_dashboard(text: str, issued_at: datetime | None = None) -> tuple[str, str | None]:
    """Add a new platform image for this message. Text still sends if it cannot."""
    try:
        from zgiis.space_weather.dashboard_snapshot import publish_dashboard_snapshot

        image_url = publish_dashboard_snapshot(issued_at)
    except Exception:
        image_url = None
    if image_url:
        text = text.rstrip() + "\n\nLive Space Weather platform at the time of this message:"
    return text, image_url


def _attach_message_views(text: str, issued_at: datetime | None = None) -> tuple[str, list[tuple[str, str]]]:
    """Add the fresh live-metrics chart and solar-activity image for this send."""
    try:
        from zgiis.space_weather.dashboard_snapshot import publish_message_views

        views = publish_message_views(issued_at)
    except Exception:
        views = []
    if views:
        text = text.rstrip() + "\n\n" + "\n".join(f"{label}:" for label, _url in views)
    return text, views


def dispatch_power_grid_advisory(
    *,
    issued_at: datetime | None = None,
    brief: bool = False,
    kind: str | None = None,
) -> dict[str, Any]:
    """Collect live readings, post one Slack advisory, and return a secret-free result."""
    readings = collect_power_grid_readings()
    issued = issued_at or datetime.now(CAT)
    if kind not in {None, "solar", "grid", "daily"}:
        kind = None
    if kind is None:
        kind = advisory_kind(issued) if brief else "daily"
    try:
        if kind == "solar":
            from zgiis.space_weather.solar_brief import build_solar_brief

            text = format_solar_forecast(readings, build_solar_brief(), issued_at=issued)
        elif brief:
            text = format_power_grid_quarter(readings, issued_at=issued)
        else:
            text = format_power_grid_advisory(readings, issued_at=issued)
    except ValueError as exc:
        return {"ok": False, "detail": str(exc), "level": None}
    if brief:
        text, views = _attach_message_views(text, issued)
        ok, detail = post_slack(text, image_urls=views)
        image = bool(views)
    else:
        text, image_url = _attach_dashboard(text, issued)
        ok, detail = post_slack(text, image_url=image_url)
        image = bool(image_url)
    return {
        "ok": ok,
        "detail": detail,
        "level": classify_power_grid_level(readings),
        "kind": kind,
        "image": image,
        "issued_cat": issued.astimezone(CAT).strftime("%Y-%m-%d %H:%M"),
    }


_SUSTAIN_MINUTES = 10.0
_LEVEL_WORD = {
    "YELLOW": "ELEVATED SPACE WEATHER WATCH",
    "ORANGE": "GEOMAGNETIC STORM WARNING",
    "RED": "SEVERE GEOMAGNETIC ALERT",
}


def active_power_grid_triggers(readings: dict[str, Any]) -> list[dict[str, str]]:
    """Thresholds that have been reached. High-rate solar-wind series must hold for 10 minutes."""
    triggers: list[dict[str, str]] = []
    speed = _float_or_none(readings.get("speed"))
    bz = _float_or_none(readings.get("bz"))
    bt = _float_or_none(readings.get("bt"))
    density = _float_or_none(readings.get("density"))
    kp = _float_or_none(readings.get("kp"))
    dst = _float_or_none(readings.get("dst"))

    def held(name: str) -> float:
        value = readings.get(name)
        try:
            return float(value) if value is not None else 0.0
        except (TypeError, ValueError):
            return 0.0

    if speed is not None and speed >= WIND_WATCH_KMS and held("speed_high_minutes") >= _SUSTAIN_MINUTES:
        triggers.append({"id": "solar_wind_speed", "phrase": f"solar wind speed at or above {WIND_WATCH_KMS:.0f} km/s"})
    if bz is not None and bz <= BZ_SOUTH_WATCH_NT and held("bz_watch_minutes") >= _SUSTAIN_MINUTES:
        triggers.append({"id": "imf_bz", "phrase": f"IMF Bz at or below {BZ_SOUTH_WATCH_NT:.0f} nT"})
    if bt is not None and bt >= BT_ELEVATED_NT and held("bt_high_minutes") >= _SUSTAIN_MINUTES:
        triggers.append({"id": "imf_bt", "phrase": f"IMF Bt at or above {BT_ELEVATED_NT:.0f} nT"})
    if density is not None and density >= DENSITY_ELEVATED_CM3 and held("density_high_minutes") >= _SUSTAIN_MINUTES:
        triggers.append({"id": "solar_wind_density", "phrase": f"solar wind density at or above {DENSITY_ELEVATED_CM3:.0f} cm⁻³"})
    if kp is not None and kp >= KP_G3:
        triggers.append({"id": "kp_severe", "phrase": f"planetary Kp at or above {KP_G3:.0f}"})
    elif kp is not None and kp >= KP_G1:
        triggers.append({"id": "kp_storm", "phrase": f"planetary Kp at or above {KP_G1:.0f}"})
    if dst is not None and dst <= DST_STRONG_NT:
        triggers.append({"id": "dst_strong", "phrase": f"Dst at or below {DST_STRONG_NT:.0f} nT"})
    elif dst is not None and dst <= DST_STORM_NT:
        triggers.append({"id": "dst_storm", "phrase": f"Dst at or below {DST_STORM_NT:.0f} nT"})
    return triggers


def trigger_level(triggers: list[dict[str, str]]) -> str | None:
    ids = {item["id"] for item in triggers}
    if "kp_severe" in ids:
        return "RED"
    if ids & {"kp_storm", "dst_storm", "dst_strong"}:
        return "ORANGE"
    if triggers:
        return "YELLOW"
    return None


def _next_issue(issued_cat: datetime) -> str:
    local = issued_cat.astimezone(CAT)
    for hour in (6, 12, 18):
        candidate = local.replace(hour=hour, minute=0, second=0, microsecond=0)
        if candidate > local:
            return candidate.strftime("%H:%M CAT")
    return "00:00 CAT"


def _data_status(readings: dict[str, Any], issued: datetime) -> str:
    stamps = [readings.get("solar_time"), readings.get("index_time")]
    ages: list[float] = []
    for stamp in stamps:
        if not stamp:
            continue
        try:
            parsed = datetime.fromisoformat(str(stamp).replace("Z", "+00:00"))
        except (TypeError, ValueError):
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        ages.append(abs((issued.astimezone(timezone.utc) - parsed.astimezone(timezone.utc)).total_seconds()) / 60.0)
    if not ages:
        return "Unavailable"
    if max(ages) <= 45:
        return "Validated"
    return "Delayed"


def _trigger_sentence(triggers: list[dict[str, str]]) -> str:
    phrases = [item["phrase"] for item in triggers]
    if len(phrases) == 1:
        found = phrases[0]
    else:
        found = ", ".join(phrases[:-1]) + " and " + phrases[-1]
    return (
        "The ZINGSA Space Weather Monitoring System has detected "
        f"{found}. These conditions may increase the likelihood of geomagnetic "
        "disturbances that could potentially affect electricity transmission infrastructure."
    )


def _mark(active: bool) -> str:
    return " ⚠️ Threshold reached" if active else ""


def format_power_grid_threshold_alert(
    readings: dict[str, Any],
    triggers: list[dict[str, str]],
    *,
    alert_id: str,
    issued_at: datetime | None = None,
) -> str:
    """Automatic alert. Raises ValueError when nothing has crossed a threshold."""
    if not triggers:
        raise ValueError("no power-grid threshold reached")
    speed = _float_or_none(readings.get("speed"))
    bz = _float_or_none(readings.get("bz"))
    bt = _float_or_none(readings.get("bt"))
    density = _float_or_none(readings.get("density"))
    kp = _float_or_none(readings.get("kp"))
    dst = _float_or_none(readings.get("dst"))
    issued = issued_at or datetime.now(CAT)
    if issued.tzinfo is None:
        issued = issued.replace(tzinfo=CAT)
    issued_cat = issued.astimezone(CAT)
    level = trigger_level(triggers) or "YELLOW"
    emoji, _label = _LEVELS[level]
    ids = {item["id"] for item in triggers}
    lines = [
        f"{emoji} *ZINGSA AUTOMATED SPACE WEATHER ALERT*",
        "",
        "⚡ *GEOMAGNETIC DISTURBANCE — POWER GRID WATCH*",
        "",
        "*Recipient:* ZESA Holdings / ZETDC",
        f"*Alert Level:* {emoji} {_LEVEL_WORD[level]}",
        f"*Issued:* {issued_cat.strftime('%d %b %Y, %H:%M')} CAT",
        f"*Alert ID:* {alert_id}",
        "*Status:* Precautionary Monitoring" if level == "YELLOW" else f"*Status:* {_STATUS[level]}",
        "",
        "🚨 *ALERT TRIGGERED*",
        "",
        _trigger_sentence(triggers),
        "",
        "📊 *SPACE WEATHER PARAMETERS*",
        "",
    ]
    if speed is not None:
        lines.append(f"☀️ Solar Wind Speed: *{_num(speed, 0)} km/s*{_mark('solar_wind_speed' in ids)} (watch >{WIND_WATCH_KMS:.0f} km/s)")
    if bz is not None:
        lines.append(f"🧲 IMF Bz: *{_signed(bz, 1)} nT*{_mark('imf_bz' in ids)} ({_bz_note(bz, readings.get('bz_south_minutes'))})")
    if bt is not None:
        lines.append(f"🧲 IMF Bt: *{_num(bt, 1)} nT*{_mark('imf_bt' in ids)}")
    if kp is not None:
        storm = "At or above the storm threshold" if kp >= KP_G1 else "Below storm threshold"
        lines.append(f"🌍 Geomagnetic Kp: *{_num(kp, 1)}* — {storm}{_mark('kp_storm' in ids or 'kp_severe' in ids)}")
    if dst is not None:
        lines.append(f"📉 Dst Index: *{_signed(dst, 0)} nT*{_mark('dst_storm' in ids or 'dst_strong' in ids)}")
    if density is not None:
        lines.append(f"💨 Solar Wind Density: *{_num(density, 2)} cm⁻³*{_mark('solar_wind_density' in ids)}")
    lines.extend(["", _NEGATIVE_BZ_LINE])
    sources = ["NOAA SWPC RTSW"]
    if readings.get("index_time"):
        sources.append("ZINGSA Live Space Weather")
    lines.extend(
        [
            "",
            f"*Assessment:* {_assessment(level, readings)}",
            "",
            "⚡ *POTENTIAL POWER GRID IMPLICATIONS*",
            "",
            "If geomagnetic disturbances intensify, geomagnetically induced currents (GICs) may contribute to:",
            "",
            "• Transformer saturation and abnormal heating.",
            "• Increased reactive power consumption.",
            "• Voltage instability and harmonic distortion.",
            "• Abnormal transformer neutral currents.",
            "",
            "🛠️ *RECOMMENDED ACTIONS — ZESA/ZETDC*",
            "",
            "✅ Increase monitoring of transformer neutral currents where sensors are available.",
            "✅ Monitor reactive power demand, voltage stability and harmonic distortion.",
            "✅ Review readiness of voltage regulation and reactive power support systems.",
            "✅ Maintain heightened awareness of potentially vulnerable transformers and transmission lines.",
            "✅ Review established grid contingency procedures.",
            "✅ Report unusual grid behaviour for further assessment.",
            "",
            "🚦 *ALERT ESCALATION CONDITIONS*",
            "",
            "The system will reassess the advisory if:",
            "",
            "• Kp reaches *5 or above*.",
            "• IMF Bz remains strongly southward.",
            "• Dst/SYM-H indicates significant geomagnetic intensification.",
            "• Local magnetic dB/dt increases significantly.",
            "• Available GIC measurements indicate abnormal currents.",
            "",
            "📢 *CURRENT ASSESSMENT*",
            "",
            f"{emoji} *{_LEVEL_WORD[level]}*",
            "",
            _current_line(level),
            "",
            f"*Next Update:* {_next_issue(issued_cat)}",
            f"*Data Sources:* {' / '.join(sources)}",
            f"*Data Status:* {_data_status(readings, issued_cat)}",
            "",
            "🔗 *ZINGSA Space Weather Monitoring Platform:*",
            "https://zingsa-gnss-tec.vercel.app/space-weather/",
            "",
            "*Issued automatically by:*",
            "ZINGSA Space Weather Monitoring System",
            "Space Science Department",
            "Zimbabwe National Geospatial and Space Agency",
        ]
    )
    return "\n".join(lines)


def dispatch_threshold_alert(*, issued_at: datetime | None = None, readings: dict[str, Any] | None = None) -> dict[str, Any]:
    """Post the automatic alert once per new set of crossed thresholds."""
    from zgiis.db.config import DatabaseUnavailable
    from zgiis.db.power_grid_alert_db import PowerGridAlertDB

    observed = readings if readings is not None else collect_power_grid_readings()
    triggers = active_power_grid_triggers(observed)
    level = trigger_level(triggers)
    signature = level + "|" + ",".join(item["id"] for item in triggers) if level else ""
    try:
        db = PowerGridAlertDB()
    except DatabaseUnavailable as exc:
        return {"ok": False, "sent": False, "detail": str(exc), "level": level}
    try:
        if not triggers:
            db.resolve_open()
            return {"ok": True, "sent": False, "detail": "no threshold reached", "level": None}
        current = db.latest_open()
        if current and current.get("signature") == signature:
            return {"ok": True, "sent": False, "detail": "already sent for these thresholds", "level": level, "alert_id": current.get("alert_id")}
        issued = issued_at or datetime.now(CAT)
        issued_cat = issued.astimezone(CAT)
        day_key = issued_cat.strftime("%Y%m%d")
        alert_id = f"ZINGSA-GIC-{day_key}-{db.count_for_day(day_key) + 1:03d}"
        text = format_power_grid_threshold_alert(observed, triggers, alert_id=alert_id, issued_at=issued)
        text, image_url = _attach_dashboard(text, issued)
        ok, detail = post_slack(text, image_url=image_url)
        if not ok:
            return {"ok": False, "sent": False, "detail": detail, "level": level, "alert_id": alert_id}
        db.insert_open(
            alert_id=alert_id,
            issued_at=issued_cat.isoformat(),
            level=level or "YELLOW",
            signature=signature,
            triggers=[item["id"] for item in triggers],
        )
        return {"ok": True, "sent": True, "detail": detail, "level": level, "alert_id": alert_id}
    finally:
        db.close()
