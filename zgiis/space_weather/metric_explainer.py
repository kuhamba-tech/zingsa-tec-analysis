"""Clickable Space Weather metric cards with value explanations."""
from __future__ import annotations

from typing import Any, Dict, Optional

import streamlit as st

METRIC_CSS = """
<style>
.sw-metric-hint {
    font-size: 0.72rem;
    color: #8899bb;
    margin: 0 0 0.45rem;
}
div[data-testid="column"] .sw-metric-active button[kind="secondary"] {
    border-color: #00d4ff !important;
    box-shadow: 0 0 0 1px rgba(0, 212, 255, 0.35);
    background: rgba(0, 212, 255, 0.08) !important;
}
.sw-explain-panel {
    background: linear-gradient(135deg, rgba(13, 27, 42, 0.95), rgba(6, 13, 26, 0.98));
    border: 1px solid rgba(0, 212, 255, 0.28);
    border-radius: 12px;
    padding: 1.1rem 1.3rem;
    margin: 0.6rem 0 1rem;
}
.sw-explain-title {
    font-size: 1.05rem;
    font-weight: 800;
    color: #ffffff;
    margin-bottom: 0.35rem;
}
.sw-explain-value {
    font-size: 0.82rem;
    color: #00d4ff;
    font-weight: 700;
    margin-bottom: 0.65rem;
}
.sw-explain-body {
    font-size: 0.88rem;
    color: #c8dcf0;
    line-height: 1.55;
    margin: 0 0 0.75rem;
}
.sw-explain-scale {
    display: grid;
    gap: 0.35rem;
    margin-top: 0.5rem;
}
.sw-explain-scale span {
    font-size: 0.78rem;
    color: #8899bb;
}
.sw-explain-scale strong { color: #e2e8f0; }
</style>
"""

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


def _metric_button_label(metric_key: str, sw: Dict[str, Any]) -> str:
    if metric_key == "kp":
        return f"Kp Index\n{sw['kp']}\nPlanetary geomagnetic"
    if metric_key == "geomagnetic":
        return f"Geomagnetic Condition\n{sw['kp_condition']}"
    if metric_key == "f107":
        return f"F10.7 Solar Flux\n{sw['f107']}\nsfu (solar flux units)"
    return f"GNSS Risk Level\n{sw['gnss_risk']}\nBased on Kp + ionospheric model"


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
        f"<div class='sw-explain-panel'>"
        f"<div class='sw-explain-title'>{info['title']}</div>"
        f"<div class='sw-explain-value'>{_current_value_line(metric_key, sw)}</div>"
        f"<p class='sw-explain-body'>{info['summary']}</p>"
        f"<div class='sw-explain-scale'>{scale_html}</div>"
        f"<p class='sw-explain-body' style='margin-top:0.75rem;font-size:0.76rem;color:#6888aa'>"
        f"Source: {info['source']}</p>"
        f"</div>",
        unsafe_allow_html=True,
    )


def render_sw_metric_cards(st, sw: Dict[str, Any], *, session_key: str = "sw_metric_sel") -> None:
    """Render four clickable metric cards; show explanation for the selected card."""
    st.markdown(METRIC_CSS, unsafe_allow_html=True)
    st.markdown(
        "<div class='sw-metric-hint'>Click a card below for an explanation of what the value means.</div>",
        unsafe_allow_html=True,
    )

    if session_key not in st.session_state:
        st.session_state[session_key] = None

    cols = st.columns(4)
    labels = {
        "kp": "Kp Index",
        "geomagnetic": "Geomagnetic",
        "f107": "F10.7",
        "gnss_risk": "GNSS Risk",
    }
    for col, key in zip(cols, METRIC_KEYS):
        with col:
            active = st.session_state[session_key] == key
            if active:
                st.markdown('<div class="sw-metric-active">', unsafe_allow_html=True)
            if st.button(
                _metric_button_label(key, sw),
                key=f"sw_metric_btn_{key}",
                use_container_width=True,
                type="secondary",
            ):
                st.session_state[session_key] = (
                    None if st.session_state[session_key] == key else key
                )
                st.rerun()
            if active:
                st.markdown("</div>", unsafe_allow_html=True)

    selected: Optional[str] = st.session_state.get(session_key)
    if selected:
        _render_explanation(selected, sw)
