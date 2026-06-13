"""ZGIIS — Zimbabwe TEC Heat Map with interpolated grid."""
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
from zgiis.maps.interpolation import interpolate_tec, make_plotly_heatmap_trace
from zgiis.theme import inject

st.set_page_config(page_title="ZGIIS — TEC Heat Map", page_icon="🗺️", layout="wide")
inject(st)

with st.sidebar:
    st.markdown("### 🗺️ Heat Map Controls")
    map_style = st.selectbox("Map style", ["carto-darkmatter", "open-street-map", "carto-positron"], index=0)
    interp_method = st.selectbox("Interpolation", ["linear", "nearest", "cubic"], index=0)
    tec_min = st.slider("VTEC colour min (TECU)", 5,  30, 10)
    tec_max = st.slider("VTEC colour max (TECU)", 20, 80, 40)
    show_stations = st.checkbox("Overlay station markers", value=True)
    show_labels   = st.checkbox("Show station labels",    value=True)
    show_gradient = st.checkbox("Show TEC gradient arrows (demo)", value=False)
    st.divider()
    st.page_link("Home.py", label="← Back to Home")

st.markdown("<div class='zgiis-title' style='font-size:1.7rem'>🗺️ Zimbabwe TEC Heat Map</div>", unsafe_allow_html=True)
st.caption("Interpolated Total Electron Content (VTEC) over Zimbabwe — national ionosphere grid")
st.markdown("---")

# ── Collect station TEC values ────────────────────────────────────────────────
# If real data was processed, use per-station means; else use station current_tec
df: pd.DataFrame = st.session_state.get("zgiis_df", pd.DataFrame())

station_data: list[dict] = []

if not df.empty and "station" in df.columns and "vtec" in df.columns:
    means = df.groupby("station")["vtec"].mean()
    for stn in ZIMBABWE_CORS_STATIONS:
        if stn.code in means.index and stn.current_tec == 0:
            stn.current_tec = float(means[stn.code])

for stn in ZIMBABWE_CORS_STATIONS:
    if stn.current_tec > 0:
        station_data.append({"name": stn.name, "code": stn.code,
                              "lat": stn.lat, "lon": stn.lon,
                              "vtec": stn.current_tec, "status": stn.status})

if len(station_data) < 3:
    st.info("Not enough station TEC data for interpolation (need ≥ 3 stations). Using demo values.")
    # Inject demo values
    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS as _ALL
    rng = np.random.default_rng(7)
    for stn in _ALL:
        station_data.append({
            "name": stn.name, "code": stn.code,
            "lat": stn.lat, "lon": stn.lon,
            "vtec": 18 + rng.uniform(-3, 6), "status": stn.status,
        })

sdf = pd.DataFrame(station_data)

# ── Interpolate TEC ───────────────────────────────────────────────────────────
with st.spinner("Interpolating TEC grid..."):
    try:
        grid_lons, grid_lats, grid_tec = interpolate_tec(
            sdf["lat"].values, sdf["lon"].values, sdf["vtec"].values,
            method=interp_method,
        )
        heat_trace = make_plotly_heatmap_trace(grid_lons, grid_lats, grid_tec)
        traces = [heat_trace]
        interp_ok = True
    except Exception as exc:
        st.warning(f"Interpolation failed ({exc}) — showing station markers only.")
        traces = []
        interp_ok = False

# ── Station markers ───────────────────────────────────────────────────────────
if show_stations:
    status_colors = {"online": "#00ff88", "degraded": "#ff8c00", "offline": "#ff4444"}
    traces.append(go.Scattermapbox(
        lat=sdf["lat"].tolist(), lon=sdf["lon"].tolist(),
        mode="markers+text" if show_labels else "markers",
        marker=dict(
            size=16,
            color=[status_colors.get(r, "#888") for r in sdf["status"]],
            opacity=0.9,
        ),
        text=sdf["code"].str.upper().tolist() if show_labels else None,
        textposition="top center",
        textfont=dict(size=10, color="#e0f0ff"),
        customdata=np.column_stack([sdf["name"], sdf["vtec"].round(1)]),
        hovertemplate="<b>%{customdata[0]}</b><br>VTEC: %{customdata[1]} TECU<extra></extra>",
        name="CORS Stations",
    ))

