"""GOP-style VTEC summary charts — axis adapts to day / month / year processing mode."""
from __future__ import annotations

from typing import Tuple

import pandas as pd
import plotly.graph_objects as go


_DARK = dict(
    paper_bgcolor="#000000",
    plot_bgcolor="#000000",
    font_color="#ffffff",
    yaxis=dict(title="VTEC (TECU)", gridcolor="#244d73"),
    xaxis=dict(gridcolor="#244d73"),
    height=300,
    margin=dict(t=44, b=10, l=50, r=20),
    showlegend=False,
)

_CHART_SPECS = (
    ("daytime_mean_vtec", "Mean VTEC (6 AM – 6 PM)", "#ff8c00"),
    ("max_vtec", "Maximum VTEC", "#ff4444"),
    ("mean_vtec", "Mean VTEC (24-hour)", "#168bd2"),
    ("min_vtec", "Minimum VTEC", "#00ff88"),
)


def _hourly_frame(all_df: pd.DataFrame) -> pd.DataFrame:
    """Per-UT-hour VTEC stats (GOP-style: mean across PRNs per epoch, then per hour)."""
    temp = all_df.copy()
    temp["timestamp"] = pd.to_datetime(temp["timestamp"], errors="coerce")
    temp = temp.dropna(subset=["timestamp", "vtec"])
    if temp.empty:
        return pd.DataFrame(columns=["x", "daytime_mean_vtec", "max_vtec", "mean_vtec", "min_vtec"])

    time_means = (
        temp.groupby("timestamp", as_index=False)
        .agg(vtec=("vtec", "mean"))
        .sort_values("timestamp")
    )
    ut_hour = (
        time_means["timestamp"].dt.hour
        + time_means["timestamp"].dt.minute / 60.0
        + time_means["timestamp"].dt.second / 3600.0
    )
    time_means["ut_hour"] = ut_hour
    hourly = (
        time_means.groupby(time_means["ut_hour"].round().astype(int), as_index=False)
        .agg(
            mean_vtec=("vtec", "mean"),
            max_vtec=("vtec", "max"),
            min_vtec=("vtec", "min"),
        )
        .rename(columns={"ut_hour": "x"})
        .sort_values("x")
    )
    hourly["daytime_mean_vtec"] = hourly["mean_vtec"].where(
        hourly["x"].between(6, 18, inclusive="both")
    )
    return hourly


def _daily_frame(daily_st: pd.DataFrame) -> pd.DataFrame:
    """Collapse station-level daily stats to one row per calendar day."""
    if daily_st.empty:
        return pd.DataFrame(columns=["x", "daytime_mean_vtec", "max_vtec", "mean_vtec", "min_vtec", "x_label"])
    temp = daily_st.copy()
    temp["date"] = pd.to_datetime(temp["date"], errors="coerce")
    agg = (
        temp.groupby("date", as_index=False)
        .agg(
            daytime_mean_vtec=("daytime_mean_vtec", "mean"),
            mean_vtec=("mean_vtec", "mean"),
            max_vtec=("max_vtec", "max"),
            min_vtec=("min_vtec", "min"),
        )
        .sort_values("date")
    )
    agg["x"] = agg["date"].dt.day
    agg["x_label"] = agg["date"].dt.strftime("%d %b")
    return agg


def _monthly_frame(daily_st: pd.DataFrame) -> pd.DataFrame:
    """One row per calendar month."""
    if daily_st.empty:
        return pd.DataFrame(columns=["x", "daytime_mean_vtec", "max_vtec", "mean_vtec", "min_vtec", "x_label"])
    temp = daily_st.copy()
    temp["date"] = pd.to_datetime(temp["date"], errors="coerce")
    temp["month"] = temp["date"].dt.to_period("M")
    agg = (
        temp.groupby("month", as_index=False)
        .agg(
            daytime_mean_vtec=("daytime_mean_vtec", "mean"),
            mean_vtec=("mean_vtec", "mean"),
            max_vtec=("max_vtec", "max"),
            min_vtec=("min_vtec", "min"),
        )
        .sort_values("month")
    )
    agg["x"] = range(1, len(agg) + 1)
    agg["x_label"] = agg["month"].astype(str)
    return agg


def _yearly_frame(daily_st: pd.DataFrame) -> pd.DataFrame:
    """One row per calendar year."""
    if daily_st.empty:
        return pd.DataFrame(columns=["x", "daytime_mean_vtec", "max_vtec", "mean_vtec", "min_vtec", "x_label"])
    temp = daily_st.copy()
    temp["date"] = pd.to_datetime(temp["date"], errors="coerce")
    temp["year"] = temp["date"].dt.year
    agg = (
        temp.groupby("year", as_index=False)
        .agg(
            daytime_mean_vtec=("daytime_mean_vtec", "mean"),
            mean_vtec=("mean_vtec", "mean"),
            max_vtec=("max_vtec", "max"),
            min_vtec=("min_vtec", "min"),
        )
        .sort_values("year")
    )
    agg["x"] = agg["year"]
    agg["x_label"] = agg["year"].astype(str)
    return agg


