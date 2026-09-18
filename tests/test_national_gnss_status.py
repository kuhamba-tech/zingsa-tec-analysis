"""Tests for Zimbabwe National GNSS Status block."""
from __future__ import annotations

import unittest

from zgiis.navigation.gnss_forecast import GnssForecastCity
from zgiis.navigation.national_gnss_status import (
    build_national_gnss_status_block,
    storm_risk_label,
)
from zgiis.navigation.national_navigation_social import build_national_navigation_social


def _city(city: str, status: str, iono: float = 10.0, feed: float = 96.0) -> GnssForecastCity:
    return GnssForecastCity(
        city=city,
        emoji="🟢",
        status=status,  # type: ignore[arg-type]
        statusLabel=status.title(),
        fields=[],
        iono_stress=iono,
        feed_reliability=feed,
    )


class NationalGnssStatusTests(unittest.TestCase):
    def test_storm_risk_moderate_at_kp4(self) -> None:
        self.assertEqual(storm_risk_label({"kp": 4}), "Moderate")

    def test_status_block_includes_major_cities(self) -> None:
        from zgiis.navigation.gnss_forecast import FORECAST_SITES

        forecasts = [
            _city(site["city"], "excellent", iono=3.5, feed=96)
            for site in FORECAST_SITES
        ]
        for i, site in enumerate(FORECAST_SITES):
            if site["city"] == "VICTORIA FALLS":
                forecasts[i] = _city("VICTORIA FALLS", "warning", iono=60, feed=28)
                break
        text = build_national_gnss_status_block(forecasts, "moderate", {"kp": 4})
        self.assertIn("ZIMBABWE NATIONAL GNSS STATUS", text)
        for name in (
            "Harare",
            "Bulawayo",
            "Mutare",
            "Gweru",
            "Masvingo",
            "Kwekwe",
            "Kariba",
            "Victoria Falls",
            "Karoi",
            "Chivhu",
            "Chiredzi",
            "Beitbridge",
            "Binga",
            "Gokwe",
        ):
            self.assertIn(name, text, msg=f"missing city {name}")
        self.assertIn("10–20 cm", text)
        self.assertIn("Kp = 4", text)
        self.assertIn("Storm Risk = Moderate", text)
        self.assertIn("Aviation", text)
        self.assertIn("Advisory", text)

    def test_social_post_appends_status_block(self) -> None:
        forecasts = [_city("HARARE", "excellent")]
        text = build_national_navigation_social(
            "moderate",
            {"kp": 4},
            forecasts=forecasts,
        )
        self.assertIn("MODERATE GEOMAGNETIC STORM", text)
        self.assertIn("ZIMBABWE NATIONAL GNSS STATUS", text)


if __name__ == "__main__":
    unittest.main()