# ── Map layout ────────────────────────────────────────────────────────────────
fig = go.Figure(data=traces)
fig.update_layout(
    mapbox=dict(style=map_style, center=dict(lat=-19.0, lon=29.8), zoom=5.6),
    margin=dict(l=0, r=0, t=0, b=0),
    height=560,
    paper_bgcolor="#060d1a",
    legend=dict(bgcolor="#0d1b2a", bordercolor="#1e3a5f", font_color="#b0c8e8"),
)
st.plotly_chart(fig, use_container_width=True)

# ── TEC gradient demo (arrows — static illustrative) ──────────────────────────
if show_gradient and interp_ok:
    st.caption("TEC gradient magnitude (illustrative — arrows show regions of steepest change)")
    dy, dx = np.gradient(grid_tec)
    magnitude = np.sqrt(dx**2 + dy**2)
    flat_mag  = magnitude.ravel()
    top_idx   = np.argsort(flat_mag)[-30:]
    fig_grad  = go.Figure(go.Scattermapbox(
        lat=grid_lats.ravel()[top_idx].tolist(),
        lon=grid_lons.ravel()[top_idx].tolist(),
        mode="markers",
        marker=dict(size=10, color=flat_mag[top_idx].tolist(),
                    colorscale="Reds", showscale=True,
                    colorbar=dict(title="Gradient")),
        hovertemplate="Gradient: %{marker.color:.3f}<extra></extra>",
        name="TEC Gradient",
    ))
    fig_grad.update_layout(
        mapbox=dict(style=map_style, center=dict(lat=-19.0, lon=29.8), zoom=5.6),
        margin=dict(l=0,r=0,t=0,b=0), height=400, paper_bgcolor="#060d1a",
    )
    st.plotly_chart(fig_grad, use_container_width=True)

# ── Station table ─────────────────────────────────────────────────────────────
st.markdown("---")
st.subheader("Station TEC Values Used in Grid")
display_df = sdf[["name","code","lat","lon","vtec","status"]].copy()
display_df.columns = ["Station","Code","Latitude","Longitude","VTEC (TECU)","Status"]
display_df["VTEC (TECU)"] = display_df["VTEC (TECU)"].round(2)
st.dataframe(display_df, use_container_width=True)

# ── Scintillation risk zones ───────────────────────────────────────────────────
st.markdown("---")
st.subheader("Scintillation Risk Assessment")

high_tec = sdf[sdf["vtec"] > 30]
low_tec  = sdf[sdf["vtec"] < 15]
nominal  = sdf[(sdf["vtec"] >= 15) & (sdf["vtec"] <= 30)]

c1, c2, c3 = st.columns(3)
with c1:
    st.markdown(
        f"<div class='zgiis-card zgiis-card-alert'>"
        f"<div style='font-weight:700;color:#ff4444'>High TEC Zones</div>"
        f"<div class='big-metric'>{len(high_tec)}</div>"
        f"<div class='metric-label'>stations > 30 TECU</div>"
        f"<div style='font-size:0.78rem;color:#aa6666;margin-top:5px'>"
        f"Possible scintillation risk · RTK degradation</div>"
        f"</div>",
        unsafe_allow_html=True,
    )
with c2:
    st.markdown(
        f"<div class='zgiis-card zgiis-card-ok'>"
        f"<div style='font-weight:700;color:#00ff88'>Nominal Zones</div>"
        f"<div class='big-metric'>{len(nominal)}</div>"
        f"<div class='metric-label'>stations 15–30 TECU</div>"
        f"<div style='font-size:0.78rem;color:#448866;margin-top:5px'>"
        f"Normal ionospheric conditions</div>"
        f"</div>",
        unsafe_allow_html=True,
    )
with c3:
    st.markdown(
        f"<div class='zgiis-card'>"
        f"<div style='font-weight:700;color:#6888aa'>Low TEC Zones</div>"
        f"<div class='big-metric'>{len(low_tec)}</div>"
        f"<div class='metric-label'>stations < 15 TECU</div>"
        f"<div style='font-size:0.78rem;color:#446688;margin-top:5px'>"
        f"Post-storm depletion or nighttime conditions</div>"
        f"</div>",
        unsafe_allow_html=True,
    )

if not high_tec.empty:
    stations_list = ", ".join(high_tec["name"].tolist())
    st.markdown(
        f"<div class='warn-box'>⚠️ Elevated TEC detected at: {stations_list} — "
        f"monitor for potential GNSS accuracy degradation.</div>",
        unsafe_allow_html=True,
    )
