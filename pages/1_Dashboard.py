"""ZGIIS — Live TEC Dashboard with Zimbabwe CORS station map."""
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

from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
from zgiis.space_weather.fetch_indices import get_space_weather, get_warning_messages
from zgiis.theme import inject

st.set_page_config(page_title="ZGIIS — Live Dashboard", page_icon="📡", layout="wide")
inject(st)

with st.sidebar:
    st.markdown("### 📡 Dashboard Controls")
    show_offline = st.checkbox("Show offline stations", value=True)
    color_by = st.radio("Colour stations by", ["TEC value", "Status"], index=0)
    map_style = st.selectbox("Map style", ["open-street-map", "carto-darkmatter", "carto-positron"], index=1)
    st.divider()
    st.page_link("Home.py", label="← Back to Home")

st.markdown("<div class='zgiis-title' style='font-size:1.7rem'>📡 Live TEC Dashboard</div>", unsafe_allow_html=True)
st.caption("Zimbabwe CORS Network — real-time ionosphere monitoring")
st.markdown("---")

# ── Space weather strip ───────────────────────────────────────────────────────
sw = get_space_weather()
warnings = get_warning_messages(sw)
c1, c2, c3, c4 = st.columns(4)
c1.metric("Kp", sw["kp"])
c2.metric("Condition", sw["kp_condition"])
c3.metric("F10.7", f"{sw['f107']} sfu")
c4.metric("GNSS Risk", sw["gnss_risk"])
for msg in warnings:
    box_cls = "alert-box" if sw["gnss_risk"] in ("High", "Critical") else "warn-box" if sw["gnss_risk"] == "Moderate" else "ok-box"
    st.markdown(f"<div class='{box_cls}'>⚠️ {msg}</div>", unsafe_allow_html=True)

st.markdown("---")

# ── Build map data ────────────────────────────────────────────────────────────
stations = ZIMBABWE_CORS_STATIONS if show_offline else [s for s in ZIMBABWE_CORS_STATIONS if s.status != "offline"]

lats   = [s.lat          for s in stations]
lons   = [s.lon          for s in stations]
names  = [s.name         for s in stations]
codes  = [s.code.upper() for s in stations]
tecs   = [s.current_tec  for s in stations]
status = [s.status       for s in stations]
const  = [" · ".join(s.constellations) for s in stations]

status_color_map = {"online": "#00ff88", "degraded": "#ff8c00", "offline": "#ff4444"}

if color_by == "TEC value":
    marker_colors = [t if t > 0 else 0 for t in tecs]
    colorscale = [[0, "#000080"], [0.3, "#0080ff"], [0.6, "#00ff80"], [0.85, "#ff8000"], [1, "#ff0000"]]
    marker = dict(
        size=18,
        color=marker_colors,
        colorscale=colorscale,
        cmin=10, cmax=40,
        colorbar=dict(title="VTEC (TECU)", thickness=14),
    )
else:
    marker = dict(
        size=18,
        color=[status_color_map.get(s, "#888") for s in status],
    )

hover = [
    f"<b>{n}</b> ({c})<br>"
    f"Status: {st_}<br>"
    f"VTEC: {t:.1f} TECU<br>"
    f"Lat: {la:.4f}° Lon: {lo:.4f}°<br>"
    f"Constellations: {cn}"
    for n, c, st_, t, la, lo, cn in zip(names, codes, status, tecs, lats, lons, const)
]

fig_map = go.Figure(go.Scattermapbox(
    lat=lats, lon=lons,
    mode="markers+text",
    marker=marker,
    text=codes,
    textposition="top center",
    textfont=dict(size=10, color="#e0f0ff"),
    hovertemplate="%{customdata}<extra></extra>",
    customdata=hover,
    name="CORS Stations",
))
fig_map.update_layout(
    mapbox=dict(
        style=map_style,
        center=dict(lat=-19.0, lon=29.8),
        zoom=5.8,
    ),
    margin=dict(l=0, r=0, t=0, b=0),
    height=520,
    paper_bgcolor="#060d1a",
    plot_bgcolor="#060d1a",
)
st.plotly_chart(fig_map, use_container_width=True)

