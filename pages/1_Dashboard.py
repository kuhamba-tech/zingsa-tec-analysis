"""ZGIIS live space-weather and Zimbabwe CORS dashboard."""
from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

root = Path(__file__).resolve().parents[1]
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
from zgiis.space_weather.fetch_indices import clear_space_weather_cache, get_space_weather
from zgiis.space_weather.kp_scale import build_synchronized_kp_scales_html
from zgiis.space_weather.live_timelines import render_all_live_metric_timelines
from zgiis.theme import inject

st.set_page_config(
    page_title="ZGIIS Dashboard",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="expanded",
)
inject(st, page_id="dashboard")

st.markdown(
    "<div class='zgiis-title'>Space Weather Operations Dashboard</div>"
    "<div class='zgiis-tagline'>Real-time monitoring of solar, geomagnetic, "
    "ionospheric, and Zimbabwe CORS network conditions.</div>",
    unsafe_allow_html=True,
)

_col_title, _col_refresh = st.columns([10, 1])
with _col_refresh:
    if st.button("↺ Refresh", key="dashboard_refresh", help="Fetch latest space weather data now"):
        clear_space_weather_cache()
        st.rerun()

sw = get_space_weather()
risk_color = sw.get("gnss_risk_color", "#1D9E75")
online = sw.get("stations_online")
total = sw.get("stations_total")
stations_label = f"{online}/{total}" if online is not None and total else "N/A"

dst = sw.get("dst")
dst_value = f"{dst:+.0f} nT" if dst is not None else "N/A"
dst_color = (
    "#ef4444"
    if dst is not None and dst < -100
    else "#f97316"
    if dst is not None and dst < -50
    else "#eab308"
    if dst is not None and dst < -20
    else "#00ff88"
)

s4 = sw.get("s4")
s4_value = f"{s4:.2f}" if s4 is not None else "N/A"
s4_color = (
    "#ef4444"
    if s4 is not None and s4 >= 0.5
    else "#f97316"
    if s4 is not None and s4 >= 0.3
    else "#eab308"
    if s4 is not None and s4 >= 0.1
    else "#00ff88"
    if s4 is not None
    else "#ffffff"
)

solar_wind_speed = sw.get("solar_wind_speed")
solar_wind_density = sw.get("solar_wind_density")
solar_wind_value = (
    f"{solar_wind_speed} km/s" if solar_wind_speed is not None else "N/A"
)
solar_wind_note = (
    f"{solar_wind_density} p/cm³"
    if solar_wind_density is not None
    else "Solar wind speed"
)
solar_wind_color = (
    "#ef4444"
    if solar_wind_speed is not None and solar_wind_speed > 600
    else "#eab308"
    if solar_wind_speed is not None and solar_wind_speed > 400
    else "#00ff88"
)

metric_cards = [
    (
        "kp",
        "🧭",
        "Kp Index",
        sw["kp"] if sw["kp"] is not None else "N/A",
        "Planetary activity",
        "#00d4ff" if sw["kp"] is not None else "#ffffff",
    ),
    (
        "geomagnetic",
        "🌌",
        "Geomagnetic",
        sw["kp_condition"],
        "Current state",
        sw.get("kp_color", "#00ff88"),
    ),
    ("dst", "🌡️", "Dst Index", dst_value, "Storm index", dst_color),
    (
        "f107",
        "☀️",
        "Solar Flux",
        sw["f107"] if sw["f107"] is not None else "N/A",
        "Solar flux units",
        "#00d4ff" if sw["f107"] is not None else "#ffffff",
    ),
    (
        "solar_wind",
        "🌬️",
        "Solar Wind",
        solar_wind_value,
        solar_wind_note,
        solar_wind_color,
    ),
    (
        "s4",
        "📶",
        "Scintillation S4",
        s4_value,
        "Observed archive" if s4 is not None else "Observed data unavailable",
        s4_color,
    ),
    (
        "gnss_risk",
        "🛰️",
        "GNSS Risk",
        sw["gnss_risk"],
        "Navigation impact",
        risk_color,
    ),
    (
        "stations",
        "📡",
        "Stations Online",
        stations_label,
        "Live telemetry unavailable" if online is None else "Zimbabwe CORS",
        "#00d4ff",
    ),
]

