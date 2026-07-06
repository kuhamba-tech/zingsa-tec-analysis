"""Zimbabwe National GNSS Status block — live city accuracy + services readout."""
from __future__ import annotations

from typing import Any

from zgiis.navigation.gnss_forecast import (
    FORECAST_SITES,
    ForecastStatus,
    GnssForecastCity,
    _expected_accuracy,
)

NATIONAL_GNSS_CITY_ORDER = [site["city"] for site in FORECAST_SITES]

_CITY_DISPLAY = {site["city"]: site["displayName"] for site in FORECAST_SITES}

_STATUS_EMOJI = {"excellent": "🟢", "moderate": "🟡", "warning": "🔴"}

_NATIONAL_SERVICES: dict[ForecastStatus, dict[str, str]] = {
    "excellent": {
        "Surveying": "Available",
        "Agriculture": "Excellent",
        "Mining": "Good",
        "Aviation": "Normal",
        "Power Grid": "Low Risk",
    },
    "moderate": {
        "Surveying": "Advisory",
        "Agriculture": "Excellent",
        "Mining": "Good",
        "Aviation": "Advisory",
        "Power Grid": "Low Risk",
    },
    "warning": {
        "Surveying": "Limited",
        "Agriculture": "Monitor",
        "Mining": "Caution",
        "Aviation": "Advisory",
        "Power Grid": "Moderate Risk",
    },
}


def storm_risk_label(sw: dict[str, Any] | None) -> str:
    if not sw or sw.get("kp") is None:
        return "Updating"
    kp = float(sw["kp"])
    if kp >= 7:
        return "Severe"
    if kp >= 5:
        return "High"
    if kp >= 4:
        return "Moderate"
    if kp >= 3:
        return "Unsettled"
    return "Low"


def _field(fc: GnssForecastCity, label: str) -> str | None:
    for f in fc.fields:
        if f.get("label") == label:
            return f.get("value")
    return None


def _city_accuracy_line(fc: GnssForecastCity) -> tuple[str, str]:
    emoji = _STATUS_EMOJI[fc.status]
    accuracy = _field(fc, "Expected Accuracy")
    if accuracy:
        return emoji, accuracy
    iono = fc.iono_stress if fc.iono_stress is not None else 50.0
    feed = fc.feed_reliability if fc.feed_reliability is not None else 50.0
    return emoji, _expected_accuracy(iono, feed)


def build_national_gnss_status_block(
    forecasts: list[GnssForecastCity],
    tone: ForecastStatus,
    sw: dict[str, Any] | None,
) -> str:
    """Return the 🇿🇼 ZIMBABWE NATIONAL GNSS STATUS block from live forecast inputs."""
    by_city = {f.city: f for f in forecasts}
    city_lines: list[str] = []
    for city_key in NATIONAL_GNSS_CITY_ORDER:
        fc = by_city.get(city_key)
        if fc is None:
            continue
        emoji, value = _city_accuracy_line(fc)
        name = _CITY_DISPLAY.get(city_key, city_key.title())
        city_lines.append(f"{emoji} {name}\n{value}")

    kp = sw.get("kp") if sw else None
    kp_line = f"Kp = {int(kp) if kp is not None and kp == int(kp) else kp}" if kp is not None else "Kp = Updating"
    storm_line = f"Storm Risk = {storm_risk_label(sw)}"
    services = _NATIONAL_SERVICES[tone]

    lines = [
        "🇿🇼 ZIMBABWE NATIONAL GNSS STATUS",
        "",
        "GNSS Accuracy Today",
        *city_lines,
        "",
        "Current Space Weather",
        kp_line,
        storm_line,
        "",
        "National Services",
    ]
    for service, label in services.items():
        lines.append(f"{service}\n{label}")

    return "\n".join(lines)
