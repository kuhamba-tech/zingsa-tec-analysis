"""ZGIIS — Zimbabwe GNSS Ionosphere Intelligence System — Home / Landing Page."""
from __future__ import annotations

import sys
from pathlib import Path

import plotly.graph_objects as go
import streamlit as st

root = Path(__file__).resolve().parent
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

logo_path = root / "static" / "zingsa_logo.png"

from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
from zgiis.maps.station_map import MAP_STYLE_KEYS, MAP_STYLE_OPTIONS, render_cors_station_map
from zgiis.space_weather.fetch_indices import get_space_weather, get_warning_messages
from zgiis.space_weather.kp_scale import build_synchronized_kp_scales_html
from zgiis.theme import inject

st.set_page_config(
    page_title="GNSS Based TEC Analysis Using Zimbabwe CORS Network",
    page_icon="🛰️",
    layout="wide",
    initial_sidebar_state="expanded",
)
inject(st)

# ── Sidebar ──────────────────────────────────────────────────────────────────
with st.sidebar:
    if logo_path.exists():
        _, logo_col, _ = st.columns([1, 5, 1])
        with logo_col:
            st.image(str(logo_path), width="stretch")
    st.markdown(
        "<div style='text-align:center;color:#00d4ff;font-weight:900;"
        "font-size:1.05rem;letter-spacing:0.05em;line-height:1.35;"
        "padding:0 0.25rem 0.5rem'>ZINGSA SPACE SCIENCE DEPARTMENT</div>",
        unsafe_allow_html=True,
    )
    st.divider()
    st.markdown("**Navigation**")
    st.page_link("Home.py",                      label="🏠 Home",                 )
    st.page_link("pages/2_Processing.py",        label="⚙️ RINEX/CMN Processing", )
    st.page_link("pages/3_Time_Series.py",       label="📈 TEC Time Series",      )
    st.page_link("pages/4_PRN_Explorer.py",      label="🛸 PRN Explorer",         )
    st.page_link("pages/5_TEC_Heatmap.py",       label="🗺️ TEC Heat Map",        )
    st.page_link("pages/6_Space_Weather.py",     label="☀️ Space Weather",       )
    st.page_link("pages/7_TEC_Anomaly_Detection.py", label="🔬 TEC Anomaly Detection", )
    st.page_link("pages/8_AI_Assistant.py",      label="🤖 AI Assistant",         )
    st.divider()
    st.caption("v1.0.0 · ZINGSA © 2026")

# ── Space weather data ────────────────────────────────────────────────────────
sw = get_space_weather()
warnings = get_warning_messages(sw)
risk_color = sw.get("gnss_risk_color", "#1D9E75")
online = sw.get("stations_online")
total = sw.get("stations_total") or len(ZIMBABWE_CORS_STATIONS)
if online is None:
    online = sum(1 for s in ZIMBABWE_CORS_STATIONS if s.status == "online")
stations_label = f"{online}/{total}"

# ── Hero header with integrated space-weather metrics ─────────────────────────
title_col, logo_col = st.columns([5.2, 0.8], vertical_alignment="top")

with title_col:
    st.markdown(
        "<div class='zgiis-title'>🛰️ GNSS Based TEC Analysis Using Zimbabwe CORS Network</div>"
        "<div class='zgiis-tagline'>Dual-frequency GPS/GNSS Total Electron Content (TEC) computation from Zimbabwe CORS RINEX observations</div>",
        unsafe_allow_html=True,
    )

with logo_col:
    if logo_path.exists():
        st.markdown("<div class='hero-logo-wrap'>", unsafe_allow_html=True)
        st.image(str(logo_path), width="stretch")
        st.markdown("</div>", unsafe_allow_html=True)
    else:
        st.markdown(
            "<div class='hero-logo-wrap' style='text-align:center;color:#446688;font-size:0.7rem'>"
            "Place <code>zingsa_logo.png</code> in <code>static/</code></div>",
            unsafe_allow_html=True,
        )

metric_cards = [
    ("🧭", "Kp Index", sw["kp"], "Planetary activity", "#00d4ff"),
    ("🌌", "Geomagnetic condition", sw["kp_condition"], "Current state", sw.get("kp_color", "#00ff88")),
    ("☀️", "Solar Flux", sw["f107"], "Solar flux units", "#00d4ff"),
    ("🛰️", "GNSS Risk", sw["gnss_risk"], "Navigation impact", risk_color),
    ("📡", "Stations Online", stations_label, "Zimbabwe CORS", "#00d4ff"),
]
metrics_html = "".join(
    "<div class='zgiis-card zgiis-card-accent hero-status-card'>"
    f"<span class='hero-status-icon'>{icon}</span>"
    f"<div class='hero-status-label'>{label}</div>"
    f"<div class='hero-status-value' style='color:{value_color}'>{value}</div>"
    f"<div class='hero-status-note'>{note}</div>"
    "</div>"
    for icon, label, value, note, value_color in metric_cards
)

