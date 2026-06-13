"""ZGIIS — Space Weather Monitoring Panel."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

root = Path(__file__).resolve().parents[1]
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from zgiis.space_weather.fetch_indices import get_space_weather, get_warning_messages, _classify_kp, _risk_color
from zgiis.theme import inject

st.set_page_config(page_title="ZGIIS — Space Weather", page_icon="☀️", layout="wide")
inject(st)

with st.sidebar:
    st.markdown("### ☀️ Space Weather")
    auto_refresh = st.checkbox("Auto-refresh (15 min cache)", value=True)
    if st.button("🔄 Refresh Now"):
        from zgiis.space_weather import fetch_indices as _fi
        _fi._CACHE.clear()
    st.divider()

    st.markdown("**Kp Scale Reference**")
    kp_table = [
        ("0–2", "Quiet",          "#00ff88"),
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
            f"<span style='font-size:0.78rem;color:#8899bb'>{label}</span></div>",
            unsafe_allow_html=True,
        )
    st.divider()
    st.page_link("Home.py", label="← Back to Home")

st.markdown("<div class='zgiis-title' style='font-size:1.7rem'>☀️ Space Weather Monitoring</div>", unsafe_allow_html=True)
st.caption("Real-time solar and geomagnetic indices — NOAA SWPC data feed")
st.markdown("---")

sw = get_space_weather()
warnings = get_warning_messages(sw)

# ── Primary metrics ───────────────────────────────────────────────────────────
c1, c2, c3, c4 = st.columns(4)
with c1:
    st.markdown(
        f"<div class='zgiis-card zgiis-card-accent'>"
        f"<div class='metric-label'>Kp Index</div>"
        f"<div class='big-metric'>{sw['kp']}</div>"
        f"<div style='font-size:0.8rem;color:#6888aa'>Planetary geomagnetic</div>"
        f"</div>",
        unsafe_allow_html=True,
    )
with c2:
    risk_color = sw["gnss_risk_color"]
    st.markdown(
        f"<div class='zgiis-card' style='border-left:3px solid {risk_color}'>"
        f"<div class='metric-label'>Geomagnetic Condition</div>"
        f"<div style='font-size:1.5rem;font-weight:700;color:{risk_color}'>{sw['kp_condition']}</div>"
        f"</div>",
        unsafe_allow_html=True,
    )
with c3:
    st.markdown(
        f"<div class='zgiis-card zgiis-card-warn'>"
        f"<div class='metric-label'>F10.7 Solar Flux</div>"
        f"<div class='big-metric'>{sw['f107']}</div>"
        f"<div style='font-size:0.8rem;color:#6888aa'>sfu (solar flux units)</div>"
        f"</div>",
        unsafe_allow_html=True,
    )
with c4:
    st.markdown(
        f"<div class='zgiis-card' style='border-left:3px solid {risk_color}'>"
        f"<div class='metric-label'>GNSS Risk Level</div>"
        f"<div style='font-size:1.5rem;font-weight:700;color:{risk_color}'>{sw['gnss_risk']}</div>"
        f"<div style='font-size:0.78rem;color:#6888aa'>Based on Kp + ionospheric model</div>"
        f"</div>",
        unsafe_allow_html=True,
    )

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
        title={"text": "Kp Index", "font": {"color": "#b0c8e8", "size": 14}},
        number={"font": {"color": "#00d4ff", "size": 42}},
        gauge=dict(
            axis=dict(range=[0, 9], tickwidth=1, tickcolor="#6888aa",
                      tickfont=dict(color="#6888aa")),
            bar=dict(color=_risk_color(_classify_kp(kp_val)[1]), thickness=0.25),
            bgcolor="#0d1b2a",
            borderwidth=1, bordercolor="#1e3a5f",
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
        paper_bgcolor="#060d1a", font_color="#b0c8e8",
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
            f"background:#0d1b2a;border-radius:6px;border-left:2px solid {color}'>"
            f"<span>{icon}</span>"
            f"<div><div style='color:#c8e0ff;font-size:0.88rem'>{service}</div>"
            f"<div style='color:#5588aa;font-size:0.75rem'>{note}</div>"
            f"</div></div>",
            unsafe_allow_html=True,
        )

# ── Simulated Kp history ──────────────────────────────────────────────────────
st.markdown("---")
st.subheader("Simulated Kp Timeline (Last 72 Hours)")
rng = np.random.default_rng(12)
hours = np.arange(-72, 1, 3)
kp_history = np.clip(rng.normal(sw["kp"], 1.0, size=len(hours)), 0, 9)
fig_kp = go.Figure()
fig_kp.add_hrect(y0=0, y1=3, fillcolor="#001a08", opacity=0.5, line_width=0)
fig_kp.add_hrect(y0=3, y1=5, fillcolor="#1a1500", opacity=0.5, line_width=0)
fig_kp.add_hrect(y0=5, y1=9, fillcolor="#1a0500", opacity=0.5, line_width=0)
fig_kp.add_scatter(
    x=hours, y=kp_history, mode="lines+markers",
    line=dict(color="#00d4ff", width=2),
    marker=dict(size=6, color=kp_history,
                colorscale=[[0,"#00ff88"],[0.5,"#ff8c00"],[1,"#ff4444"]],
                cmin=0, cmax=9),
    name="Kp",
    hovertemplate="T=%{x}h, Kp=%{y:.1f}<extra></extra>",
)
fig_kp.add_hline(y=5, line_dash="dash", line_color="#ff8c00",
                 annotation_text="Storm threshold (5)", annotation_font_color="#ff8c00")
fig_kp.update_layout(
    paper_bgcolor="#060d1a", plot_bgcolor="#0d1b2a",
    font_color="#b0c8e8",
    yaxis=dict(title="Kp Index", range=[0, 9], gridcolor="#1e3a5f"),
    xaxis=dict(title="Hours from now", gridcolor="#1e3a5f"),
    height=280, margin=dict(t=20, b=10),
    showlegend=False,
)
st.plotly_chart(fig_kp, use_container_width=True)
st.caption("⚠️ Timeline is illustrative — connect a live NOAA API source for real 3-hour Kp values.")

# ── F10.7 context ─────────────────────────────────────────────────────────────
st.markdown("---")
st.subheader("Solar Flux (F10.7) Interpretation")
f107 = sw["f107"]
solar_cycle = "Solar Maximum" if f107 > 180 else "High Activity" if f107 > 150 else "Moderate Activity" if f107 > 120 else "Low Activity"
st.markdown(
    f"<div class='zgiis-card zgiis-card-warn'>"
    f"<div style='font-weight:700;color:#ff8c00'>F10.7 = {f107} sfu — {solar_cycle}</div>"
    f"<div style='font-size:0.85rem;color:#8899bb;margin-top:6px'>"
    f"F10.7 < 100 sfu: Solar minimum · TEC typically low<br>"
    f"F10.7 100–150 sfu: Moderate solar activity · TEC moderate (15–25 TECU over Zimbabwe)<br>"
    f"F10.7 > 150 sfu: High solar activity · TEC elevated, scintillation risk increases<br>"
    f"F10.7 > 200 sfu: Solar maximum · peak TEC, enhanced equatorial anomaly</div>"
    f"</div>",
    unsafe_allow_html=True,
)

st.caption(f"Source: {sw.get('source', 'N/A')} · Timestamp: {sw.get('timestamp', 'N/A')}")
