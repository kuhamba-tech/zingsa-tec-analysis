"""ZGIIS — Space Weather Monitoring Panel."""
from __future__ import annotations

import sys
from pathlib import Path

import plotly.graph_objects as go
import streamlit as st

root = Path(__file__).resolve().parents[1]
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from zgiis.space_weather.fetch_indices import (
    get_space_weather,
    get_warning_messages,
    _classify_kp,
    _risk_color,
)
from zgiis.space_weather.metric_explainer import render_sw_metric_cards
from zgiis.space_weather.solar_activity import get_solar_activity
from zgiis.space_weather.solar_monitor import render_solar_monitor
from zgiis.theme import inject

st.set_page_config(page_title="ZGIIS — Space Weather", page_icon="☀️", layout="wide")
inject(st, page_id="space_weather")

with st.sidebar:
    st.markdown("### ☀️ Space Weather")
    auto_refresh = st.checkbox("Auto-refresh (15 min cache)", value=True)
    if st.button("🔄 Refresh Now"):
        from zgiis.space_weather import fetch_indices as _fi
        from zgiis.space_weather import solar_activity as _sa
        _fi._CACHE.clear()
        _sa._CACHE.clear()
    st.divider()

    st.markdown("**Kp Scale Reference**")
    kp_table = [
        ("0-2", "Quiet",          "#00ff88"),
        ("3",   "Unsettled",      "#88ff44"),
        ("4",   "Active",         "#ffff00"),
        ("5",   "Minor Storm G1", "#ff8c00"),
        ("6",   "Moderate G2",    "#ff6600"),
        ("7",   "Strong G3",      "#ff2200"),
        ("8",   "Severe G4",      "#cc0044"),
        ("9",   "Extreme G5",     "#880088"),
    ]
    for kp_range, label, color in kp_table:
        st.markdown(
            f"<div style='display:flex;gap:8px;align-items:center;margin:2px 0'>"
            f"<span style='width:32px;text-align:right;color:{color};font-weight:700'>{kp_range}</span>"
            f"<span style='font-size:0.78rem;color:#ffffff'>{label}</span></div>",
            unsafe_allow_html=True,
        )
    st.divider()
    st.page_link("Home.py", label="← Back to Home")

st.markdown("<div class='zgiis-title' style='font-size:1.7rem'>☀️ Space Weather Monitoring</div>", unsafe_allow_html=True)
st.caption("Real-time solar and geomagnetic indices — NOAA SWPC data feed")
st.markdown("---")

sw = get_space_weather()
warnings = get_warning_messages(sw)

# ── Primary metrics (click for explanation) ───────────────────────────────────
render_sw_metric_cards(st, sw)

# ── Solar Activity Monitor (NOAA SWPC + NASA DONKI + ZINGSA CORS API) ─────────
solar = get_solar_activity()
render_solar_monitor(st, solar, kp=float(sw["kp"]), sw=sw)

# ── Warning messages ──────────────────────────────────────────────────────────
st.markdown("---")
st.subheader("Active Alerts")
for msg in warnings:
    risk = sw["gnss_risk"]
    cls = "alert-box" if risk in ("High", "Critical") else "warn-box" if risk == "Moderate" else "ok-box"
    icon = "🔴" if risk in ("High", "Critical") else "🟡" if risk == "Moderate" else "🟢"
    st.markdown(f"<div class='{cls}'>{icon} {msg}</div>", unsafe_allow_html=True)

# ── Kp gauge ─────────────────────────────────────────────────────────────────
st.markdown("---")
col_gauge, col_info = st.columns([1, 2])

with col_gauge:
    kp_val = float(sw["kp"])
    fig_gauge = go.Figure(go.Indicator(
        mode="gauge+number",
        value=kp_val,
        domain={"x": [0, 1], "y": [0, 1]},
        title={"text": "Kp Index", "font": {"color": "#ffffff", "size": 14}},
        number={"font": {"color": "#168bd2", "size": 42}},
        gauge=dict(
            axis=dict(range=[0, 9], tickwidth=1, tickcolor="#ffffff",
                      tickfont=dict(color="#ffffff")),
            bar=dict(color=_risk_color(_classify_kp(kp_val)[1]), thickness=0.25),
            bgcolor="#000000",
            borderwidth=1, bordercolor="#244d73",
            steps=[
                dict(range=[0,3], color="#001a08"),
                dict(range=[3,5], color="#1a1a00"),
                dict(range=[5,7], color="#1a0800"),
                dict(range=[7,9], color="#1a0010"),
            ],
            threshold=dict(line=dict(color="#ff4444", width=3), thickness=0.8, value=5),
        ),
    ))
    fig_gauge.update_layout(
        paper_bgcolor="#000000", font_color="#ffffff",
        height=280, margin=dict(l=20, r=20, t=30, b=10),
    )
    st.plotly_chart(fig_gauge, use_container_width=True)

with col_info:
    st.markdown("### GNSS Impact Assessment")
    impact_table = [
        ("Single-frequency positioning", kp_val < 5, "±2–5 m error during storms"),
        ("Dual-frequency (PPP)",         kp_val < 7, "±10–30 cm error during strong storms"),
        ("RTK fixed solution",           kp_val < 6, "Possible cycle slip, loss of fix"),
        ("Aviation SBAS",                kp_val < 5, "Integrity alarm threshold may be exceeded"),
        ("Long-baseline RTK (>50 km)",   kp_val < 4, "Ambiguity resolution failure"),
        ("Satellite navigation (SPS)",   kp_val < 7, "±25 m error in extreme storms"),
    ]
    for service, ok, note in impact_table:
        icon = "✅" if ok else "❌"
        color = "#00ff88" if ok else "#ff4444"
        st.markdown(
            f"<div style='display:flex;gap:10px;align-items:flex-start;margin:6px 0;padding:6px;"
            f"background:#000000;border-radius:6px;border-left:2px solid {color}'>"
            f"<span>{icon}</span>"
            f"<div><div style='color:#ffffff;font-size:0.88rem'>{service}</div>"
            f"<div style='color:#ffffff;font-size:0.75rem'>{note}</div>"
            f"</div></div>",
            unsafe_allow_html=True,
        )

# ── F10.7 context ─────────────────────────────────────────────────────────────
st.markdown("---")
st.subheader("Solar Flux (F10.7) Interpretation")
f107 = sw["f107"]
solar_cycle = "Solar Maximum" if f107 > 180 else "High Activity" if f107 > 150 else "Moderate Activity" if f107 > 120 else "Low Activity"
st.markdown(
    f"<div class='zgiis-card zgiis-card-warn'>"
    f"<div style='font-weight:700;color:#ff8c00'>F10.7 = {f107} sfu — {solar_cycle}</div>"
    f"<div style='font-size:0.85rem;color:#ffffff;margin-top:6px'>"
    f"F10.7 < 100 sfu: Solar minimum · TEC typically low<br>"
    f"F10.7 100–150 sfu: Moderate solar activity · TEC moderate (15–25 TECU over Zimbabwe)<br>"
    f"F10.7 > 150 sfu: High solar activity · TEC elevated, scintillation risk increases<br>"
    f"F10.7 > 200 sfu: Solar maximum · peak TEC, enhanced equatorial anomaly</div>"
    f"</div>",
    unsafe_allow_html=True,
)

st.caption(f"Source: {sw.get('source', 'N/A')} · Timestamp: {sw.get('timestamp', 'N/A')}")
