"""EKF deviation evaluation for GIC with space-weather cross-checking."""
from __future__ import annotations

from typing import Any

import pandas as pd

from zgiis.space_weather.ekf import EkfPoint, run_ekf_series
from zgiis.space_weather.ekf_alerts import evaluate

_SW_EKF_COLS: dict[str, str] = {
    "kp": "kp",
    "dst": "dst",
    "s4": "s4",
    "solar_wind": "plasma_speed",
}


def _sw_points(sw_df: pd.DataFrame, col: str) -> list[tuple[str, float]]:
    if sw_df.empty or col not in sw_df.columns:
        return []
    pts: list[tuple[str, float]] = []
    for _, r in sw_df.iterrows():
        v = r.get(col)
        if v is None or (isinstance(v, float) and pd.isna(v)):
            continue
        t = r["time"]
        ts = t.isoformat() if hasattr(t, "isoformat") else str(t)
        pts.append((ts, float(v)))
    return pts


def evaluate_gic_with_context(
    gic_points: list[EkfPoint],
    sw_df: pd.DataFrame,
) -> dict[str, Any]:
    """Evaluate GIC EKF deviation with Kp/Dst/S4/solar-wind context for severity."""
    series_by_param: dict[str, list[EkfPoint]] = {"gic": gic_points}
    for param, col in _SW_EKF_COLS.items():
        pts = _sw_points(sw_df, col)
        if len(pts) >= 6:
            series_by_param[param] = run_ekf_series(pts, param)

    result = evaluate(series_by_param)
    gic_alerts = [a for a in result["alerts"] if a.get("parameter") == "gic"]
    return {
        "status": result["status"].get("gic"),
        "alerts": gic_alerts,
    }
