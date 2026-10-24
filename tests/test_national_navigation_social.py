"""Tests for national Navigation News social templates."""
from __future__ import annotations

import unittest

from zgiis.navigation.national_navigation_social import (
    build_national_navigation_social,
    resolve_storm_social_tier,
)


class NationalNavigationSocialTests(unittest.TestCase):
    def test_mild_tier_when_excellent(self) -> None:
        self.assertEqual(resolve_storm_social_tier("excellent", None), "mild")
        text = build_national_navigation_social("excellent", None)
        self.assertIn("Mild space weather", text)
        self.assertIn("ZINGSA Navigation Update", text)
        self.assertNotIn("ZIMBABWE NATIONAL GNSS STATUS", text)

    def test_moderate_tier(self) -> None:
        self.assertEqual(resolve_storm_social_tier("moderate", {"kp": 5}), "moderate")
        text = build_national_navigation_social("moderate", {"kp": 5})
        self.assertIn("Moderate space weather", text)

    def test_severe_tier_on_warning(self) -> None:
        self.assertEqual(resolve_storm_social_tier("warning", {"kp": 7}), "severe")
        text = build_national_navigation_social("warning", {"kp": 7})
        self.assertIn("Severe space weather", text)

    def test_extreme_tier_on_high_kp(self) -> None:
        self.assertEqual(resolve_storm_social_tier("warning", {"kp": 8, "dst": -80}), "extreme")
        text = build_national_navigation_social("warning", {"kp": 8})
        self.assertIn("Extreme space weather", text)


if __name__ == "__main__":
    unittest.main()
