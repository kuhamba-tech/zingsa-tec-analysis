"""Geomagnetic storm alert thresholds — aligned with KP/Dst index scales on the dashboard."""

from __future__ import annotations

from typing import Any, Literal

# Kp scale bands (see frontend/lib/geomagneticScales.ts KP_SCALE_ROW)
KP_ACTIVE = 4.0       # Active — possible storm watch
KP_STORM = 5.0        # G1 minor geomagnetic storm (NOAA)

# Dst scale bands (see DST_SCALE_ROW)
DST_MODERATE = -30.0  # Moderate disturbance — possible storm watch
DST_STORM = -50.0     # Intense storm threshold (used across ZGIIS charts)

ALERT_RULES: tuple[str, ...] = (
    "Possible geomagnetic storm: Kp ≥ 4 (active) or Dst ≤ −30 nT",
    "Geomagnetic storm: Kp ≥ 5 (G1+) or Dst ≤ −50 nT",
)

GeomagneticLevel = Literal["none", "possible", "storm"]


def classify_geomagnetic_activity(
    kp: float | None,
    dst: float | None,
) -> dict[str, Any]:
    """Classify live Kp/Dst into none, possible, or storm using official scale limits."""
    reasons: list[str] = []
    level: GeomagneticLevel = "none"

    storm = (kp is not None and kp >= KP_STORM) or (dst is not None and dst <= DST_STORM)
    if storm:
        level = "storm"
        if kp is not None and kp >= KP_STORM:
            reasons.append(f"Kp {kp:.0f} ≥ {KP_STORM:.0f} ({_kp_storm_label(kp)})")
        if dst is not None and dst <= DST_STORM:
            reasons.append(f"Dst {dst:.0f} nT ≤ {DST_STORM:.0f} nT")
    else:
        possible = (kp is not None and kp >= KP_ACTIVE) or (dst is not None and dst <= DST_MODERATE)
        if possible:
            level = "possible"
            if kp is not None and kp >= KP_ACTIVE:
                reasons.append(f"Kp {kp:.0f} ≥ {KP_ACTIVE:.0f} (active / unsettled)")
            if dst is not None and dst <= DST_MODERATE:
                reasons.append(f"Dst {dst:.0f} nT ≤ {DST_MODERATE:.0f} nT")

    headline = _headline(level, kp, dst)
    return {
        "level": level,
        "reasons": reasons,
        "headline": headline,
        "notify_key": _notify_key(level, kp, dst),
        "kp_storm_level": _kp_storm_label(kp) if kp is not None else None,
    }


def _kp_storm_label(kp: float) -> str | None:
    if kp >= 9:
        return "Extreme G5"
    if kp >= 8:
        return "Severe G4"
    if kp >= 7:
        return "Strong G3"
    if kp >= 6:
        return "Moderate G2"
    if kp >= 5:
        return "Minor G1"
    if kp >= 4:
        return "Active"
    if kp >= 3:
        return "Unsettled"
    return None


def geomagnetic_alert_messages(kp: float | None, dst: float | None) -> list[str]:
    messages: list[str] = []
    storm = (kp is not None and kp >= KP_STORM) or (dst is not None and dst <= DST_STORM)
    if storm:
        if kp is not None and kp >= KP_STORM:
            messages.append(
                f"🔴 Kp Index: {kp:.0f} — Geomagnetic storm in progress. "
                "GNSS, power, and navigation systems may be degraded."
            )
        if dst is not None and dst <= DST_STORM:
            dst_label = f"+{dst:.0f}" if dst >= 0 else f"{dst:.0f}"
            messages.append(
                f"🔴 Dst Index: {dst_label} nT — Geomagnetic storm threshold reached. "
                "Earth's magnetic field is strongly disturbed."
            )
        return messages
    if kp is not None and kp >= KP_ACTIVE:
        messages.append(
            f"🟠 Kp Index: {kp:.0f} — Geomagnetic activity is increasing. "
            "Possible storm conditions developing."
        )
    if dst is not None and dst <= DST_MODERATE:
        dst_label = f"+{dst:.0f}" if dst >= 0 else f"{dst:.0f}"
        messages.append(
            f"🟠 Dst Index: {dst_label} nT — Earth's magnetic field is becoming increasingly disturbed. "
            "Possible storm conditions developing."
        )
    return messages


def _headline(level: GeomagneticLevel, kp: float | None, dst: float | None) -> str | None:
    messages = geomagnetic_alert_messages(kp, dst)
    return " · ".join(messages) if messages else None


def _notify_key(level: GeomagneticLevel, kp: float | None, dst: float | None) -> str | None:
    if level == "none":
        return None
    kp_part = f"{int(kp)}" if kp is not None else "na"
    dst_part = f"{int(dst)}" if dst is not None else "na"
    return f"{level}|kp={kp_part}|dst={dst_part}"