def prepare_vtec_chart_data(
    all_df: pd.DataFrame,
    daily_st: pd.DataFrame,
    processing_mode: str,
) -> Tuple[pd.DataFrame, str, str]:
    """
    Return (chart_dataframe, x_axis_title, mode_label) for the four VTEC summary plots.

    Axis mapping (per GOP / user spec):
      - This Day only  → UT hours
      - This Month     → months (daily fallback when only one month in data)
      - This Year      → years  (monthly fallback when only one year in data)
      - Directory      → years, or months if a single year
    """
    if processing_mode == "This Day only":
        return _hourly_frame(all_df), "UT Hour", "Day"

    if processing_mode == "This Month":
        monthly = _monthly_frame(daily_st)
        if len(monthly) > 1:
            return monthly, "Month", "Month"
        return _daily_frame(daily_st), "Day of Month", "Month (daily)"

    if processing_mode == "This Year":
        yearly = _yearly_frame(daily_st)
        if len(yearly) > 1:
            return yearly, "Year", "Year"
        return _monthly_frame(daily_st), "Month", "Year (monthly)"

    temp = daily_st.copy()
    if not temp.empty:
        years = pd.to_datetime(temp["date"], errors="coerce").dt.year.nunique()
        if years > 1:
            return _yearly_frame(daily_st), "Year", "Directory"
    return _monthly_frame(daily_st), "Month", "Directory"


def _make_chart(
    frame: pd.DataFrame,
    y_col: str,
    title: str,
    color: str,
    x_title: str,
    *,
    daytime_only: bool = False,
) -> go.Figure:
    fig = go.Figure()
    if frame.empty or y_col not in frame.columns:
        fig.add_annotation(
            text="No VTEC data for this selection",
            xref="paper", yref="paper", x=0.5, y=0.5,
            showarrow=False, font=dict(color="#ffffff", size=13),
        )
        fig.update_layout(**_DARK, title=title)
        return fig

    plot_df = frame.copy()
    if daytime_only:
        plot_df = plot_df[plot_df["x"].between(6, 18, inclusive="both")]
        plot_df = plot_df.dropna(subset=[y_col])
    else:
        plot_df = plot_df.dropna(subset=[y_col])

    x_vals = plot_df["x_label"] if "x_label" in plot_df.columns and plot_df["x_label"].notna().any() else plot_df["x"]

    fig.add_trace(go.Scatter(
        x=x_vals,
        y=plot_df[y_col],
        mode="lines+markers",
        line=dict(color=color, width=2.5),
        marker=dict(size=7, color=color),
        name=title,
    ))
    layout = {**_DARK, "title": dict(text=title, font=dict(size=14, color="#ffffff"))}
    layout["xaxis"] = {**_DARK["xaxis"], "title": x_title}
    fig.update_layout(**layout)
    return fig


def build_vtec_summary_figures(
    all_df: pd.DataFrame,
    daily_st: pd.DataFrame,
    processing_mode: str,
) -> Tuple[list[go.Figure], str]:
    """Build the four GOP VTEC summary figures."""
    frame, x_title, mode_label = prepare_vtec_chart_data(all_df, daily_st, processing_mode)
    figures = []
    for y_col, title, color in _CHART_SPECS:
        daytime_only = y_col == "daytime_mean_vtec" and processing_mode == "This Day only"
        figures.append(
            _make_chart(frame, y_col, title, color, x_title, daytime_only=daytime_only)
        )
    return figures, mode_label


def render_vtec_summary_charts(
    st,
    all_df: pd.DataFrame,
    daily_st: pd.DataFrame,
    processing_mode: str,
) -> None:
    """Render the four VTEC summary charts in a 2×2 grid."""
    figures, mode_label = build_vtec_summary_figures(all_df, daily_st, processing_mode)
    st.subheader("VTEC Summary Graphs")
    st.caption(
        f"GOP-style VTEC statistics for **{mode_label}** processing "
        f"({figures[0].layout.xaxis.title.text if figures else 'N/A'} axis)"
    )
    row1_col1, row1_col2 = st.columns(2)
    row2_col1, row2_col2 = st.columns(2)
    with row1_col1:
        st.plotly_chart(figures[0], width="stretch", key="vtec_chart_daytime")
    with row1_col2:
        st.plotly_chart(figures[1], width="stretch", key="vtec_chart_max")
    with row2_col1:
        st.plotly_chart(figures[2], width="stretch", key="vtec_chart_mean")
    with row2_col2:
        st.plotly_chart(figures[3], width="stretch", key="vtec_chart_min")
