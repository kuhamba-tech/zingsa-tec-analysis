"""Configurable thresholds for the ZINGSA Space Weather Advisory Centre.

These are preliminary screening thresholds for operational advisories.
They are subject to scientific validation against historical Zimbabwe GNSS
measurements before being treated as national warning standards.
"""
from __future__ import annotations

from typing import Any

# Solar-wind / IMF watch screening (NOT storm confirmation).
WIND_WATCH_KMS = 500.0
WIND_STRONG_WATCH_KMS = 700.0
BZ_SOUTH_WATCH_NT = -5.0
BZ_SOUTH_STRONG_NT = -10.0
BT_ELEVATED_NT = 10.0
DENSITY_ELEVATED_CM3 = 10.0

# Geomagnetic (observed Kp → NOAA G-scale mapping).
KP_G1 = 5.0
KP_G2 = 6.0
KP_G3 = 7.0
DST_STORM_NT = -50.0
DST_STRONG_NT = -100.0

# Local Zimbabwe GNSS screening (provisional until ΔTEC/ROTI calibrated).
VTEC_WATCH_TECU = 40.0
S4_WATCH = 0.35
S4_WARNING = 0.50
S4_SEVERE = 0.70

# Data quality
MAX_OBS_AGE_MINUTES = 45.0
REVIEW_MINUTES = 30

LEVEL_RANK = {"GREEN": 0, "YELLOW": 1, "ORANGE": 2, "RED": 3}
LEVEL_LABEL = {
    "GREEN": "NORMAL",
    "YELLOW": "ELEVATED SPACE WEATHER WATCH",
    "ORANGE": "GEOMAGNETIC STORM / GNSS DISTURBANCE WARNING",
    "RED": "SEVERE SPACE WEATHER ALERT",
}

STAKEHOLDER_IDS = (
    "surveying",
    "aviation",
    "satellite",
    "telecom",
    "power",
)


def as_dict() -> dict[str, Any]:
    return {
        "wind_watch_kms": WIND_WATCH_KMS,
        "wind_strong_watch_kms": WIND_STRONG_WATCH_KMS,
        "bz_south_watch_nt": BZ_SOUTH_WATCH_NT,
        "bz_south_strong_nt": BZ_SOUTH_STRONG_NT,
        "bt_elevated_nt": BT_ELEVATED_NT,
        "density_elevated_cm3": DENSITY_ELEVATED_CM3,
        "kp_g1": KP_G1,
        "kp_g2": KP_G2,
        "kp_g3": KP_G3,
        "dst_storm_nt": DST_STORM_NT,
        "dst_strong_nt": DST_STRONG_NT,
        "vtec_watch_tecu": VTEC_WATCH_TECU,
        "s4_watch": S4_WATCH,
        "s4_warning": S4_WARNING,
        "s4_severe": S4_SEVERE,
        "max_obs_age_minutes": MAX_OBS_AGE_MINUTES,
        "review_minutes": REVIEW_MINUTES,
        "note": (
            "Preliminary ZINGSA advisory thresholds. Solar wind >500 km/s alone "
            "never confirms a geomagnetic storm. G1/G2 are not severe. Local GNSS "
            "disturbance is tracked separately from NOAA G-scale."
        ),
    }
