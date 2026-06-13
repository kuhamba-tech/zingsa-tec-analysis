"""Clickable Space Weather metric cards — Home hero design + explanations."""
from __future__ import annotations

from typing import Any, Dict, Optional, Tuple

import streamlit as st

HERO_CYAN = "#00d4ff"

METRIC_KEYS = ("kp", "geomagnetic", "f107", "gnss_risk")

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
            "propagation over Africa. Quiet conditions favour sub-centimetre CORS RTK; "
            "storm conditions can cause cycle slips and loss of GNSS fix."
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
    "f107": {
        "title": "F10.7 Solar Flux",
        "summary": (
            "F10.7 is the solar radio flux at 10.7 cm wavelength, measured in solar flux "
            "units (sfu). It tracks solar ultraviolet output that ionizes the upper "
            "atmosphere and controls baseline TEC. Higher F10.7 generally means higher "
            "daytime TEC over Zimbabwe, especially near the geomagnetic equator."
        ),
        "scale": [
            ("< 100 sfu", "Solar minimum — low TEC"),
            ("100 – 150 sfu", "Moderate activity — typical TEC 15–25 TECU"),
            ("150 – 200 sfu", "High activity — elevated TEC, scintillation watch"),
            ("> 200 sfu", "Solar maximum — peak TEC and EIA enhancement"),
        ],
        "source": "NOAA SWPC F10.7 cm flux JSON",
    },
    "gnss_risk": {
        "title": "GNSS Risk Level",
        "summary": (
            "A composite risk rating for Zimbabwe CORS and GNSS users. It combines "
            "planetary Kp with ionospheric indicators (VTEC, S4 scintillation, ΔTEC) "
            "from the ZINGSA CORS ionosphere API. Use it to decide whether standard RTK, "
            "dual-frequency PPP, or post-processing is appropriate."
        ),
        "scale": [
            ("Low", "Nominal accuracy — routine CORS operations"),
            ("Moderate", "Minor degradation — verify RTK fixes"),
            ("High", "Significant errors — dual-frequency advised"),
            ("Critical", "Severe disturbance — positioning unreliable"),
        ],
        "source": "ZINGSA CORS /api/ionosphere/status + Kp thresholds",
    },
}


def _metric_card_specs(sw: Dict[str, Any]) -> list[Tuple[str, str, str, str, str, str]]:
    """Icon, label, value, note, value_color — matches Home.py hero cards."""
    risk_color = sw.get("gnss_risk_color", "#1D9E75")
    kp_color = sw.get("kp_color", HERO_CYAN)
    return [
        ("kp", "🧭", "Kp Index", str(sw["kp"]), "Planetary activity", HERO_CYAN),
        ("geomagnetic", "🌌", "Geomagnetic condition", str(sw["kp_condition"]), "Current state", kp_color),
        ("f107", "☀️", "Solar Flux", str(sw["f107"]), "Solar flux units", HERO_CYAN),
        ("gnss_risk", "🛰️", "GNSS Risk", str(sw["gnss_risk"]), "Navigation impact", risk_color),
    ]


def _hero_card_html(
    icon: str,
    label: str,
    value: str,
    note: str,
    value_color: str,
    *,
    selected: bool = False,
) -> str:
    selected_cls = " hero-click-selected" if selected else ""
    return (
        f"<div class='zgiis-card zgiis-card-accent hero-status-card hero-click-card{selected_cls}'>"
        f"<span class='hero-status-icon'>{icon}</span>"
        f"<div class='hero-status-label'>{label}</div>"
        f"<div class='hero-status-value' style='color:{value_color}'>{value}</div>"
        f"<div class='hero-status-note'>{note}</div>"
        f"</div>"
    )


def _current_value_line(metric_key: str, sw: Dict[str, Any]) -> str:
    if metric_key == "kp":
        return f"Current value: Kp = {sw['kp']}"
    if metric_key == "geomagnetic":
        return f"Current condition: {sw['kp_condition']} (Kp = {sw['kp']})"
    if metric_key == "f107":
        return f"Current flux: {sw['f107']} sfu"
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
        f"<p class='pipeline-explain-body' style='margin-top:0.75rem;font-size:0.76rem;color:#6888aa'>"
        f"Source: {info['source']}</p>"
        f"</div>",
        unsafe_allow_html=True,
    )


def render_sw_metric_cards(st, sw: Dict[str, Any], *, session_key: str = "sw_metric_sel") -> None:
    """Home hero cards (image 1) — click for explanation panel below."""
    st.markdown(
        "<div class='sw-metric-hint' style='font-size:0.72rem;color:#8899bb;"
        "margin:0 0 0.6rem'>Click a card for an explanation of what the value means.</div>"
        "<div class='hero-click-row'></div>",
        unsafe_allow_html=True,
    )

    if session_key not in st.session_state:
        st.session_state[session_key] = None

    specs = _metric_card_specs(sw)
    cols = st.columns(4)
    for col, (key, icon, label, value, note, value_color) in zip(cols, specs):
        active = st.session_state[session_key] == key
        with col:
            st.markdown(
                _hero_card_html(icon, label, value, note, value_color, selected=active),
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
