"""Quality control for COSMIC-2 ionPrf profiles.

Never silently discards a profile — every rejection reason is recorded so
the profile can still get a database row (with computed fields left null).
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from zgiis.cosmic2.models import Cosmic2Config
from zgiis.cosmic2.netcdf_reader import RawProfile

FILL_VALUE = -999.0
_ALTITUDE_JITTER_TOLERANCE_KM = 1e-6


@dataclass
class QualityResult:
    status: str  # "ok" | "rejected"
    reasons: list[str]
    valid_sample_count: int
    cleaned_altitude_km: np.ndarray | None
    cleaned_density_m3: np.ndarray | None


def _is_fill(values: np.ndarray) -> np.ndarray:
    return np.isclose(values, FILL_VALUE, atol=1e-3)


def evaluate_profile(raw: RawProfile, *, config: Cosmic2Config | None = None) -> QualityResult:
    config = config or Cosmic2Config()
    reasons: list[str] = []

    if raw.occ_time is None:
        reasons.append("invalid_timestamp")

    if not (np.isfinite(raw.tangent_lat) and np.isfinite(raw.tangent_lon)):
        reasons.append("invalid_location")
    elif not (-90.0 <= raw.tangent_lat <= 90.0 and -180.0 <= raw.tangent_lon <= 180.0):
        reasons.append("invalid_location")

    altitude = np.asarray(raw.altitude_km, dtype=float)
    density = np.asarray(raw.electron_density_m3, dtype=float)
    if altitude.shape != density.shape or altitude.size == 0:
        reasons.append("shape_mismatch_or_empty")
        return QualityResult("rejected", reasons, 0, None, None)

    valid_mask = (
        np.isfinite(altitude) & np.isfinite(density)
        & ~_is_fill(altitude) & ~_is_fill(density)
        & (density >= 0.0)
    )
    invalid_fraction = 1.0 - (float(np.sum(valid_mask)) / altitude.size)
    if invalid_fraction > 0.5:
        reasons.append("excess_invalid_density")

    cleaned_altitude = altitude[valid_mask]
    cleaned_density = density[valid_mask]
    if cleaned_altitude.size > 1:
        order = np.argsort(cleaned_altitude)
        cleaned_altitude = cleaned_altitude[order]
        cleaned_density = cleaned_density[order]
        diffs = np.diff(cleaned_altitude)
        if np.any(diffs < -_ALTITUDE_JITTER_TOLERANCE_KM):
            reasons.append("non_monotonic_altitude")

    valid_sample_count = int(cleaned_altitude.size)
    if valid_sample_count < config.min_valid_samples:
        reasons.append("insufficient_samples")

    if valid_sample_count > 0:
        if cleaned_altitude.min() > config.min_altitude_km:
            reasons.append("insufficient_altitude_coverage_bottom")
        if cleaned_altitude.max() < config.max_altitude_km_floor:
            reasons.append("insufficient_altitude_coverage_top")

    status = "rejected" if reasons else "ok"
    return QualityResult(
        status=status,
        reasons=reasons,
        valid_sample_count=valid_sample_count,
        cleaned_altitude_km=cleaned_altitude if valid_sample_count > 0 else None,
        cleaned_density_m3=cleaned_density if valid_sample_count > 0 else None,
    )