metric_explanations = {
    "kp": (
        "A 0-9 scale updated every 3 hours that summarises how disturbed Earth's "
        "magnetic field is across the entire planet. It is derived from a network "
        "of ground magnetometers worldwide. Kp 0-1 indicates quiet conditions, "
        "while Kp 5 or higher marks the beginning of a geomagnetic storm. Kp 8-9 "
        "represents an extreme storm. Zimbabwe's CORS network is directly affected "
        "from Kp 5 onwards as ionospheric irregularities increase sharply."
    ),
    "geomagnetic": (
        "A geomagnetic storm is a major temporary disturbance of Earth's "
        "magnetosphere caused by solar activity. A solar-wind shock wave or coronal "
        "mass ejection colliding with Earth compresses the dayside magnetosphere and "
        "stretches its nightside, driving electric currents that affect power grids "
        "and GNSS satellites. Storms are classified G1-G5 using Kp, with G5 the most "
        "severe. Zimbabwe's equatorial location means scintillation and TEC spikes "
        "are the primary impacts."
    ),
    "dst": (
        "The Disturbance Storm Time index measures the average horizontal magnetic "
        "field around Earth's equator. When a solar storm reaches Earth, it "
        "compresses and distorts the magnetic field, causing the Dst value to drop "
        "sharply negative. The more negative the value, the more severe the "
        "geomagnetic storm. It acts as a global magnetic-disturbance meter."
    ),
    "f107": (
        "Solar Flux F10.7 measures the radio energy emitted by the Sun at a 10.7 cm "
        "wavelength (2.8 GHz). It is a reliable daily proxy for solar ultraviolet "
        "radiation, the main driver of ionospheric electron density and TEC. Higher "
        "F10.7 means a more ionised, electrically thicker atmosphere above Zimbabwe, "
        "which increases GNSS error and signal degradation."
    ),
    "solar_wind": (
        "The Sun continuously releases a stream of charged particles called the "
        "solar wind. Normal speed is about 400 km/s. When a solar eruption reaches "
        "Earth, the speed can rise above 700 km/s. High-speed streams compress "
        "Earth's magnetosphere and amplify geomagnetic effects, acting as the "
        "delivery mechanism for solar storms."
    ),
    "s4": (
        "The S4 scintillation index measures how much a GNSS or radio signal's "
        "amplitude fluctuates while passing through irregular ionospheric plasma. "
        "S4 = 0 means a steady signal, while S4 = 1 indicates severe fluctuation and "
        "possible total fading. Values above 0.5 can cause receivers to lose lock on "
        "satellites. This is especially important near Zimbabwe's equatorial region."
    ),
    "gnss_risk": (
        "GNSS Risk is a combined operational assessment for positioning and "
        "navigation users. It considers geomagnetic activity, ionospheric TEC, S4 "
        "scintillation and related space-weather indicators. Low risk supports "
        "routine CORS and RTK operations; increasing risk means users should verify "
        "fixes, use dual-frequency observations and consider post-processing."
    ),
    "stations": (
        "Stations Online shows how many Zimbabwe CORS stations are currently "
        "reporting usable data compared with the total network. A lower online count "
        "reduces geographic coverage and may weaken real-time correction reliability. "
        "Users should confirm that nearby stations are operational before relying on "
        "RTK, network corrections or regional TEC monitoring."
    ),
}


