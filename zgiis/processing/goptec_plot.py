"""GPS_TEC-style 24-hour TEC plot series for API / Next.js charts."""
from __future__ import annotations

from typing import Any

import numpy as np
import pandas as pd

from zgiis.processing.plot_gaps import gap_break_indices


def _two_sigma_mean(values: pd.Series) -> float:
    """
    GOPI/GPS_TEC Chapter 4 mean TEC curve:
    two repeated sigma filters inside each 1-minute window, then mean.
    """
    cleaned = pd.to_numeric(values, errors="coerce").dropna()
    for _ in range(2):
        if len(cleaned) < 3:
            break
        mean = float(cleaned.mean())
        sigma = float(cleaned.std(ddof=0))
        if not np.isfinite(sigma) or sigma <= 0:
            break
        cleaned = cleaned[(cleaned >= mean - sigma) & (cleaned <= mean + sigma)]
    return float(cleaned.mean()) if len(cleaned) else float("nan")


def build_tec_plot_series(
    df: pd.DataFrame,
    *,
    value_col: str = "vtec",
    xlabel: str = "UT (hrs)",
) -> dict[str, Any]:
    """
    Build GOP-compatible multi-PRN TEC curves (arc filter, trim, gap breaks).
    Returns JSON-friendly points for the processing page chart.
    """
    if df is None or df.empty or value_col not in df.columns:
        return {"datasets": [], "mean": [], "xlabel": xlabel, "ylabel": "VTEC (TECU)"}

    plot_df = df.copy()
    plot_df["timestamp"] = pd.to_datetime(plot_df["timestamp"])
    plot_df["_x"] = (
        plot_df["timestamp"].dt.hour
        + plot_df["timestamp"].dt.minute / 60.0
        + plot_df["timestamp"].dt.second / 3600.0
    )

    min_arc = 10
    trim_n = 3
    datasets: list[dict[str, Any]] = []
    mean_rows: list[dict[str, float]] = []

    for prn, grp in plot_df.groupby("prn"):
        grp = grp.sort_values("_x")
        x_arr = grp["_x"].to_numpy(dtype=float)
        y_arr = grp[value_col].to_numpy(dtype=float)

        gaps = gap_break_indices(x_arr, xlabel=xlabel)
        arc_s = np.concatenate([[0], gaps])
        arc_e = np.concatenate([gaps, [len(x_arr)]])

        points: list[dict[str, float | None]] = []
        for a0, a1 in zip(arc_s, arc_e):
            arc_len = int(a1 - a0)
            if arc_len < min_arc:
                continue

            ax = x_arr[a0:a1].copy()
            ay = y_arr[a0:a1].copy()
            trim = min(trim_n, arc_len // 5)
            ay[:trim] = np.nan
            ay[arc_len - trim :] = np.nan

            if points:
                points.append({"x": None, "y": None})
            for x_val, y_val in zip(ax, ay):
                if np.isfinite(y_val):
                    points.append({"x": float(x_val), "y": float(y_val)})
                    mean_rows.append({"x": float(x_val), "y": float(y_val)})
                else:
                    points.append({"x": float(x_val), "y": None})

        if points:
            datasets.append({"label": str(prn), "points": points})

    mean_bins: list[dict[str, float]] = []
    if mean_rows:
        mean_df = pd.DataFrame(mean_rows)
        mean_df["_minute"] = np.round(mean_df["x"] * 60.0).astype(int)
        bins = mean_df.groupby("_minute", observed=True)["y"].apply(_two_sigma_mean)
        for minute, val in bins.items():
            if val is not None and np.isfinite(val):
                mean_bins.append({"x": float(minute) / 60.0, "y": float(val)})

    return {
        "datasets": datasets[:12],
        "mean": mean_bins,
        "xlabel": xlabel,
        "ylabel": "VTEC (TECU)",
        "y_min": -25.0,
        "y_max": 75.0,
    }
