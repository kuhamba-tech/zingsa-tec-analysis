"""Clickable Space Weather metric cards — Home hero design + explanations."""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

import streamlit as st

HERO_CYAN = "#00d4ff"

METRIC_KEYS = (
    "kp",
    "geomagnetic",
    "dst",
    "f107",
    "solar_wind",
    "s4",
    "gnss_risk",
    "stations",
)

METRIC_EXPLANATIONS: Dict[str, Dict[str, Any]] = {
    "kp": {
        "title": "Kp Index",
        "summary": (
            "The planetary K-index is a 3-hourly measure of global geomagnetic activity on a "
            "scale from 0 (quiet) to 9 (extreme storm). It is derived from magnetometer "
            "stations worldwide and published by NOAA SWPC. Over Zimbabwe, Kp drives "
            "ionospheric disturbance through the equatorial ionization anomaly (EIA)."
        ),
        "scale": [
            ("0 – 2", "Quiet — nominal GNSS/CORS performance"),
            ("3", "Unsettled — minor delays possible near the EIA"),
            ("4", "Active — increased scintillation risk"),
            ("5 – 6", "G1–G2 storm — RTK/PPP degradation likely"),
            ("7 – 9", "G3–G5 storm — significant positioning errors"),
        ],
        "source": "NOAA SWPC Planetary K-index · ZINGSA CORS /api/space-weather/africa",
    },
    "geomagnetic": {
        "title": "Geomagnetic Condition",
        "summary": (
            "A plain-language label mapped from the current Kp index. It describes how "
            "disturbed Earth's magnetic field is and what that means for ionospheric "
            "propagation over Africa."
        ),
        "scale": [
            ("Quiet", "Kp < 3 — stable ionosphere"),
            ("Unsettled", "Kp 3–4 — watch equatorial scintillation"),
            ("Active", "Kp = 4 — dual-frequency recommended"),
            ("G1 Storm", "Kp = 5 — CORS alerts may be issued"),
            ("G2+ Storm", "Kp ≥ 6 — emergency GNSS protocols"),
        ],
        "source": "Derived from Kp · Africa impact model (ZINGSA CORS_Program)",
    },
    "dst": {
        "title": "Dst Index",
        "summary": (
            "The Disturbance Storm Time index measures ring-current strength around Earth's "
            "equator in nanotesla (nT). More negative values indicate stronger geomagnetic "
            "storms and greater GNSS disturbance risk."
        ),
        "scale": [
            ("> -20 nT", "Quiet ring current"),
            ("-20 to -50 nT", "Unsettled to active"),
            ("-50 to -100 nT", "Moderate storm"),
            ("< -100 nT", "Intense storm"),
        ],
        "source": "NOAA SWPC Kyoto Dst index",
    },
    "f107": {
        "title": "F10.7 Solar Flux",
        "summary": (
            "F10.7 is the solar radio flux at 10.7 cm wavelength, measured in solar flux "
            "units (sfu). It tracks solar ultraviolet output that ionizes the upper "
            "atmosphere and controls baseline TEC."
        ),
        "scale": [
            ("< 100 sfu", "Solar minimum — low TEC"),
            ("100 – 150 sfu", "Moderate activity — typical TEC 15–25 TECU"),
            ("150 – 200 sfu", "High activity — elevated TEC, scintillation watch"),
            ("> 200 sfu", "Solar maximum — peak TEC and EIA enhancement"),
        ],
        "source": "NOAA SWPC F10.7 cm flux JSON",
    },
    "solar_wind": {
        "title": "Solar Wind",
        "summary": (
            "The solar wind is the stream of charged particles from the Sun. Speed above "
            "~500 km/s and elevated density can compress Earth's magnetosphere and amplify "
            "geomagnetic effects over Zimbabwe."
        ),
        "scale": [
            ("< 400 km/s", "Slow wind — quiet conditions"),
            ("400 – 600 km/s", "Moderate to fast stream"),
            ("> 600 km/s", "High-speed stream — storm watch"),
        ],
        "source": "NOAA SWPC solar-wind plasma 1-day feed",
    },
    "s4": {
        "title": "Scintillation S4",
        "summary": (
            "The S4 index measures GNSS signal amplitude fluctuation caused by ionospheric "
            "irregularities. Values above 0.5 indicate severe scintillation and possible "
            "loss of satellite lock near the equatorial region."
        ),
        "scale": [
            ("< 0.1", "Negligible scintillation"),
            ("0.1 – 0.3", "Weak fluctuation"),
            ("0.3 – 0.5", "Moderate scintillation"),
            ("> 0.5", "Severe scintillation risk"),
        ],
        "source": "ZINGSA CORS ionosphere archive (HARA)",
    },
    "gnss_risk": {
        "title": "GNSS Risk Level",
        "summary": (
            "A composite risk rating for Zimbabwe CORS and GNSS users. It combines "
            "planetary Kp with ionospheric indicators (VTEC, S4 scintillation, ΔTEC) "
            "from the ZINGSA CORS ionosphere API."
        ),
        "scale": [
            ("Low", "Nominal accuracy — routine CORS operations"),
            ("Moderate", "Minor degradation — verify RTK fixes"),
            ("High", "Significant errors — dual-frequency advised"),
            ("Critical", "Severe disturbance — positioning unreliable"),
        ],
        "source": "ZINGSA CORS /api/ionosphere/status + Kp thresholds",
    },
    "stations": {
        "title": "Stations Online",
        "summary": (
            "Shows how many Zimbabwe CORS stations are currently reporting live telemetry "
            "compared with the total registered network. Reduced availability weakens "
            "regional correction coverage."
        ),
        "scale": [
            ("> 90%", "Excellent network availability"),
            ("70 – 90%", "Good with minor gaps"),
            ("50 – 70%", "Reduced regional coverage"),
            ("< 50%", "Critical coverage loss"),
        ],
        "source": "ZINGSA CORS /api/gnss/station-health",
    },
}


