"""Zimbabwe live TEC heat map."""
from __future__ import annotations

import sys
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.graph_objects as go
import streamlit as st

root = Path(__file__).resolve().parents[1]
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS, normalize_station_status
from zgiis.maps.interpolation import interpolate_tec, make_plotly_heatmap_trace
from zgiis.maps.station_map import map_style_from_label, render_cors_station_map
from zgiis.theme import inject

st.set_page_config(
    page_title="ZGIIS - TEC Heat Map",
    page_icon="MAP",
    layout="wide",
)
inject(st, page_id="tec_heatmap")

with st.sidebar:
    st.markdown("### Heat Map Controls")
    selected_layer = st.selectbox(
        "Map layer",
        ["Hybrid", "Satellite", "Street", "TEC Heat Map"],
        index=0,
    )
    interp_method = st.selectbox(
        "Interpolation",
        ["linear", "nearest", "cubic"],
        index=0,
    )
    st.slider("VTEC colour min (TECU)", 5, 30, 10, key="tec_map_min")
    st.slider("VTEC colour max (TECU)", 20, 80, 40, key="tec_map_max")
    show_stations = st.checkbox("Overlay station markers", value=True)
    show_labels = st.checkbox("Show station labels", value=True)
    show_gradient = st.checkbox("Show TEC gradient magnitude", value=False)
    st.divider()
    st.page_link("Home.py", label="<- Back to Home")

st.markdown(
    "<div class='zgiis-title' style='font-size:1.7rem'>"
    "Zimbabwe TEC Heat Map</div>",
    unsafe_allow_html=True,
)
st.caption("Live telemetry-backed Total Electron Content (VTEC) over Zimbabwe")
st.markdown("---")

map_style = map_style_from_label(selected_layer)


@st.cache_resource(show_spinner=False)
def _get_db():
    try:
        from zgiis.db.timescale import TecDB
        return TecDB()
    except Exception:
        return None


def _local_vtec_stations(hours: float = 2.0) -> pd.DataFrame:
    db = _get_db()
    if db is None:
        return pd.DataFrame()
    try:
        summary = db.station_summary(hours=hours)
    except Exception:
        return pd.DataFrame()
    if summary.empty:
        return pd.DataFrame()

    station_lookup = {station.code.lower(): station for station in ZIMBABWE_CORS_STATIONS}
    rows = []
    for _, row in summary.iterrows():
        code = str(row.get("station", "")).lower().rstrip("_")
        station = station_lookup.get(code)
        if station is None:
            continue
        rows.append(
            {
                "name": station.name,
                "code": station.code,
                "lat": station.lat,
                "lon": station.lon,
                "vtec": float(row["mean_vtec"]),
                "status": "online",
                "data_source": "local live pipeline",
                "obs_count": int(row.get("obs_count") or 0),
            }
        )
    return pd.DataFrame(rows)


sdf = _local_vtec_stations(hours=2.0)

if sdf.empty:
    st.error("Live TEC map unavailable")
    st.warning(
        "No recent VTEC observations were found in the local live-pipeline database. "
        "The map below shows configured Zimbabwe CORS station locations only; "
        "no archive, model, hard-coded, or randomly generated TEC values are displayed as live data."
    )
    unavailable_stations = [
        replace(station, status="unknown", current_tec=0.0)
        for station in ZIMBABWE_CORS_STATIONS
    ]
    render_cors_station_map(
        st,
        stations=unavailable_stations,
        color_by="status",
        map_style=map_style,
        height=520,
        show_tec_legend=False,
        key="tec_heatmap_unavailable",
    )
    st.caption(
        "Click any station marker for station name, coordinates, receiver height, "
        "and supported GNSS constellations. Grey markers mean live TEC telemetry is unavailable."
    )
    st.stop()

st.success(
    f"Local live pipeline | {len(sdf)} station VTEC observations from the last 2 hours"
)

traces: list[go.BaseTraceType] = []
interp_ok = False
if len(sdf) >= 3:
    with st.spinner("Interpolating live TEC grid..."):
        try:
            grid_lons, grid_lats, grid_tec = interpolate_tec(
                sdf["lat"].values,
                sdf["lon"].values,
                sdf["vtec"].values,
                method=interp_method,
            )
            traces.append(
                make_plotly_heatmap_trace(grid_lons, grid_lats, grid_tec)
            )
            interp_ok = True
        except Exception as exc:
            st.warning(
                f"Live interpolation failed ({exc}). "
                "Showing verified station measurements only."
            )
else:
    st.warning(
        "At least three live VTEC stations are required for a national "
        "interpolation. Verified station measurements are shown without a grid."
    )

