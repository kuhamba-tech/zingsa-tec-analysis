"""Professional daily VTEC summary chart formatting."""
from __future__ import annotations

import pandas as pd
import plotly.graph_objects as go


def build_daily_vtec_chart(
    data: pd.DataFrame,
    column: str,
    title: str,
    color: str,
    *,
    height: int = 300,
) -> go.Figure:
    """Build a labelled daily VTEC chart using the application dark theme."""
    frame = data.dropna(subset=[column]).copy()
    frame["date"] = pd.to_datetime(frame["date"], errors="coerce")
    frame = frame.dropna(subset=["date"]).sort_values("date")

    fig = go.Figure()
    fig.add_scatter(
        x=frame["date"],
        y=frame[column],
        mode="lines+markers",
        line=dict(color=color, width=2.5),
        marker=dict(size=7, color=color, line=dict(color="#ffffff", width=1)),
        name=title,
        hovertemplate=(
            "<b>%{x|%d %B %Y}</b><br>"
            + title
            + ": %{y:.2f} TECU<extra></extra>"
        ),
    )
    if "kp_storm_flag" in frame.columns:
        storms = frame[frame["kp_storm_flag"].fillna(False)].copy()
        if not storms.empty:
            storm_labels = storms.apply(
                lambda row: (
                    f"Kp {row['kp_index']:.1f} · {row['kp_condition']}"
                    if pd.notna(row.get("kp_index"))
                    else str(row.get("kp_condition") or "Geomagnetic storm")
                ),
                axis=1,
            )
            fig.add_scatter(
                x=storms["date"],
                y=storms[column],
                mode="markers",
                marker=dict(
                    size=13,
                    color="#ff4444",
                    symbol="diamond",
                    line=dict(color="#ffffff", width=1.5),
                ),
                name="NOAA Kp storm (Kp >= 5)",
                customdata=storm_labels,
                hovertemplate=(
                    "<b>%{x|%d %B %Y}</b><br>"
                    + title
                    + ": %{y:.2f} TECU<br>%{customdata}<extra></extra>"
                ),
            )
    fig.update_layout(
        title=dict(
            text=title,
            x=0.02,
            font=dict(color="#ffffff", size=15, family="Arial"),
        ),
        xaxis=dict(
            title=dict(text="Date", font=dict(color="#ffffff", size=13)),
            tickformat="%d %b",
            tickfont=dict(color="#ffffff", size=11),
            gridcolor="#29415f",
            showgrid=True,
            zeroline=False,
            linecolor="#94a3b8",
            linewidth=1.5,
            showline=True,
            mirror=True,
            automargin=True,
        ),
        yaxis=dict(
            title=dict(text="VTEC (TECU)", font=dict(color="#ffffff", size=13)),
            rangemode="tozero",
            tickfont=dict(color="#ffffff", size=11),
            gridcolor="#29415f",
            showgrid=True,
            zeroline=True,
            zerolinecolor="#475569",
            linecolor="#94a3b8",
            linewidth=1.5,
            showline=True,
            mirror=True,
            automargin=True,
        ),
        legend=dict(
            orientation="h",
            x=0.01,
            y=1.02,
            xanchor="left",
            yanchor="bottom",
            bgcolor="rgba(13,27,42,0.85)",
            bordercolor="#1e3a5f",
            borderwidth=1,
            font=dict(color="#ffffff", size=11),
        ),
        plot_bgcolor="#0d1b2a",
        paper_bgcolor="#060d1a",
        font=dict(color="#ffffff", family="Arial"),
        showlegend=True,
        height=height,
        margin=dict(t=82, b=62, l=72, r=20),
        hoverlabel=dict(
            bgcolor="#0d1b2a",
            bordercolor=color,
            font=dict(color="#ffffff"),
        ),
    )
    return fig
