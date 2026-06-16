"""ZGIIS — Zimbabwe GNSS Ionosphere Intelligence System — Home / Landing Page."""
from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

root = Path(__file__).resolve().parent
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

optimized_logo_path = root / "static" / "zingsa_logo_optimized.webp"
logo_path = (
    optimized_logo_path
    if optimized_logo_path.exists()
    else root / "static" / "zingsa_logo.png"
)

from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS, stations_for_map
from zgiis.device import is_mobile_request
from zgiis.maps.station_map import (
    MAP_STYLE_KEYS,
    MAP_STYLE_OPTIONS,
    map_style_from_label,
    render_cors_station_map,
)
from zgiis.space_weather.fetch_indices import get_space_weather
from zgiis.space_weather import metric_explainer
from zgiis.theme import inject

mobile_request = is_mobile_request(st)

st.set_page_config(
    page_title="GNSS Based TEC Analysis Using Zimbabwe CORS Network",
    page_icon="🛰️",
    layout="wide",
    initial_sidebar_state="collapsed" if mobile_request else "expanded",
)
inject(st, page_id="home")

# ── Sidebar ──────────────────────────────────────────────────────────────────
with st.sidebar:
    if logo_path.exists() and not mobile_request:
        _, logo_col, _ = st.columns([1, 5, 1])
        with logo_col:
            st.image(str(logo_path), width="stretch")
    st.markdown(
        "<div style='text-align:center;color:#168bd2;font-weight:900;"
        "font-size:1.05rem;letter-spacing:0.05em;line-height:1.35;"
        "padding:0 0.25rem 0.5rem'>ZINGSA SPACE SCIENCE DEPARTMENT</div>",
        unsafe_allow_html=True,
    )
    st.divider()
    st.markdown("**Navigation**")
    st.page_link("Home.py",                      label="🏠 Home",                 )
    st.page_link("pages/1_Dashboard.py",         label="📊 Dashboard",            )
    st.page_link("pages/2_Processing.py",        label="⚙️ RINEX/CMN Processing", )
    st.page_link("pages/3_Time_Series.py",       label="📈 TEC Time Series",      )
    st.page_link("pages/4_PRN_Explorer.py",      label="🛸 PRN Explorer",         )
    st.page_link("pages/5_TEC_Heatmap.py",       label="🗺️ TEC Heat Map",        )
    st.page_link("pages/6_Space_Weather.py",     label="☀️ Space Weather",       )
    st.page_link("pages/7_TEC_Anomaly_Detection.py", label="🔬 TEC Anomaly Detection", )
    st.page_link("pages/9_CORS_Hardware.py",     label="📡 CORS Hardware",         )
    st.page_link("pages/10_VTEC_Theory.py",     label="📐 Calculating VTEC",      )
    st.page_link("pages/12_Live_Pipeline.py",   label="📡 Live Pipeline",         )
    st.page_link("pages/13_AI_Assistant.py",    label="🤖 AI Assistant",          )
    st.divider()
    st.caption("v1.0.0 · ZINGSA © 2026")

# ── Space weather data ────────────────────────────────────────────────────────
sw = get_space_weather()
risk_color = sw.get("gnss_risk_color", "#1D9E75")
online = sw.get("stations_online")
total = sw.get("stations_total")

# ── Hero header with integrated space-weather metrics ─────────────────────────
home_metric_renderer = getattr(
    metric_explainer,
    "render_home_hero_metrics",
    metric_explainer.render_sw_metric_cards,
)
if mobile_request:
    title_col = st.container()
    logo_col = None
else:
    title_col, logo_col = st.columns([5.2, 0.8], vertical_alignment="top")

with title_col:
    st.markdown(
        "<div class='zgiis-title'>🛰️ GNSS Based TEC Analysis Using Zimbabwe CORS Network</div>"
        "<div class='zgiis-tagline'>Dual-frequency GPS/GNSS Total Electron Content (TEC) computation from Zimbabwe CORS RINEX observations</div>",
        unsafe_allow_html=True,
    )
    home_metric_renderer(st, sw)

if logo_col is not None:
    with logo_col:
        if logo_path.exists():
            st.markdown("<div class='hero-logo-wrap'>", unsafe_allow_html=True)
            st.image(str(logo_path), width="stretch")
            st.markdown("</div>", unsafe_allow_html=True)
        else:
            st.markdown(
                "<div class='hero-logo-wrap' style='text-align:center;color:#ffffff;font-size:0.7rem'>"
                "Place <code>zingsa_logo.png</code> in <code>static/</code></div>",
                unsafe_allow_html=True,
            )