if show_stations:
    status_colors = {
        "online": "#1D9E75",
        "degraded": "#EF9F27",
        "offline": "#ef4444",
    }
    traces.append(
        go.Scattermapbox(
            lat=sdf["lat"].tolist(),
            lon=sdf["lon"].tolist(),
            mode="markers+text" if show_labels else "markers",
            marker={
                "size": 16,
                "color": [
                    status_colors.get(
                        normalize_station_status(status),
                        "#94a3b8",
                    )
                    for status in sdf["status"]
                ],
                "opacity": 0.9,
            },
            text=sdf["code"].str.upper().tolist() if show_labels else None,
            textposition="top center",
            textfont={"size": 10, "color": "#ffffff"},
            customdata=np.column_stack([sdf["name"], sdf["vtec"].round(1)]),
            hovertemplate=(
                "<b>%{customdata[0]}</b><br>"
                "Live VTEC: %{customdata[1]} TECU<extra></extra>"
            ),
            name="Live CORS stations",
        )
    )

fig = go.Figure(data=traces)
plotly_map_styles = {
    "hybrid": "carto-darkmatter",
    "satellite": "carto-darkmatter",
    "street": "open-street-map",
    "tec_heatmap": "carto-darkmatter",
}
fig.update_layout(
    mapbox={
        "style": plotly_map_styles.get(map_style, "carto-darkmatter"),
        "center": {"lat": -19.0, "lon": 29.8},
        "zoom": 5.6,
    },
    margin={"l": 0, "r": 0, "t": 0, "b": 0},
    height=560,
    paper_bgcolor="#000000",
    legend={
        "bgcolor": "#000000",
        "bordercolor": "#244d73",
        "font_color": "#ffffff",
    },
)
st.plotly_chart(fig, use_container_width=True)

if show_gradient and interp_ok:
    st.caption("Gradient magnitude calculated from the live interpolated TEC grid")
    dy, dx = np.gradient(grid_tec)
    magnitude = np.sqrt(dx**2 + dy**2)
    flat_magnitude = magnitude.ravel()
    top_idx = np.argsort(flat_magnitude)[-30:]
    gradient_fig = go.Figure(
        go.Scattermapbox(
            lat=grid_lats.ravel()[top_idx].tolist(),
            lon=grid_lons.ravel()[top_idx].tolist(),
            mode="markers",
            marker={
                "size": 10,
                "color": flat_magnitude[top_idx].tolist(),
                "colorscale": "Reds",
                "showscale": True,
                "colorbar": {"title": "Gradient"},
            },
            hovertemplate="Gradient: %{marker.color:.3f}<extra></extra>",
            name="TEC gradient",
        )
    )
    gradient_fig.update_layout(
        mapbox={
            "style": plotly_map_styles.get(map_style, "carto-darkmatter"),
            "center": {"lat": -19.0, "lon": 29.8},
            "zoom": 5.6,
        },
        margin={"l": 0, "r": 0, "t": 0, "b": 0},
        height=400,
        paper_bgcolor="#000000",
    )
    st.plotly_chart(gradient_fig, use_container_width=True)

st.markdown("---")
st.subheader("Live Station TEC Values Used in Grid")
display_df = sdf[
    ["name", "code", "lat", "lon", "vtec", "status", "data_source"]
].copy()
display_df.columns = [
    "Station",
    "Code",
    "Latitude",
    "Longitude",
    "VTEC (TECU)",
    "Status",
    "Source",
]
display_df["VTEC (TECU)"] = display_df["VTEC (TECU)"].round(2)
st.dataframe(display_df, use_container_width=True)

st.markdown("---")
st.subheader("TEC Condition Summary")
high_tec = sdf[sdf["vtec"] > 30]
low_tec = sdf[sdf["vtec"] < 15]
nominal = sdf[(sdf["vtec"] >= 15) & (sdf["vtec"] <= 30)]

for column, title, frame, note, color in zip(
    st.columns(3),
    ["High TEC Zones", "Nominal Zones", "Low TEC Zones"],
    [high_tec, nominal, low_tec],
    [
        "Stations above 30 TECU",
        "Stations between 15 and 30 TECU",
        "Stations below 15 TECU",
    ],
    ["#ff4444", "#00ff88", "#94a3b8"],
):
    with column:
        st.markdown(
            "<div class='zgiis-card'>"
            f"<div style='font-weight:700;color:{color}'>{title}</div>"
            f"<div class='big-metric'>{len(frame)}</div>"
            f"<div class='metric-label'>{note}</div>"
            "</div>",
            unsafe_allow_html=True,
        )
