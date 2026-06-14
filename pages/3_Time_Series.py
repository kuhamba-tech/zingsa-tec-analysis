"""ZGIIS — TEC Time Series Viewer."""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

root = Path(__file__).resolve().parents[1]
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from zgiis.data.tec_archive import load_historical_tec
from zgiis.theme import inject

st.set_page_config(page_title="ZGIIS — TEC Time Series", page_icon="📈", layout="wide")
inject(st)

# ── Load real processed data from session ────────────────────────────────────
@st.cache_data(show_spinner=False)
def _load_archive():
    return load_historical_tec()


df: pd.DataFrame = st.session_state.get("zgiis_df", pd.DataFrame())
data_origin = "Current Processing session"
archive_metadata: dict = {}
if df.empty:
    df, archive_metadata = _load_archive()
    data_origin = "Historical processed CMN archive"
if df.empty:
    st.warning(
        "No processed TEC observations are loaded. Run **⚙️ Processing** and select "
        "real RINEX or CMN files. This page does not generate demo data."
    )
    st.page_link("pages/2_Processing.py", label="Open Processing")
    st.stop()

df = df.copy()
df["date"] = pd.to_datetime(df["date"])
if "constellation" not in df.columns:
    df["constellation"] = "GPS"
if "prn" not in df.columns:
    df["prn"] = "G01"

# ── Sidebar filters ───────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("### 📈 Time Series Filters")
    stations = sorted(df["station"].dropna().unique())
    sel_stations = st.multiselect("Stations", stations, default=stations)
    constellations = sorted(df["constellation"].dropna().unique())
    sel_const = st.multiselect("Constellation", constellations, default=constellations)
    prns = sorted(df["prn"].dropna().unique())
    sel_prn = st.multiselect("Satellite PRN", prns, default=[])
    min_d = df["date"].min().date()
    max_d = df["date"].max().date()
    date_range = st.date_input("Date range", value=(min_d, max_d), min_value=min_d, max_value=max_d)
    show_anomaly = st.checkbox("Highlight anomaly threshold (95th pct)", value=True)
    smoothing    = st.slider("Smoothing window (days)", 1, 30, 7)
    st.divider()
    st.page_link("Home.py", label="← Back to Home")

st.markdown("<div class='zgiis-title' style='font-size:1.7rem'>📈 TEC Time Series Viewer</div>", unsafe_allow_html=True)
st.caption("Daily, monthly, and seasonal TEC variation across the Zimbabwe CORS network")
st.markdown("---")

available_years = sorted(df["date"].dt.year.dropna().astype(int).unique().tolist())
station_coverage = (
    df.groupby("station")
    .agg(
        observations=("vtec", "count"),
        first_date=("date", "min"),
        last_date=("date", "max"),
    )
    .reset_index()
    .sort_values("station")
)
year_text = ", ".join(str(year) for year in available_years) or "None"
observation_count = (
    int(pd.to_numeric(df["observations"], errors="coerce").fillna(0).sum())
    if "observations" in df.columns
    else len(df)
)
st.info(
    f"{data_origin}: {observation_count:,} source observations represented by "
    f"{len(df):,} chart records | {len(stations)} station(s) | "
    f"available year(s): {year_text}."
)
if archive_metadata:
    st.caption(
        "Historical data, not live telemetry. "
        f"Coverage: {archive_metadata['first_date']:%Y-%m-%d} to "
        f"{archive_metadata['last_date']:%Y-%m-%d}. "
        f"Derived from {archive_metadata['source_files']} real processed CMN files."
    )
with st.expander("View station and date coverage", expanded=False):
    st.dataframe(station_coverage, width="stretch", hide_index=True)

# ── Apply filters ─────────────────────────────────────────────────────────────
fdf = df.copy()
if sel_stations:
    fdf = fdf[fdf["station"].isin(sel_stations)]
if sel_const:
    fdf = fdf[fdf["constellation"].isin(sel_const)]
if sel_prn:
    fdf = fdf[fdf["prn"].isin(sel_prn)]
if isinstance(date_range, (list, tuple)) and len(date_range) == 2:
    fdf = fdf[(fdf["date"] >= pd.Timestamp(date_range[0])) & (fdf["date"] <= pd.Timestamp(date_range[1]))]