# ── CORS network map ──────────────────────────────────────────────────────────
map_hdr, map_style_col, map_risk = st.columns([3, 4, 1])
with map_hdr:
    st.subheader("Zimbabwe CORS Network")
    st.caption(
        f"Zimbabwe CORS network · {total if total is not None else 'N/A'} stations · "
        f"{online if online is not None else 'N/A'} live online · {sw['gnss_risk']} risk"
    )
with map_style_col:
    st.markdown(
        "<div style='font-size:0.62rem;color:#ffffff;text-transform:uppercase;"
        "letter-spacing:0.06em;margin-top:0.5rem'>Map Layer</div>",
        unsafe_allow_html=True,
    )
    selected_layer = st.session_state.setdefault("home_cors_map_style", "Hybrid")
    layer_cols = st.columns(len(MAP_STYLE_OPTIONS), gap="small")
    for option, layer_col in zip(MAP_STYLE_OPTIONS, layer_cols):
        with layer_col:
            if st.button(
                option,
                key=f"home_cors_map_style_{option}",
                type="primary" if selected_layer == option else "secondary",
                use_container_width=True,
            ):
                st.session_state["home_cors_map_style"] = option
                selected_layer = option
    home_map_style = map_style_from_label(selected_layer)
with map_risk:
    st.markdown(
        f"<div style='text-align:right;margin-top:0.4rem'>"
        f"<div style='font-size:0.62rem;color:#ffffff;text-transform:uppercase;"
        f"letter-spacing:0.06em'>Risk Level</div>"
        f"<div style='font-size:1rem;font-weight:800;color:{risk_color}'>{sw['gnss_risk'].upper()}</div>"
        f"</div>",
        unsafe_allow_html=True,
    )

show_home_map = True
if mobile_request:
    show_home_map = bool(st.session_state.get("home_mobile_map_loaded"))
    if not show_home_map:
        st.info(
            "Mobile data saver is active. Load the interactive map only when "
            "you need station details or map layers."
        )
        if st.button(
            "Load interactive CORS map",
            type="primary",
            use_container_width=True,
            key="home_mobile_map_load",
        ):
            st.session_state["home_mobile_map_loaded"] = True
            show_home_map = True

if show_home_map:
    render_cors_station_map(
        st,
        stations=stations_for_map(sw.get("station_health")),
        color_by="status",
        map_style=home_map_style,
        height=300 if mobile_request else 400,
        show_tec_legend=home_map_style == "tec_heatmap",
        key="home_cors_map",
    )