def interpret_metric(metric_key: str) -> str:
    """Interpret the currently displayed metric value."""
    if metric_key == "kp":
        if sw["kp"] is None:
            return "The live Kp feed is unavailable. No geomagnetic interpretation is issued."
        kp = float(sw["kp"])
        if kp < 3:
            return (
                f"Kp {kp:g} indicates quiet geomagnetic conditions. GNSS and CORS "
                "operations should remain stable, with minimal storm-related disturbance."
            )
        if kp < 4:
            return (
                f"Kp {kp:g} indicates unsettled conditions. Small ionospheric changes "
                "are possible, so precision users should continue monitoring."
            )
        if kp < 5:
            return (
                f"Kp {kp:g} indicates active geomagnetic conditions. Increased TEC "
                "variation and scintillation may begin affecting precise positioning."
            )
        if kp < 7:
            return (
                f"Kp {kp:g} indicates a G1-G2 geomagnetic storm. GNSS accuracy, RTK "
                "fixes and CORS corrections may be degraded."
            )
        return (
            f"Kp {kp:g} indicates a strong to extreme geomagnetic storm. Significant "
            "GNSS disruption and positioning errors should be expected."
        )

    if metric_key == "geomagnetic":
        if sw["kp"] is None:
            return "The geomagnetic condition is unavailable because no live Kp observation was received."
        return (
            f"The current geomagnetic state is {sw['kp_condition']}. "
            + (
                "Earth's magnetic field is presently stable, supporting normal GNSS operations."
                if float(sw["kp"]) < 3
                else "Magnetic disturbance is active and precision GNSS performance should be monitored."
            )
        )

    if metric_key == "dst":
        if dst is None:
            return (
                "No current Dst measurement is available, so ring-current storm "
                "intensity cannot be interpreted from this indicator at present."
            )
        if dst > -20:
            level = "quiet"
        elif dst > -50:
            level = "weakly disturbed"
        elif dst > -100:
            level = "moderately disturbed"
        elif dst > -200:
            level = "an intense geomagnetic storm"
        elif dst > -350:
            level = "a severe geomagnetic storm"
        else:
            level = "an exceptional super-storm"
        return f"Dst {dst:+.0f} nT indicates {level} conditions."

    if metric_key == "f107":
        if sw["f107"] is None:
            return "The live F10.7 feed is unavailable. No solar-flux interpretation is issued."
        flux = float(sw["f107"])
        if flux < 80:
            level = "solar-minimum activity and generally low background ionisation"
        elif flux < 100:
            level = "low solar activity"
        elif flux < 130:
            level = "below-average to moderate solar activity"
        elif flux < 170:
            level = "moderate solar activity and elevated daytime TEC"
        elif flux < 220:
            level = "high solar activity with increased ionospheric electron density"
        else:
            level = "very high to extreme solar activity"
        return f"F10.7 at {flux:g} SFU indicates {level}."

    if metric_key == "solar_wind":
        if solar_wind_speed is None:
            return (
                "No current solar-wind speed is available, so its present influence "
                "on Earth's magnetosphere cannot be assessed."
            )
        speed = float(solar_wind_speed)
        if speed < 350:
            level = "a slow solar wind with limited geomagnetic forcing"
        elif speed < 450:
            level = "a typical solar-wind flow"
        elif speed < 550:
            level = "a fast solar wind that may increase geomagnetic activity"
        elif speed < 650:
            level = "a very fast stream capable of disturbing the magnetosphere"
        else:
            level = "storm-level solar wind with elevated geomagnetic risk"
        return f"A solar-wind speed of {speed:g} km/s represents {level}."

    if metric_key == "s4":
        if s4 is None:
            return sw.get(
                "ionosphere_data_note",
                "No observed S4 measurement is available.",
            )
        if s4 < 0.1:
            level = "no significant scintillation and a stable GNSS signal"
        elif s4 < 0.2:
            level = "negligible scintillation"
        elif s4 < 0.3:
            level = "weak scintillation with minor signal fluctuation"
        elif s4 < 0.5:
            level = "moderate scintillation that may reduce positioning quality"
        elif s4 < 0.7:
            level = "strong scintillation with possible satellite lock loss"
        else:
            level = "severe scintillation and a high risk of signal outage"
        return f"S4 at {s4:.2f} indicates {level}."

    if metric_key == "gnss_risk":
        interpretations = {
            "Low": "Routine GNSS, RTK and CORS operations can continue normally.",
            "Moderate": "Verify precision fixes and monitor ionospheric conditions.",
            "High": "Expect positioning degradation; use dual-frequency data and validation.",
            "Critical": "GNSS positioning may be unreliable; postpone critical operations where possible.",
        }
        risk = str(sw["gnss_risk"])
        return f"The current GNSS risk is {risk}. {interpretations.get(risk, 'Continue monitoring current conditions.')}"

    if online is None or not total:
        return sw.get(
            "station_data_note",
            "No live CORS telemetry is available.",
        )
    availability = online / total * 100
    if availability >= 90:
        level = "excellent network availability"
    elif availability >= 70:
        level = "good availability with some local coverage gaps"
    elif availability >= 50:
        level = "reduced availability that may affect regional corrections"
    else:
        level = "low availability with significant CORS coverage limitations"
    return (
        f"{online} of {total} stations are online ({availability:.0f}%), indicating "
        f"{level}."
    )


