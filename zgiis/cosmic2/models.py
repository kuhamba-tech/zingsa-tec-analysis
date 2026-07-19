"""Shared config and enums for the COSMIC-2 Zimbabwe research module (Phase 1)."""
from __future__ import annotations

from dataclasses import dataclass
from enum import Enum


class QualityStatus(str, Enum):
    OK = "ok"
    REJECTED = "rejected"


class MatchQuality(str, Enum):
    HIGH = "high"
    MEDIUM = "medium"
    LOW = "low"
    INVALID = "invalid"


@dataclass(frozen=True)
class Cosmic2Config:
    """Configurable defaults for Phase 1 geographic filtering, quality
    control, matching, and calibration."""

    # Broad southern-Africa research box (no GeoJSON boundary exists in this
    # repo to use instead).
    lat_min: float = -30.0
    lat_max: float = -10.0
    lon_min: float = 20.0
    lon_max: float = 40.0

    min_valid_samples: int = 20
    min_altitude_km: float = 150.0
    max_altitude_km_floor: float = 500.0

    max_match_distance_km: float = 500.0
    max_match_time_minutes: float = 30.0
    match_quality_high_km: float = 150.0
    match_quality_high_min: float = 10.0
    match_quality_medium_km: float = 300.0
    match_quality_medium_min: float = 20.0

    min_calibration_samples: int = 10

    # No background-job architecture this round — bound the synchronous
    # request instead.
    max_analyse_days: int = 5


DEFAULT_CONFIG = Cosmic2Config()