if show_home_map and home_map_style == "tec_heatmap":
    st.markdown(
        "<div style='display:flex;flex-wrap:wrap;align-items:center;gap:18px;"
        "margin-top:0.4rem;margin-bottom:0.5rem;padding:0.75rem 1rem;"
        "background:#000000;border:1px solid #244d73;border-left:4px solid #168bd2;"
        "border-radius:10px'>"
        # gradient bar
        "<div style='display:flex;flex-direction:column;align-items:center;gap:4px;flex-shrink:0'>"
        "<span style='font-size:0.62rem;color:#ffffff;font-weight:700;text-transform:uppercase;"
        "letter-spacing:0.05em'>Low TEC</span>"
        "<div style='width:160px;height:14px;border-radius:6px;border:1px solid #334155;"
        "background:linear-gradient(to right,#000080,#0080ff,#00ff80,#ffcc00,#ff0000)'></div>"
        "<span style='font-size:0.62rem;color:#ffffff;font-weight:700;text-transform:uppercase;"
        "letter-spacing:0.05em'>High TEC</span>"
        "</div>"
        # explanation text
        "<div style='font-size:0.80rem;color:#ffffff;line-height:1.55;flex:1'>"
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
# ── Module cards ─────────────────────────────────────────────────────────────
st.subheader("Platform Modules")

col1, col2, col3, col4 = st.columns(4)

def nav_card(col, icon, title, desc, page, accent="zgiis-card-accent"):
    with col:
        st.markdown(
            f"<div class='zgiis-card {accent}'>"
            f"<span style='font-size:1.7rem'>{icon}</span>"
            f"<div style='font-weight:700;color:#ffffff;margin:0.3rem 0 0.1rem'>{title}</div>"
            f"<div style='font-size:0.8rem;color:#ffffff'>{desc}</div>"
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
nav_card(col7, "🤖", "AI Assistant",      "Ask TEC AI — ionosphere Q&A",               "pages/13_AI_Assistant.py",  "zgiis-card-ok")

st.markdown("---")

# ── Constellation coverage ────────────────────────────────────────────────────
st.subheader("Constellation Coverage")
constellation_counts = {"GPS": 0, "GLONASS": 0, "Galileo": 0, "BeiDou": 0}
for station in ZIMBABWE_CORS_STATIONS:
    for constellation in station.constellations:
        if constellation in constellation_counts:
            constellation_counts[constellation] += 1

if mobile_request:
    maximum_count = max(constellation_counts.values(), default=1)
    coverage_colors = {
        "GPS": "#0077aa",
        "GLONASS": "#ff8c00",
        "Galileo": "#00cc66",
        "BeiDou": "#aa33dd",
    }
    coverage_rows = "".join(
        (
            "<div class='mobile-coverage-row'>"
            f"<div class='mobile-coverage-label'>{name}</div>"
            "<div class='mobile-coverage-track'>"
            f"<div class='mobile-coverage-fill' style='width:{count * 100 / maximum_count:.1f}%;"
            f"background:{coverage_colors[name]}'></div></div>"
            f"<div class='mobile-coverage-value'>{count}</div>"
            "</div>"
        )
        for name, count in constellation_counts.items()
    )
    st.markdown(
        f"<div class='mobile-coverage-card'>{coverage_rows}</div>",
        unsafe_allow_html=True,
    )
else:
    import plotly.graph_objects as go

    constellation_chart = go.Figure(
        go.Pie(
            labels=list(constellation_counts.keys()),
            values=list(constellation_counts.values()),
            hole=0.52,
            domain=dict(x=[0.12, 0.68], y=[0.08, 0.92]),
            marker=dict(
                colors=["#0077aa", "#ff8c00", "#00cc66", "#aa33dd"],
                line=dict(color="#000000", width=2),
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
        paper_bgcolor="#000000",
        plot_bgcolor="#000000",
        font=dict(color="#ffffff", size=14),
        uniformtext=dict(minsize=16, mode="show"),
        legend=dict(
            bgcolor="#000000",
            bordercolor="#244d73",
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

# ── Scintillation Risk Assessment ────────────────────────────────────────────
st.subheader("Scintillation Risk Assessment")

_tec_vals = [s.current_tec for s in ZIMBABWE_CORS_STATIONS if s.current_tec > 0]
_high_tec = sum(1 for v in _tec_vals if v > 30)
_nominal = sum(1 for v in _tec_vals if 15 <= v <= 30)
_low_tec = sum(1 for v in _tec_vals if v < 15)

_risk_c1, _risk_c2, _risk_c3 = st.columns(3)
for _col, _title, _count, _range, _note, _title_color, _border_color in [
    (_risk_c1, "High TEC Zones", _high_tec, "STATIONS > 30 TECU", "Possible scintillation risk · RTK degradation", "#ff4444", "#ff4444"),
    (_risk_c2, "Nominal Zones", _nominal, "STATIONS 15–30 TECU", "Normal ionospheric conditions", "#00ff88", "#00ff88"),
    (_risk_c3, "Low TEC Zones", _low_tec, "STATIONS < 15 TECU", "Post-storm depletion or nighttime conditions", "#ffffff", "#334155"),
]:
    with _col:
        st.markdown(
            f"<div style='background:#000000;border:1px solid #244d73;"
            f"border-left:4px solid {_border_color};border-radius:10px;"
            f"padding:1.1rem 1.3rem;margin-bottom:0.7rem'>"
            f"<div style='font-size:1rem;font-weight:800;color:#ffffff;margin-bottom:0.5rem'>{_title}</div>"
            f"<div style='font-size:2.4rem;font-weight:700;color:#ffffff;line-height:1.1'>{_count}</div>"
            f"<div style='font-size:0.72rem;color:#ffffff;text-transform:uppercase;"
            f"letter-spacing:0.08em;margin:0.4rem 0 0.5rem'>{_range}</div>"
            f"<div style='font-size:0.8rem;color:#ffffff;opacity:0.85'>{_note}</div>"
            f"</div>",
            unsafe_allow_html=True,
        )

st.markdown("---")

st.caption(
    f"Data source: {sw.get('source','N/A')} · Last updated: {sw.get('timestamp','N/A')} · "
    "ZGIIS v1.0 · Zimbabwe National Geospatial and Space Agency (ZINGSA)"
)