def _metric_card_specs(sw: Dict[str, Any]) -> list[Tuple[str, str, str, str, str, str]]:
    risk_color = sw.get("gnss_risk_color", "#1D9E75")
    kp_color = sw.get("kp_color", HERO_CYAN)
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
        if dst is not None
        else "#ffffff"
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
        if solar_wind_speed is not None
        else "#ffffff"
    )

    return [
        ("kp", "🧭", "Kp Index", str(sw["kp"]), "Planetary activity", HERO_CYAN),
        ("geomagnetic", "🌌", "Geomagnetic", str(sw["kp_condition"]), "Current state", kp_color),
        ("dst", "🌡️", "Dst Index", dst_value, "Storm index", dst_color),
        ("f107", "☀️", "Solar Flux", str(sw["f107"]), "Solar flux units", HERO_CYAN),
        ("solar_wind", "🌬️", "Solar Wind", solar_wind_value, solar_wind_note, solar_wind_color),
        ("s4", "📶", "Scintillation S4", s4_value, "Observed archive" if s4 is not None else "Observed data unavailable", s4_color),
        ("gnss_risk", "🛰️", "GNSS Risk", str(sw["gnss_risk"]), "Navigation impact", risk_color),
        ("stations", "📡", "Stations Online", stations_label, "Live telemetry unavailable" if online is None else "Zimbabwe CORS", HERO_CYAN),
    ]


def _hero_card_html(
    icon: str,
    label: str,
    value: str,
    note: str,
    value_color: str,
    *,
    selected: bool = False,
    compact: bool = False,
) -> str:
    selected_cls = " hero-click-selected" if selected else ""
    compact_cls = " hero-status-card-compact" if compact else ""
    return (
        f"<div class='zgiis-card zgiis-card-accent hero-status-card{compact_cls}"
        f" hero-click-card{selected_cls}'>"
        f"<span class='hero-status-icon'>{icon}</span>"
        f"<div class='hero-status-label'>{label}</div>"
        f"<div class='hero-status-value' style='color:{value_color}'>{value}</div>"
        f"<div class='hero-status-note'>{note}</div>"
        f"</div>"
    )