def assess_current_condition() -> tuple[str, str, list[str]]:
    """Return banner class, headline and rule-based findings for all live metrics."""
    findings: list[tuple[int, str]] = []
    kp_value = sw.get("kp")
    flux_value = sw.get("f107")
    risk = str(sw.get("gnss_risk", "Low"))
    availability = (online / total * 100) if online is not None and total else None

    if kp_value is None:
        findings.append((1, "Live Kp feed unavailable"))
    else:
        kp = float(kp_value)
    if kp_value is not None and kp >= 7:
        findings.append((3, f"Kp {kp:g}: strong-to-extreme geomagnetic storm"))
    elif kp_value is not None and kp >= 5:
        findings.append((2, f"Kp {kp:g}: geomagnetic storm conditions"))
    elif kp_value is not None and kp >= 4:
        findings.append((2, f"Kp {kp:g}: active geomagnetic conditions"))
    elif kp_value is not None and kp >= 3:
        findings.append((1, f"Kp {kp:g}: unsettled geomagnetic activity"))

    if dst is not None:
        if dst <= -100:
            findings.append((3, f"Dst {dst:+.0f} nT: severe ring-current disturbance"))
        elif dst <= -50:
            findings.append((2, f"Dst {dst:+.0f} nT: intense magnetic disturbance"))
        elif dst <= -30:
            findings.append((1, f"Dst {dst:+.0f} nT: moderate magnetic disturbance"))

    if s4 is None:
        findings.append((1, sw.get("ionosphere_data_note", "Observed S4 unavailable")))
    elif s4 >= 0.5:
        findings.append((3, f"S4 {s4:.2f}: strong scintillation and lock-loss risk"))
    elif s4 >= 0.3:
        findings.append((2, f"S4 {s4:.2f}: moderate scintillation"))
    elif s4 >= 0.2:
        findings.append((1, f"S4 {s4:.2f}: weak scintillation"))

    if solar_wind_speed is not None:
        speed = float(solar_wind_speed)
        if speed >= 650:
            findings.append((3, f"Solar wind {speed:g} km/s: storm-level stream"))
        elif speed >= 550:
            findings.append((2, f"Solar wind {speed:g} km/s: very fast stream"))
        elif speed >= 450:
            findings.append((1, f"Solar wind {speed:g} km/s: fast stream"))

    if flux_value is None:
        findings.append((1, "Live F10.7 feed unavailable"))
    else:
        flux = float(flux_value)
    if flux_value is not None and flux >= 270:
        findings.append((2, f"F10.7 {flux:g} SFU: extreme background solar activity"))
    elif flux_value is not None and flux >= 220:
        findings.append((2, f"F10.7 {flux:g} SFU: very high solar activity"))
    elif flux_value is not None and flux >= 170:
        findings.append((1, f"F10.7 {flux:g} SFU: high solar activity"))

    risk_levels = {"Moderate": 1, "High": 2, "Critical": 3}
    if risk in risk_levels:
        findings.append((risk_levels[risk], f"GNSS risk is {risk}"))

    if availability is None:
        findings.append((2, sw.get("station_data_note", "Live CORS telemetry unavailable")))
    elif availability < 50:
        findings.append(
            (3, f"CORS availability {online}/{total} ({availability:.0f}%): critical coverage loss")
        )
    elif availability < 70:
        findings.append(
            (2, f"CORS availability {online}/{total} ({availability:.0f}%): reduced coverage")
        )
    elif availability < 90:
        findings.append(
            (1, f"CORS availability {online}/{total} ({availability:.0f}%): partial coverage")
        )

    if not findings:
        return (
            "ok-box",
            "Current condition: Nominal",
            ["All displayed metrics are within nominal operating thresholds."],
        )

    severity = max(level for level, _ in findings)
    relevant = [
        text
        for _, text in sorted(findings, key=lambda finding: finding[0], reverse=True)
    ]
    if severity >= 3:
        return "alert-box", "Current condition: Critical action required", relevant
    if severity == 2:
        return "alert-box", "Current condition: Disturbed", relevant
    return "warn-box", "Current condition: Monitor", relevant