if fdf.empty:
    st.warning("No data after filtering.")
    st.stop()

daily_mean = fdf.groupby(["date", "station"])["vtec"].mean().reset_index()
daily_mean.columns = ["date", "station", "mean_vtec"]

# ── Tab layout ────────────────────────────────────────────────────────────────
tab1, tab2, tab3, tab4 = st.tabs(["Daily Variation", "Monthly Averages", "Seasonal / Yearly", "Diurnal Pattern"])

# ── Tab 1: Daily ─────────────────────────────────────────────────────────────
with tab1:
    smooth_daily = daily_mean.copy()
    smooth_daily = smooth_daily.sort_values(["station", "date"])
    smooth_daily["vtec_smooth"] = (
        smooth_daily.groupby("station")["mean_vtec"]
        .transform(lambda x: x.rolling(smoothing, center=True, min_periods=1).mean())
    )

    fig = px.line(
        smooth_daily, x="date", y="vtec_smooth", color="station",
        labels={"vtec_smooth": "VTEC (TECU)", "date": "Date"},
        title=f"Daily VTEC — {smoothing}-day rolling mean",
    )
    if show_anomaly:
        p95 = smooth_daily["vtec_smooth"].quantile(0.95)
        fig.add_hline(y=p95, line_dash="dash", line_color="#ff4444",
                      annotation_text=f"95th pct: {p95:.1f} TECU",
                      annotation_font_color="#ff4444")
    fig.update_layout(paper_bgcolor="#060d1a", plot_bgcolor="#0d1b2a",
                      font_color="#ffffff", yaxis=dict(gridcolor="#1e3a5f"),
                      xaxis=dict(gridcolor="#1e3a5f"), height=380,
                      legend=dict(bgcolor="#0d1b2a", bordercolor="#1e3a5f"))
    st.plotly_chart(fig, use_container_width=True)
    st.download_button("⬇ Download daily CSV", smooth_daily.to_csv(index=False).encode(), "daily_tec.csv", "text/csv")

# ── Tab 2: Monthly ───────────────────────────────────────────────────────────
with tab2:
    fdf["month"] = fdf["date"].dt.to_period("M").astype(str)
    monthly = fdf.groupby(["month", "station"])["vtec"].agg(["mean","max","min"]).reset_index()
    monthly.columns = ["month", "station", "mean_vtec", "max_vtec", "min_vtec"]

    fig_m = px.bar(
        monthly, x="month", y="mean_vtec", color="station", barmode="group",
        labels={"mean_vtec": "Mean VTEC (TECU)", "month": "Month"},
        title="Monthly Mean VTEC by Station",
    )
    fig_m.update_layout(paper_bgcolor="#060d1a", plot_bgcolor="#0d1b2a",
                        font_color="#ffffff", yaxis=dict(gridcolor="#1e3a5f"),
                        xaxis=dict(gridcolor="#1e3a5f"), height=380,
                        legend=dict(bgcolor="#0d1b2a", bordercolor="#1e3a5f"))
    st.plotly_chart(fig_m, use_container_width=True)

    fig_range = go.Figure()
    for stn in monthly["station"].unique():
        s = monthly[monthly["station"] == stn]
        fig_range.add_trace(go.Scatter(
            x=list(s["month"]) + list(s["month"])[::-1],
            y=list(s["max_vtec"]) + list(s["min_vtec"])[::-1],
            fill="toself", opacity=0.2, name=f"{stn} range",
            hoverinfo="skip",
        ))
        fig_range.add_trace(go.Scatter(
            x=s["month"], y=s["mean_vtec"], mode="lines+markers",
            name=stn, line=dict(width=2),
        ))
    fig_range.update_layout(
        title="Monthly VTEC Range (min/mean/max)",
        paper_bgcolor="#060d1a", plot_bgcolor="#0d1b2a",
        font_color="#ffffff", yaxis=dict(title="VTEC (TECU)", gridcolor="#1e3a5f"),
        xaxis=dict(gridcolor="#1e3a5f"), height=360,
        legend=dict(bgcolor="#0d1b2a", bordercolor="#1e3a5f"),
    )
    st.plotly_chart(fig_range, use_container_width=True)
    st.download_button("⬇ Download monthly CSV", monthly.to_csv(index=False).encode(), "monthly_tec.csv", "text/csv")