st.markdown(
    "<div class='hero-dashboard-panel'>"
    "<div class='hero-panel-eyebrow'>Live space weather · Zimbabwe CORS network</div>"
    f"<div class='hero-metrics-grid'>{metrics_html}</div>"
    f"{build_synchronized_kp_scales_html(sw['kp'])}"
    "</div>",
    unsafe_allow_html=True,
)

# ── Warning messages ──────────────────────────────────────────────────────────
for msg in warnings:
    box_cls = "alert-box" if sw["gnss_risk"] in ("High", "Critical") else ("warn-box" if sw["gnss_risk"] == "Moderate" else "ok-box")
    st.markdown(f"<div class='{box_cls}'>ℹ️ {msg}</div>", unsafe_allow_html=True)

# ── CORS network map ──────────────────────────────────────────────────────────
map_hdr, map_style_col, map_risk = st.columns([3, 4, 1])
with map_hdr:
    st.subheader("Zimbabwe CORS Network")
    st.caption(
        f"Zimbabwe CORS network · {total} stations · "
        f"{online} online · {sw['gnss_risk']} risk"
    )
with map_style_col:
    st.markdown(
        "<div style='font-size:0.62rem;color:#94a3b8;text-transform:uppercase;"
        "letter-spacing:0.06em;margin-top:0.5rem'>Map Layer</div>",
        unsafe_allow_html=True,
    )
    selected_layer = st.segmented_control(
        "Map layer",
        MAP_STYLE_OPTIONS,
        default="Hybrid",
        selection_mode="single",
        label_visibility="collapsed",
        key="home_cors_map_style",
    )
    if selected_layer is None:
        selected_layer = "Hybrid"
    home_map_style = MAP_STYLE_KEYS[MAP_STYLE_OPTIONS.index(selected_layer)]
with map_risk:
    st.markdown(
        f"<div style='text-align:right;margin-top:0.4rem'>"
        f"<div style='font-size:0.62rem;color:#94a3b8;text-transform:uppercase;"
        f"letter-spacing:0.06em'>Risk Level</div>"
        f"<div style='font-size:1rem;font-weight:800;color:{risk_color}'>{sw['gnss_risk'].upper()}</div>"
        f"</div>",
        unsafe_allow_html=True,
    )

render_cors_station_map(
    st,
    color_by="status",
    map_style=home_map_style,
    height=400,
    show_tec_legend=home_map_style == "tec_heatmap",
)
if home_map_style == "tec_heatmap":
    st.markdown(
        "<div style='display:flex;flex-wrap:wrap;align-items:center;gap:18px;"
        "margin-top:0.4rem;margin-bottom:0.5rem;padding:0.75rem 1rem;"
        "background:#0d1b2a;border:1px solid #1e3a5f;border-left:4px solid #00d4ff;"
        "border-radius:10px'>"
        # gradient bar
        "<div style='display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0'>"
        "<span style='font-size:0.62rem;color:#94a3b8;font-weight:700;text-transform:uppercase;"
        "letter-spacing:0.05em'>Low TEC</span>"
        "<div style='width:160px;height:14px;border-radius:6px;border:1px solid #334155;"
        "background:linear-gradient(to right,#000080,#0080ff,#00ff80,#ffcc00,#ff0000)'></div>"
        "<span style='font-size:0.62rem;color:#94a3b8;font-weight:700;text-transform:uppercase;"
        "letter-spacing:0.05em'>High TEC</span>"
        "</div>"
        # explanation text
        "<div style='font-size:0.80rem;color:#cbd5e1;line-height:1.55;flex:1'>"
        "<b style='color:#ffffff'>TEC Heat Map</b> &mdash; "
        "Colour represents Vertical Total Electron Content (VTEC) interpolated across Zimbabwe. "
        "<span style='color:#5599ff'>Blue</span> = low ionospheric electron content; "
        "<span style='color:#00ff88'>green</span> = moderate; "
        "<span style='color:#ff4400'>red</span> = high TEC. "
        "Station dots show measured (bright) and spatially estimated (dim) VTEC values. "
        "Click any dot for details."
        "</div>"
        "</div>",
        unsafe_allow_html=True,
    )
