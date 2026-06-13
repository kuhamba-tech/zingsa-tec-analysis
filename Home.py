"""ZGIIS — Zimbabwe GNSS Ionosphere Intelligence System — Home / Landing Page."""
from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

root = Path(__file__).resolve().parent
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
from zgiis.space_weather.fetch_indices import get_space_weather, get_warning_messages
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
    st.markdown(
        "<div style='text-align:center;padding:0.6rem 0'>"
        "<span style='font-size:2.4rem'>🛰️</span><br>"
        "<span style='color:#00d4ff;font-weight:900;font-size:1.45rem;"
        "letter-spacing:0.04em;line-height:1.3'>ZINGSA Space Science</span>"
        "</div>",
        unsafe_allow_html=True,
    )
    st.divider()
    st.markdown("**Navigation**")
    st.page_link("Home.py",                      label="🏠 Home",                 )
    st.page_link("pages/1_Dashboard.py",         label="📡 Live Dashboard",       )
    st.page_link("pages/2_Processing.py",        label="⚙️ RINEX/CMN Processing", )
    st.page_link("pages/3_Time_Series.py",       label="📈 TEC Time Series",      )
    st.page_link("pages/4_PRN_Explorer.py",      label="🛸 PRN Explorer",         )
    st.page_link("pages/5_TEC_Heatmap.py",       label="🗺️ TEC Heat Map",        )
    st.page_link("pages/6_Space_Weather.py",     label="☀️ Space Weather",       )
    st.page_link("pages/7_Research.py",          label="🔬 Research Centre",      )
    st.page_link("pages/8_AI_Assistant.py",      label="🤖 AI Assistant",         )
    st.divider()
    st.caption("v1.0.0 · ZINGSA © 2026")

# ── Hero header with ZINGSA logo ─────────────────────────────────────────────
_logo_path = root / "static" / "zingsa_logo.png"
_hero_left, _hero_right = st.columns([5, 1])

with _hero_left:
    st.markdown(
        "<div class='zgiis-title'>🛰️ GNSS Based TEC Analysis Using Zimbabwe CORS Network</div>"
        "<div class='zgiis-tagline'>Dual-frequency GPS/GNSS Total Electron Content (TEC) computation from Zimbabwe CORS RINEX observations</div>",
        unsafe_allow_html=True,
    )

with _hero_right:
    if _logo_path.exists():
        st.image(str(_logo_path), width=130)
    else:
        st.markdown(
            "<div style='text-align:center;color:#446688;font-size:0.7rem;"
            "padding-top:0.5rem'>Place<br><code>zingsa_logo.png</code><br>"
            "in the <code>static/</code> folder</div>",
            unsafe_allow_html=True,
        )

st.markdown("---")

# ── Space weather bar ─────────────────────────────────────────────────────────
sw = get_space_weather()
warnings = get_warning_messages(sw)
risk_color = sw.get("gnss_risk_color", "#00ff88")

c1, c2, c3, c4, c5 = st.columns(5)
with c1:
    st.metric("Kp Index", sw["kp"], help="Planetary K-index (0–9). >5 = storm conditions.")
with c2:
    st.metric("Condition", sw["kp_condition"])
with c3:
    st.metric("F10.7 (sfu)", sw["f107"], help="Solar flux index at 10.7 cm")
with c4:
    st.metric("GNSS Risk", sw["gnss_risk"])
with c5:
    online = sum(1 for s in ZIMBABWE_CORS_STATIONS if s.status == "online")
    st.metric("Stations Online", f"{online}/{len(ZIMBABWE_CORS_STATIONS)}")

# ── Warning messages ──────────────────────────────────────────────────────────
for msg in warnings:
    box_cls = "alert-box" if sw["gnss_risk"] in ("High", "Critical") else ("warn-box" if sw["gnss_risk"] == "Moderate" else "ok-box")
    st.markdown(f"<div class='{box_cls}'>ℹ️ {msg}</div>", unsafe_allow_html=True)

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

nav_card(col1, "📡", "Live Dashboard",    "Station map · status · live TEC",           "pages/1_Dashboard.py")
nav_card(col2, "⚙️", "RINEX Processing",  "CMN/RINEX loader · elevation filter",        "pages/2_Processing.py")
nav_card(col3, "📈", "TEC Time Series",   "Daily · monthly · yearly trends",            "pages/3_Time_Series.py")
nav_card(col4, "🛸", "PRN Explorer",      "GPS/Galileo/BeiDou/GLONASS analysis",       "pages/4_PRN_Explorer.py")

col5, col6, col7, col8 = st.columns(4)
nav_card(col5, "🗺️", "TEC Heat Map",      "Interpolated TEC grid over Zimbabwe",        "pages/5_TEC_Heatmap.py",   "zgiis-card-ok")
nav_card(col6, "☀️", "Space Weather",     "Kp · F10.7 · storm alerts",                 "pages/6_Space_Weather.py", "zgiis-card-warn")
nav_card(col7, "🔬", "Research Centre",   "Anomaly · seasonal · solar cycle tools",     "pages/7_Research.py",      "zgiis-card-accent")
nav_card(col8, "🤖", "AI Assistant",      "Ask TEC AI — ionosphere Q&A",               "pages/8_AI_Assistant.py",  "zgiis-card-ok")

st.markdown("---")

# ── Station status overview ───────────────────────────────────────────────────
st.subheader("Zimbabwe CORS Network — Station Status")

cols = st.columns(4)
for idx, station in enumerate(ZIMBABWE_CORS_STATIONS):
    with cols[idx % 4]:
        tec_str = f"{station.current_tec:.1f} TECU" if station.current_tec > 0 else "—"
        const_str = " · ".join(station.constellations)
        st.markdown(
            f"<div class='zgiis-card'>"
            f"<div style='display:flex;justify-content:space-between;align-items:center'>"
            f"  <span style='font-weight:700;color:#c8e0ff'>{station.name}</span>"
            f"  <span class='badge badge-{station.status}'>{station.status.upper()}</span>"
            f"</div>"
            f"<div style='font-size:0.75rem;color:#446688;margin-top:3px'>{station.code.upper()} · {station.lat:.3f}°, {station.lon:.3f}°</div>"
            f"<div class='big-metric' style='font-size:1.4rem;margin-top:4px'>{tec_str}</div>"
            f"<div style='font-size:0.72rem;color:#557799;margin-top:2px'>{const_str}</div>"
            f"</div>",
            unsafe_allow_html=True,
        )

st.markdown("---")
st.caption(
    f"Data source: {sw.get('source','N/A')} · Last updated: {sw.get('timestamp','N/A')} · "
    "ZGIIS v1.0 · Zimbabwe National Geospatial and Space Agency (ZINGSA)"
)
