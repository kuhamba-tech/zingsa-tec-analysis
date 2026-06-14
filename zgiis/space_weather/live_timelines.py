"""Live NOAA-style timeline charts — shared Kp chart format for Space Weather."""
from __future__ import annotations

from typing import Any, Optional

import pandas as pd
import plotly.graph_objects as go


def _to_timeline_df(
    rows: list[dict],
    *,
    time_key: str,
    value_key: str,
    hours: int = 6,
) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=["time", "value"])
    df = pd.DataFrame(rows)
    if time_key not in df.columns or value_key not in df.columns:
        return pd.DataFrame(columns=["time", "value"])
    df = df.rename(columns={time_key: "time", value_key: "value"})
    df["time"] = pd.to_datetime(df["time"], errors="coerce", utc=True)
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    df = df.dropna(subset=["time", "value"]).sort_values("time")
    if df.empty:
        return df
    latest = df["time"].max()
    window_start = latest - pd.Timedelta(hours=hours)
    return df[df["time"] >= window_start].copy()


def build_timeline_figure(
    df: pd.DataFrame,
    *,
    y_title: str,
    line_color: str = "#00d4ff",
    y_range: Optional[tuple[float, float]] = None,
    zones: Optional[list[tuple[float, float, str]]] = None,
    threshold: Optional[tuple[float, str, str]] = None,
    line_shape: str = "hv",
    hover_format: str = "%{y:.2f}",
) -> go.Figure:
    fig = go.Figure()
    if zones:
        for y0, y1, color in zones:
            fig.add_hrect(y0=y0, y1=y1, fillcolor=color, opacity=0.55, line_width=0)
    fig.add_scatter(
        x=df["time"],
        y=df["value"],
        mode="lines",
        line=dict(color=line_color, width=2, shape=line_shape),
        hovertemplate="%{x|%d %b %H:%M UTC}<br>"
        + y_title
        + "="
        + hover_format
        + "<extra></extra>",
    )
    if threshold is not None:
        y_val, label, color = threshold
        fig.add_hline(
            y=y_val,
            line_dash="dash",
            line_color=color,
            annotation_text=label,
            annotation_font_color=color,
            annotation_position="top left",
        )
    yaxis: dict[str, Any] = {
        "title": dict(text=y_title, font=dict(color="#ffffff")),
        "gridcolor": "#1e3a5f",
        "tickfont": dict(color="#ffffff"),
    }
    if y_range is not None:
        yaxis["range"] = list(y_range)
    fig.update_layout(
        paper_bgcolor="#060d1a",
        plot_bgcolor="#0d1b2a",
        font_color="#ffffff",
        yaxis=yaxis,
        xaxis=dict(
            title=dict(text="UTC", font=dict(color="#ffffff")),
            gridcolor="#1e3a5f",
            tickfont=dict(color="#ffffff"),
            tickformat="%H:%M",
        ),
        height=280,
        margin=dict(t=20, b=10),
        showlegend=False,
    )
    return fig


def render_live_timeline(
    st_module,
    *,
    title: str,
    rows: list[dict],
    time_key: str,
    value_key: str,
    source: str,
    y_title: str,
    line_color: str = "#00d4ff",
    y_range: Optional[tuple[float, float]] = None,
    zones: Optional[list[tuple[float, float, str]]] = None,
    threshold: Optional[tuple[float, str, str]] = None,
    line_shape: str = "hv",
    hover_format: str = "%{y:.2f}",
    hours: int = 6,
    unavailable_msg: str = "Live history is currently unavailable.",
) -> None:
    st_module.subheader(title)
    df = _to_timeline_df(rows, time_key=time_key, value_key=value_key, hours=hours)
    if df.empty:
        st_module.warning(unavailable_msg)
        return
    fig = build_timeline_figure(
        df,
        y_title=y_title,
        line_color=line_color,
        y_range=y_range,
        zones=zones,
        threshold=threshold,
        line_shape=line_shape,
        hover_format=hover_format,
    )
    st_module.plotly_chart(fig, use_container_width=True)
    st_module.caption(f"{source} · {len(df)} points · last {hours} hours.")


