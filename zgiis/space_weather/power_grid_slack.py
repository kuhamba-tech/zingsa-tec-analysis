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
            readings["index_time"] = current.get("updated_utc")
            if readings.get("speed") is None:
                readings["speed"] = _float_or_none(current.get("plasma_speed"))
    except Exception:
        pass
    return readings


    return text, image_url


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
        "Geomagnetic Disturbance & Power Grid Monitoring",
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
    if readings.get("solar_time") or readings.get("index_time"):
        lines.extend(["", f"Sources: NOAA SWPC RTSW {readings.get('solar_time') or 'unavailable'} UTC. Live Space Weather {readings.get('index_time') or 'unavailable'} UTC."])
    lines.extend(
        [
            "",
            f"Assessment: {_assessment(level, readings)}",
            "",
            "⚡ POTENTIAL POWER GRID IMPACTS",
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
            "",
            f"📢 CURRENT ADVISORY: {label}",
            "",
            _current_line(level),
            "",
            "This live update is sent every 15 minutes. Daily briefs remain at 06:00, 12:00, 18:00 and 00:00 CAT. A separate alert is sent when a threshold is newly crossed.",
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


def dispatch_power_grid_advisory(*, issued_at: datetime | None = None, brief: bool = False) -> dict[str, Any]:
    """Collect live readings, post one Slack advisory, and return a secret-free result."""
    readings = collect_power_grid_readings()
    try:
        text = (
            format_power_grid_quarter(readings, issued_at=issued_at)
            if brief
            else format_power_grid_advisory(readings, issued_at=issued_at)
        )
    except ValueError as exc:
        return {"ok": False, "detail": str(exc), "level": None}
    issued = issued_at or datetime.now(CAT)
    text, image_url = _attach_dashboard(text, issued)
    ok, detail = post_slack(text, image_url=image_url)
    return {
        "ok": ok,
        "detail": detail,
        "level": classify_power_grid_level(readings),
        "image": bool(image_url),
        "issued_cat": (issued_at or datetime.now(CAT)).astimezone(CAT).strftime("%Y-%m-%d %H:%M"),
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
