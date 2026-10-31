"""One elevation mask for every TEC product on the platform.

Satellites below 30° take a long slant path and pick up multipath. Live GOPI,
Gg calibration, maps, station charts, gradients, and PRN views all keep an
elevation of at least 30°.
"""

ELEVATION_MIN_DEG = 30.0


def elevation_at_least_mask(elevation_deg: float | None) -> bool:
    """True when a measured elevation is allowed into a TEC product."""
    if elevation_deg is None:
        return False
    try:
        value = float(elevation_deg)
    except (TypeError, ValueError):
        return False
    return value == value and value >= ELEVATION_MIN_DEG