def render_all_live_metric_timelines(st_module, sw: dict) -> None:
    """Live Metric Timelines block — NOAA feeds and derived indices (last 6 h UTC)."""
    from zgiis.space_weather.fetch_indices import _parse_kp_value

    st_module.markdown("### Live Metric Timelines")
    st_module.caption("Real-time NOAA feeds and derived indices — last 6 hours (UTC)")

    kp_points = [
        {"time_tag": row.get("time_tag"), "kp": _parse_kp_value(row)}
        for row in (sw.get("kp_history") or [])
        if isinstance(row, dict) and row.get("time_tag")
    ]

    render_live_timeline(
        st_module,
        title="Live NOAA Kp Timeline",
        rows=kp_points,
        time_key="time_tag",
        value_key="kp",
        source="Source: NOAA SWPC Planetary K-index 1-minute feed",
        y_title="Kp Index",
        y_range=(0, 9),
        zones=[
            (0, 3, "#001a08"),
            (3, 5, "#1a1a00"),
            (5, 7, "#1a0800"),
            (7, 9, "#1a0010"),
        ],
        threshold=(5, "Storm threshold (5)", "#ff8c00"),
    )

    render_live_timeline(
        st_module,
        title="Live NOAA Dst Timeline",
        rows=sw.get("dst_history") or [],
        time_key="time_tag",
        value_key="dst",
        source="Source: NOAA SWPC Kyoto Dst index (hourly)",
        y_title="Dst (nT)",
        y_range=(-150, 30),
        zones=[
            (-150, -100, "#1a0010"),
            (-100, -50, "#1a0800"),
            (-50, -20, "#1a1a00"),
            (-20, 30, "#001a08"),
        ],
        threshold=(-50, "Storm threshold (-50 nT)", "#ff8c00"),
        hover_format="%{y:+.0f}",
    )

    render_live_timeline(
        st_module,
        title="Live NOAA F10.7 Solar Flux Timeline",
        rows=sw.get("f107_history") or [],
        time_key="time_tag",
        value_key="flux",
        source="Source: NOAA SWPC F10.7 cm flux feed",
        y_title="F10.7 (sfu)",
        y_range=(80, 220),
        zones=[
            (80, 100, "#001a08"),
            (100, 150, "#001a14"),
            (150, 200, "#1a1a00"),
            (200, 220, "#1a0800"),
        ],
        threshold=(150, "High activity (150 sfu)", "#ff8c00"),
        hours=24,
    )

    render_live_timeline(
        st_module,
        title="Live NOAA Solar Wind Timeline",
        rows=sw.get("solar_wind_history") or [],
        time_key="time_tag",
        value_key="speed",
        source="Source: NOAA SWPC solar-wind plasma 1-day feed",
        y_title="Speed (km/s)",
        y_range=(300, 800),
        zones=[
            (300, 400, "#001a08"),
            (400, 600, "#1a1a00"),
            (600, 800, "#1a0800"),
        ],
        threshold=(500, "Fast stream (500 km/s)", "#ff8c00"),
        line_shape="linear",
    )

    render_live_timeline(
        st_module,
        title="Live Scintillation S4 Timeline",
        rows=sw.get("s4_history") or [],
        time_key="time_tag",
        value_key="s4",
        source="Source: ZINGSA CORS ionosphere archive — current observed snapshot held across Kp window",
        y_title="S4 Index",
        y_range=(0, 1),
        zones=[
            (0, 0.3, "#001a08"),
            (0.3, 0.5, "#1a1a00"),
            (0.5, 1, "#1a0800"),
        ],
        threshold=(0.5, "Severe scintillation (0.5)", "#ff8c00"),
        unavailable_msg="No observed S4 archive value is available for the timeline.",
    )

    render_live_timeline(
        st_module,
        title="Live GNSS Risk Timeline",
        rows=sw.get("gnss_risk_history") or [],
        time_key="time_tag",
        value_key="risk_score",
        source="Source: Derived from NOAA Kp feed using ZINGSA GNSS risk thresholds",
        y_title="Risk level",
        y_range=(-0.2, 3.2),
        zones=[
            (0, 1, "#001a08"),
            (1, 2, "#1a1a00"),
            (2, 3.2, "#1a0800"),
        ],
        threshold=(2, "High risk (2)", "#ff8c00"),
        hover_format="%{y:.0f}",
    )

    total_stations = sw.get("stations_total") or 24
    render_live_timeline(
        st_module,
        title="Live CORS Stations Online Timeline",
        rows=sw.get("stations_online_history") or [],
        time_key="time_tag",
        value_key="online",
        source="Source: ZINGSA CORS station-health — current live count held across Kp window",
        y_title="Stations online",
        y_range=(0, max(total_stations, 1)),
        zones=[
            (0, total_stations * 0.5, "#1a0800"),
            (total_stations * 0.5, total_stations * 0.7, "#1a1a00"),
            (total_stations * 0.7, total_stations, "#001a08"),
        ],
        threshold=(total_stations * 0.7, "Coverage watch (70%)", "#ff8c00"),
        hover_format="%{y:.0f}",
        unavailable_msg="Live CORS telemetry is unavailable — no station count timeline.",
    )
