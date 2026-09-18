"""Official NOAA Kp to geomagnetic storm scale classification."""
from __future__ import annotations

from dataclasses import dataclass
import math


@dataclass(frozen=True)
class GeomagneticCondition:
    kp: float
    condition: str
    g_scale: str | None
    severity: str
    color: str
    summary: str

    @property
    def is_storm(self) -> bool:
        return self.g_scale is not None


def classify_kp(kp: float) -> GeomagneticCondition:
    """Classify Kp using NOAA's official G-scale thresholds."""
    value = float(kp)
    if not math.isfinite(value):
        raise ValueError("Kp must be a finite number.")

    value = max(0.0, min(value, 9.0))
    if value < 3:
        return GeomagneticCondition(
            value,
            "Quiet",
            None,
            "Quiet",
            "#00f5a0",
            "No geomagnetic storm. Nominal geomagnetic conditions.",
        )
    if value < 4:
        return GeomagneticCondition(
            value,
            "Unsettled",
            None,
            "Unsettled",
            "#7cff4f",
            "No geomagnetic storm. Monitor for changing geomagnetic activity.",
        )
    if value < 5:
        return GeomagneticCondition(
            value,
            "Active",
            None,
            "Active",
            "#f4f000",
            "Active geomagnetic conditions, but below the NOAA storm threshold.",
        )
    if value < 6:
        return GeomagneticCondition(
            value,
            "Minor Storm G1",
            "G1",
            "Minor",
            "#ff9800",
            "Minor storm: weak power-grid fluctuations and minor satellite effects are possible.",
        )
    if value < 7:
        return GeomagneticCondition(
            value,
            "Moderate Storm G2",
            "G2",
            "Moderate",
            "#ff6500",
            "Moderate storm: power-system voltage alarms and spacecraft orientation effects are possible.",
        )
    if value < 8:
        return GeomagneticCondition(
            value,
            "Strong Storm G3",
            "G3",
            "Strong",
            "#ff2b16",
            "Strong storm: intermittent satellite-navigation and HF-radio degradation is possible.",
        )
    if value < 9:
        return GeomagneticCondition(
            value,
            "Severe Storm G4",
            "G4",
            "Severe",
            "#d90062",
            "Severe storm: widespread navigation, radio, spacecraft and power-system impacts are possible.",
        )
    return GeomagneticCondition(
        value,
        "Extreme Storm G5",
        "G5",
        "Extreme",
        "#a000d4",
        "Extreme storm: severe power-grid, spacecraft, HF-radio and satellite-navigation impacts are possible.",
    )