def _home_hero_metric_specs(sw: Dict[str, Any]) -> list[Tuple[str, str, str, str, str, str]]:
    """Four headline metrics for the Home page hero strip."""
    risk_color = sw.get("gnss_risk_color", "#1D9E75")
    kp_color = sw.get("kp_color", HERO_CYAN)
    online = sw.get("stations_online")
    total = sw.get("stations_total")
    stations_label = f"{online}/{total}" if online is not None and total else "N/A"
    kp_val = sw.get("kp")

    return [
        (
            "kp",
            "🧭",
            "Kp Index",
            f"{kp_val}" if kp_val is not None else "N/A",
            "Planetary activity",
            HERO_CYAN if kp_val is not None else "#ffffff",
        ),
        (
            "geomagnetic",
            "🌌",
            "Geomagnetic condition",
            str(sw.get("kp_condition", "N/A")),
            "Current state",
            kp_color,
        ),
        (
            "gnss_risk",
            "🛰️",
            "GNSS Risk",
            str(sw.get("gnss_risk", "N/A")),
            "Navigation impact",
            risk_color,
        ),
        (
            "stations",
            "📡",
            "Stations Online",
            stations_label,
            "Live telemetry unavailable" if online is None else "Zimbabwe CORS",
            HERO_CYAN,
        ),
    ]


def _home_hero_metric_card_iframe(
    icon: str,
    label: str,
    value: str,
    note: str,
    value_color: str,
) -> str:
    return (
        "<div class='col'>"
        "<div class='card'>"
        f"<span class='icon'>{icon}</span>"
        f"<div class='label'>{label}</div>"
        f"<div class='value' style='color:{value_color}'>{value}</div>"
        f"<div class='note'>{note}</div>"
        "</div></div>"
    )


def _home_hero_metrics_iframe_html(sw: Dict[str, Any]) -> str:
    """Self-contained horizontal metrics row — immune to Streamlit markdown layout."""
    cards = "".join(
        _home_hero_metric_card_iframe(icon, label, value, note, value_color)
        for _, icon, label, value, note, value_color in _home_hero_metric_specs(sw)
    )
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  * {{ box-sizing: border-box; margin: 0; padding: 0; }}
  html, body {{
    background: #060d1a;
    font-family: Arial, Helvetica, sans-serif;
    overflow: hidden;
  }}
  .panel {{
    background: linear-gradient(155deg, rgba(13, 27, 42, 0.98), rgba(8, 18, 32, 0.94));
    border: 1px solid #1e3a5f;
    border-radius: 14px;
    padding: 14px 16px 12px;
    box-shadow: 0 10px 32px rgba(0, 0, 0, 0.28);
  }}
  .eyebrow {{
    color: #00d4ff;
    font-size: 11px;
    font-weight: 800;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    margin-bottom: 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(30, 58, 95, 0.55);
  }}
  .row {{
    display: flex;
    flex-direction: row;
    flex-wrap: nowrap;
    align-items: stretch;
    gap: 10px;
    width: 100%;
  }}
  .col {{
    flex: 1 1 0;
    min-width: 0;
    display: flex;
  }}
  .card {{
    flex: 1 1 auto;
    width: 100%;
    background: rgba(10, 22, 40, 0.94);
    border: 1px solid #1e3a5f;
    border-left: 3px solid #00d4ff;
    border-radius: 10px;
    padding: 12px 8px 10px;
    text-align: center;
    min-height: 108px;
    display: flex;
    flex-direction: column;
    align-items: center;
  }}
  .icon {{ font-size: 20px; line-height: 1.2; margin-bottom: 6px; }}
  .label {{
    color: #ffffff;
    font-size: 11px;
    font-weight: 750;
    line-height: 1.3;
    min-height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
  }}
  .value {{
    font-size: clamp(18px, 1.6vw, 24px);
    font-weight: 900;
    line-height: 1.1;
    margin-top: 4px;
  }}
  .note {{
    color: #ffffff;
    font-size: 10px;
    line-height: 1.2;
    opacity: 0.92;
    margin-top: auto;
    padding-top: 8px;
  }}
</style></head>
<body>
  <div class="panel">
    <div class="eyebrow">Live space weather · Zimbabwe CORS network</div>
    <div class="row">{cards}</div>
  </div>