def metric_card_html(
    metric_key: str,
    icon: str,
    label: str,
    value: object,
    note: str,
    value_color: str,
    *,
    selected: bool,
) -> str:
    selected_class = " hero-click-selected" if selected else ""
    target = "?" if selected else f"?metric={metric_key}"
    return (
        f"<a class='dashboard-card-link' href='{target}' target='_self'>"
        "<div class='zgiis-card zgiis-card-accent hero-status-card "
        f"hero-click-card{selected_class}'>"
        f"<span class='hero-status-icon'>{icon}</span>"
        f"<div class='hero-status-label'>{label}</div>"
        f"<div class='hero-status-value' style='color:{value_color}'>{value}</div>"
        f"<div class='hero-status-note'>{note}</div>"
        "</div>"
        "</a>"
    )


selected_metric = st.query_params.get("metric")
valid_metric_keys = {card[0] for card in metric_cards}
if selected_metric not in valid_metric_keys:
    selected_metric = None

_sw_ts = sw.get("timestamp", "")
_ts_note = f" · Updated {_sw_ts[:16].replace('T', ' ')} UTC" if _sw_ts else ""
_data_mode = sw.get("mode", "")
_mode_badge = (
    "<span style='color:#ef4444;font-weight:700'> · Unavailable</span>"
    if _data_mode == "unavailable"
    else "<span style='color:#00ff88'> · Live</span>"
    if _data_mode in ("live", "archive-blend", "blended")
    else ""
)

with st.container(border=True):
    st.markdown(
        "<div class='dashboard-panel-marker'></div>"
        "<div class='hero-panel-eyebrow'>"
        f"Live space weather · Zimbabwe CORS network{_mode_badge}"
        "</div>"
        "<div style='color:#ffffff;font-size:0.75rem;font-weight:500;"
        "margin-bottom:0.6rem;opacity:0.85'>"
        f"Click a card for an explanation of what the value means.{_ts_note}"
        "</div>",
        unsafe_allow_html=True,
    )

    metrics_html = "".join(
        metric_card_html(
            metric_key,
            icon,
            label,
            value,
            note,
            value_color,
            selected=selected_metric == metric_key,
        )
        for metric_key, icon, label, value, note, value_color in metric_cards
    )
    st.markdown(
        "<style>"
        "#dashboard-metrics-4x2{"
        "display:grid !important;"
        "grid-template-columns:repeat(4,minmax(0,1fr)) !important;"
        "grid-template-rows:repeat(2,minmax(148px,auto)) !important;"
        "gap:0.85rem !important;"
        "align-items:stretch !important;"
        "}"
        "@media(max-width:700px){"
        "#dashboard-metrics-4x2{"
        "grid-template-columns:repeat(2,minmax(0,1fr)) !important;"
        "grid-template-rows:auto !important;"
        "}"
        "}"
        "@media(max-width:430px){"
        "#dashboard-metrics-4x2{grid-template-columns:1fr !important;}"
        "}"
        "</style>"
        f"<div id='dashboard-metrics-4x2' class='dashboard-clickable-grid'>"
        f"{metrics_html}</div>",
        unsafe_allow_html=True,
    )

    if selected_metric:
        selected_card = next(
            card for card in metric_cards if card[0] == selected_metric
        )
        _, _, selected_label, selected_value, _, _ = selected_card
        explanation = metric_explanations[selected_metric]
        interpretation = interpret_metric(selected_metric)
        st.markdown(
            "<div class='pipeline-explain-panel dashboard-explanation-panel'>"
            f"<div class='pipeline-explain-title'>{selected_label}</div>"
            f"<div class='pipeline-explain-section'>Current value: {selected_value}</div>"
            "<div class='pipeline-explain-heading'>Explanation</div>"
            f"<p class='pipeline-explain-body'>{explanation}</p>"
            "<div class='pipeline-explain-heading'>Current Metric Interpretation</div>"
            f"<p class='pipeline-explain-body'>{interpretation}</p>"
            "</div>",
            unsafe_allow_html=True,
        )

    st.markdown(
        build_synchronized_kp_scales_html(sw["kp"]),
        unsafe_allow_html=True,
    )

    condition_class, condition_headline, condition_findings = assess_current_condition()
    condition_details = " · ".join(condition_findings)
    st.markdown(
        f"<div class='{condition_class} dashboard-condition-banner'>"
        f"<strong>{condition_headline}</strong><br>"
        f"<span>{condition_details}</span>"
        "</div>",
        unsafe_allow_html=True,
    )

    render_all_live_metric_timelines(st, sw)
