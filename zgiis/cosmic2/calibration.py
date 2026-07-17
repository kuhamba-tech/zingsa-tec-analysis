"""OLS calibration: CORS_VTEC = slope * COSMIC_partial_TEC + intercept.

Hand-rolled with numpy (np.polyfit) rather than adding scipy/scikit-learn as
a new dependency for a single linear fit. Robust regression (Huber,
Theil-Sen) is explicitly deferred to a later round.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np


@dataclass
class CalibrationResult:
    slope: float | None
    intercept: float | None
    r_squared: float | None
    pearson_r: float | None
    rmse_tecu: float | None
    mae_tecu: float | None
    mean_bias_tecu: float | None
    sample_count: int
    status: str  # "ok" | "insufficient_samples"
    message: str


def fit_ols_calibration(
    cosmic_partial_tec: np.ndarray, cors_vtec: np.ndarray, *, min_samples: int = 10
) -> CalibrationResult:
    x = np.asarray(cosmic_partial_tec, dtype=float)
    y = np.asarray(cors_vtec, dtype=float)
    mask = np.isfinite(x) & np.isfinite(y)
    x, y = x[mask], y[mask]
    n = int(x.size)

    if n < min_samples:
        return CalibrationResult(
            slope=None, intercept=None, r_squared=None, pearson_r=None,
            rmse_tecu=None, mae_tecu=None, mean_bias_tecu=None, sample_count=n,
            status="insufficient_samples",
            message=f"Insufficient matched profiles for reliable calibration ({n} of {min_samples} required).",
        )

    slope, intercept = np.polyfit(x, y, 1)
    predicted = slope * x + intercept
    residuals = y - predicted

    ss_res = float(np.sum(residuals ** 2))
    ss_tot = float(np.sum((y - np.mean(y)) ** 2))
    r_squared = 1.0 - (ss_res / ss_tot) if ss_tot > 0 else None

    pearson_r = float(np.corrcoef(x, y)[0, 1]) if np.std(x) > 0 and np.std(y) > 0 else None
    rmse = float(np.sqrt(np.mean(residuals ** 2)))
    mae = float(np.mean(np.abs(residuals)))
    mean_bias = float(np.mean(residuals))

    return CalibrationResult(
        slope=float(slope), intercept=float(intercept), r_squared=r_squared, pearson_r=pearson_r,
        rmse_tecu=rmse, mae_tecu=mae, mean_bias_tecu=mean_bias, sample_count=n,
        status="ok", message=f"OLS calibration fit from {n} matched profile(s).",
    )