</body></html>"""


def render_home_hero_metrics(st, sw: Dict[str, Any]) -> None:
    """Render four headline metrics with native Streamlit elements."""
    with st.container(border=True):
        st.markdown(
            "<div style='color:#00d4ff;font-size:0.72rem;font-weight:800;"
            "letter-spacing:0.1em;text-transform:uppercase;margin-bottom:0.7rem'>"
            "Live space weather &middot; Zimbabwe CORS network</div>",
            unsafe_allow_html=True,
        )
        columns = st.columns(4)
        for column, (_, icon, label, value, note, value_color) in zip(
            columns,
            _home_hero_metric_specs(sw),
        ):
            with column:
                st.markdown(
                    _hero_card_html(
                        icon,
                        label,
                        value,
                        note,
                        value_color,
                        compact=True,
                    ),
                    unsafe_allow_html=True,
                )


def _current_value_line(metric_key: str, sw: Dict[str, Any]) -> str:
    if metric_key == "kp":
        return f"Current value: Kp = {sw['kp']}"
    if metric_key == "geomagnetic":
        return f"Current condition: {sw['kp_condition']} (Kp = {sw['kp']})"
    if metric_key == "dst":
        return f"Current Dst: {sw.get('dst', 'N/A')} nT"
    if metric_key == "f107":
        return f"Current flux: {sw['f107']} sfu"
    if metric_key == "solar_wind":
        return (
            f"Current solar wind: {sw.get('solar_wind_speed', 'N/A')} km/s · "
            f"{sw.get('solar_wind_density', 'N/A')} p/cm³"
        )
    if metric_key == "s4":
        return f"Current S4: {sw.get('s4', 'N/A')}"
    if metric_key == "stations":
        online = sw.get("stations_online")
        total = sw.get("stations_total")
        return f"Stations online: {online}/{total}" if online is not None and total else "Stations online: N/A"
    return f"Current risk: {sw['gnss_risk']}"


def _render_explanation(metric_key: str, sw: Dict[str, Any]) -> None:
    info = METRIC_EXPLANATIONS.get(metric_key)
    if not info:
        return
    scale_html = "".join(
        f"<span><strong>{label}</strong> — {desc}</span>"
        for label, desc in info.get("scale", [])
    )
    st.markdown(
        f"<div class='pipeline-explain-panel'>"
        f"<div class='pipeline-explain-title'>{info['title']}</div>"
        f"<div class='pipeline-explain-section' style='color:#00d4ff;font-weight:700'>"
        f"{_current_value_line(metric_key, sw)}</div>"
        f"<p class='pipeline-explain-body'>{info['summary']}</p>"
        f"<div class='pipeline-explain-heading'>Reference scale</div>"
        f"<div class='sw-explain-scale' style='display:grid;gap:0.35rem;margin:0.5rem 0'>"
        f"{scale_html}</div>"
        f"<p class='pipeline-explain-body' style='margin-top:0.75rem;font-size:0.76rem;color:#ffffff'>"
        f"Source: {info['source']}</p>"
        f"</div>",
        unsafe_allow_html=True,
    )


def render_sw_metric_cards(st, sw: Dict[str, Any], *, session_key: str = "sw_metric_sel") -> None:
    """Home hero cards (2×4 grid) — click for explanation panel below."""
    st.markdown(
        "<div class='sw-metric-hint' style='font-size:0.72rem;color:#ffffff;"
        "margin:0 0 0.6rem'>Click a card for an explanation of what the value means.</div>",
        unsafe_allow_html=True,
    )

    if session_key not in st.session_state:
        st.session_state[session_key] = None

    specs = _metric_card_specs(sw)
    row1 = specs[:4]
    row2 = specs[4:]
    for row_specs in (row1, row2):
        cols = st.columns(4)
        for col, (key, icon, label, value, note, value_color) in zip(cols, row_specs):
            active = st.session_state[session_key] == key
            with col:
                st.markdown(
                    "<div class='hero-click-slot'></div>"
                    + _hero_card_html(icon, label, value, note, value_color, selected=active),
                    unsafe_allow_html=True,
                )
                if st.button(
                    "\u200b",
                    key=f"sw_metric_btn_{key}",
                    use_container_width=True,
                    type="secondary",
                ):
                    st.session_state[session_key] = (
                        None if st.session_state[session_key] == key else key
                    )
                    st.rerun()

    selected: Optional[str] = st.session_state.get(session_key)
    if selected:
        _render_explanation(selected, sw)