# ── Tab 3: Seasonal / Yearly ─────────────────────────────────────────────────
with tab3:
    fdf["year"]   = fdf["date"].dt.year
    fdf["doy"]    = fdf["date"].dt.day_of_year
    fdf["season"] = pd.cut(
        fdf["date"].dt.month,
        bins=[0, 3, 6, 9, 12],
        labels=["Jan-Mar (Summer)", "Apr-Jun (Autumn)", "Jul-Sep (Winter)", "Oct-Dec (Spring)"],
    )

    yearly = fdf.groupby(["year", "station"])["vtec"].mean().reset_index()
    fig_yr = px.line(yearly, x="year", y="vtec", color="station", markers=True,
                     labels={"vtec": "Mean VTEC (TECU)", "year": "Year"},
                     title="Yearly Mean VTEC Trend")
    fig_yr.update_layout(paper_bgcolor="#060d1a", plot_bgcolor="#0d1b2a",
                         font_color="#ffffff", yaxis=dict(gridcolor="#1e3a5f"),
                         xaxis=dict(gridcolor="#1e3a5f"), height=320,
                         legend=dict(bgcolor="#0d1b2a", bordercolor="#1e3a5f"))
    st.plotly_chart(fig_yr, use_container_width=True)

    seasonal = fdf.groupby(["season", "station"])["vtec"].mean().reset_index()
    fig_sea = px.bar(seasonal, x="season", y="vtec", color="station", barmode="group",
                     labels={"vtec": "Mean VTEC (TECU)", "season": "Season"},
                     title="Seasonal VTEC Variation")
    fig_sea.update_layout(paper_bgcolor="#060d1a", plot_bgcolor="#0d1b2a",
                          font_color="#ffffff", yaxis=dict(gridcolor="#1e3a5f"),
                          xaxis=dict(gridcolor="#1e3a5f"), height=320,
                          legend=dict(bgcolor="#0d1b2a", bordercolor="#1e3a5f"))
    st.plotly_chart(fig_sea, use_container_width=True)

    # DOY heatmap (station × doy)
    if len(sel_stations) >= 1:
        doy_pivot = fdf.groupby(["station", "doy"])["vtec"].mean().unstack("doy")
        fig_heat = px.imshow(
            doy_pivot.values,
            x=doy_pivot.columns.tolist(),
            y=doy_pivot.index.tolist(),
            color_continuous_scale=[[0,"#000080"],[0.3,"#0080ff"],[0.6,"#00ff80"],[0.85,"#ff8000"],[1,"#ff0000"]],
            labels={"x": "Day of Year", "y": "Station", "color": "VTEC"},
            title="VTEC Heatmap: Station × Day of Year",
        )
        fig_heat.update_layout(paper_bgcolor="#060d1a", font_color="#ffffff", height=280)
        st.plotly_chart(fig_heat, use_container_width=True)

# ── Tab 4: Diurnal ───────────────────────────────────────────────────────────
with tab4:
    if "timestamp" in fdf.columns:
        fdf["hour"] = pd.to_datetime(fdf["timestamp"]).dt.hour
    elif "time_hours" in fdf.columns:
        fdf["hour"] = fdf["time_hours"].astype(int) % 24
    else:
        fdf["hour"] = 12  # fallback
    diurnal = fdf.groupby(["hour", "station"])["vtec"].mean().reset_index()
    fig_d = px.line(
        diurnal, x="hour", y="vtec", color="station", markers=True,
        labels={"vtec": "VTEC (TECU)", "hour": "Hour (UTC)"},
        title="Diurnal VTEC Variation (24-hour pattern)",
    )
    fig_d.update_layout(paper_bgcolor="#060d1a", plot_bgcolor="#0d1b2a",
                        font_color="#ffffff", yaxis=dict(gridcolor="#1e3a5f"),
                        xaxis=dict(gridcolor="#1e3a5f", dtick=2), height=360,
                        legend=dict(bgcolor="#0d1b2a", bordercolor="#1e3a5f"))
    st.plotly_chart(fig_d, use_container_width=True)
    st.caption("Peak TEC typically occurs around 14:00–16:00 LT over Zimbabwe (UTC+2).")