else:
    st.markdown(
        "<div style='display:flex;flex-wrap:wrap;gap:14px;margin-top:-0.4rem;margin-bottom:0.6rem'>"
        "<span style='font-size:0.72rem;color:#94a3b8;font-weight:700;text-transform:uppercase;"
        "letter-spacing:0.05em'>Station Status</span>"
        "<span style='font-size:0.72rem;color:#cbd5e1'><span style='color:#1D9E75'>●</span> ONLINE</span>"
        "<span style='font-size:0.72rem;color:#cbd5e1'><span style='color:#EF9F27'>●</span> DEGRADED</span>"
        "<span style='font-size:0.72rem;color:#cbd5e1'><span style='color:#ff4444'>●</span> OFFLINE</span>"
        "</div>",
        unsafe_allow_html=True,
    )
st.markdown("---")

# ── Module cards ─────────────────────────────────────────────────────────────
st.subheader("Platform Modules")

col1, col2, col3, col4 = st.columns(4)

def nav_card(col, icon, title, desc, page, accent="zgiis-card-accent"):
    with col:
        st.markdown(
            f"<div class='zgiis-card {accent}'>"
            f"<span style='font-size:1.7rem'>{icon}</span>"
            f"<div style='font-weight:700;color:#e0f0ff;margin:0.3rem 0 0.1rem'>{title}</div>"
            f"<div style='font-size:0.8rem;color:#6888aa'>{desc}</div>"
            f"</div>",
            unsafe_allow_html=True,
        )
        st.page_link(page, label=f"Open {title}")

nav_card(col1, "⚙️", "RINEX Processing",  "CMN/RINEX loader · elevation filter",        "pages/2_Processing.py")
nav_card(col2, "📈", "TEC Time Series",   "Daily · monthly · yearly trends",            "pages/3_Time_Series.py")
nav_card(col3, "🛸", "PRN Explorer",      "GPS/Galileo/BeiDou/GLONASS analysis",       "pages/4_PRN_Explorer.py")
nav_card(col4, "🗺️", "TEC Heat Map",      "Interpolated TEC grid over Zimbabwe",        "pages/5_TEC_Heatmap.py",   "zgiis-card-ok")

col5, col6, col7 = st.columns(3)
nav_card(col5, "☀️", "Space Weather",     "Kp · F10.7 · storm alerts",                 "pages/6_Space_Weather.py", "zgiis-card-warn")
nav_card(col6, "🔬", "TEC Anomaly Detection", "Anomaly · seasonal · solar cycle tools", "pages/7_TEC_Anomaly_Detection.py", "zgiis-card-accent")
nav_card(col7, "🤖", "AI Assistant",      "Ask TEC AI — ionosphere Q&A",               "pages/8_AI_Assistant.py",  "zgiis-card-ok")

st.markdown("---")

# ── Constellation coverage ────────────────────────────────────────────────────
st.subheader("Constellation Coverage")
constellation_counts = {"GPS": 0, "GLONASS": 0, "Galileo": 0, "BeiDou": 0}
for station in ZIMBABWE_CORS_STATIONS:
    for constellation in station.constellations:
        if constellation in constellation_counts:
            constellation_counts[constellation] += 1

constellation_chart = go.Figure(
    go.Pie(
        labels=list(constellation_counts.keys()),
        values=list(constellation_counts.values()),
        hole=0.52,
        domain=dict(x=[0.12, 0.68], y=[0.08, 0.92]),
        marker=dict(
            colors=["#0077aa", "#ff8c00", "#00cc66", "#aa33dd"],
            line=dict(color="#060d1a", width=2),
        ),
        textinfo="percent",
        texttemplate="%{percent:.1%}",
        textposition="inside",
        insidetextorientation="horizontal",
        textfont=dict(color="#ffffff", size=16, family="Arial Black"),
        hovertemplate="<b>%{label}</b><br>%{value} stations<br>%{percent:.1%}<extra></extra>",
    )
)
constellation_chart.update_layout(
    paper_bgcolor="#060d1a",
    plot_bgcolor="#060d1a",
    font=dict(color="#ffffff", size=14),
    uniformtext=dict(minsize=16, mode="show"),
    legend=dict(
        bgcolor="#0d1b2a",
        bordercolor="#1e3a5f",
        borderwidth=1,
        font=dict(color="#ffffff", size=14),
        x=0.74,
        y=0.78,
    ),
    height=360,
    margin=dict(t=5, b=10, l=10, r=10),
    annotations=[
        dict(
            text="Constellations",
            x=0.4,
            y=0.5,
            font_size=14,
            showarrow=False,
            font_color="#ffffff",
        )
    ],
)
chart_left, chart_center, chart_right = st.columns([1, 3, 1])
with chart_center:
    st.plotly_chart(constellation_chart, width="stretch")

st.markdown("---")

st.caption(
    f"Data source: {sw.get('source','N/A')} · Last updated: {sw.get('timestamp','N/A')} · "
    "ZGIIS v1.0 · Zimbabwe National Geospatial and Space Agency (ZINGSA)"
)