# ── Station cards grid ────────────────────────────────────────────────────────
st.subheader("Station Status")
cols = st.columns(4)
for idx, station in enumerate(stations):
    with cols[idx % 4]:
        tec_str = f"{station.current_tec:.1f} TECU" if station.current_tec > 0 else "—"
        last = station.last_file or "No file yet"
        st.markdown(
            f"<div class='zgiis-card'>"
            f"<div style='display:flex;justify-content:space-between;align-items:center'>"
            f"  <b style='color:#c8e0ff'>{station.name}</b>"
            f"  <span class='badge badge-{station.status}'>{station.status.upper()}</span>"
            f"</div>"
            f"<div style='font-size:0.73rem;color:#446688'>{station.code.upper()} · {station.lat:.4f}° N, {station.lon:.4f}° E</div>"
            f"<div class='big-metric' style='font-size:1.5rem;margin:4px 0'>{tec_str}</div>"
            f"<div style='font-size:0.71rem;color:#557799'>{'  '.join(station.constellations)}</div>"
            f"<div style='font-size:0.7rem;color:#334455;margin-top:4px'>Last: {last}</div>"
            f"</div>",
            unsafe_allow_html=True,
        )

# ── TEC bar chart across stations ─────────────────────────────────────────────
st.markdown("---")
st.subheader("Current VTEC Across Network")
valid = [(s.name, s.current_tec) for s in stations if s.current_tec > 0]
if valid:
    vnames, vtec_vals = zip(*valid)
    colors = ["#00ff88" if v < 25 else "#ff8c00" if v < 35 else "#ff4444" for v in vtec_vals]
    fig_bar = go.Figure(go.Bar(
        x=list(vnames), y=list(vtec_vals),
        marker_color=colors,
        text=[f"{v:.1f}" for v in vtec_vals],
        textposition="outside",
        hovertemplate="%{x}: %{y:.1f} TECU<extra></extra>",
    ))
    fig_bar.update_layout(
        paper_bgcolor="#060d1a",
        plot_bgcolor="#0d1b2a",
        font_color="#b0c8e8",
        yaxis=dict(title="VTEC (TECU)", gridcolor="#1e3a5f"),
        xaxis=dict(gridcolor="#1e3a5f"),
        showlegend=False,
        height=280,
        margin=dict(t=20, b=10),
    )
    st.plotly_chart(fig_bar, use_container_width=True)
else:
    st.info("No live TEC values — process RINEX/CMN files first to populate station readings.")

# ── Constellation coverage summary ───────────────────────────────────────────
st.markdown("---")
st.subheader("Constellation Coverage")
const_map = {"GPS": 0, "GLONASS": 0, "Galileo": 0, "BeiDou": 0}
for s in ZIMBABWE_CORS_STATIONS:
    for c in s.constellations:
        if c in const_map:
            const_map[c] += 1

fig_pie = go.Figure(go.Pie(
    labels=list(const_map.keys()),
    values=list(const_map.values()),
    hole=0.5,
    marker=dict(colors=["#00d4ff", "#ff8c00", "#00ff88", "#cc44ff"]),
    textfont=dict(color="#e0f0ff"),
))
fig_pie.update_layout(
    paper_bgcolor="#060d1a",
    plot_bgcolor="#060d1a",
    font_color="#b0c8e8",
    legend=dict(bgcolor="#0d1b2a", bordercolor="#1e3a5f"),
    height=300,
    margin=dict(t=10, b=10),
    annotations=[dict(text="GNSS\nConst.", x=0.5, y=0.5, font_size=13, showarrow=False, font_color="#88aabb")],
)
st.plotly_chart(fig_pie, use_container_width=True)
