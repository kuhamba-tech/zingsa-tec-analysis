"""Tests for AI sector recommendation engine."""
from __future__ import annotations

import unittest

from zgiis.navigation.ai_recommendations import build_ai_recommendations
from zgiis.navigation.gnss_forecast import GnssForecastCity


def _city(city: str, status: str, iono: float = 8.0, feed: float = 96.0) -> GnssForecastCity:
    return GnssForecastCity(
        city=city,
        emoji="🟢",
        status=status,  # type: ignore[arg-type]
        statusLabel=status.title(),
        fields=[
            {"label": "Best Survey Window", "value": "07:00 – 11:00"},
            {"label": "Expected Accuracy", "value": "1–2 cm"},
            {"label": "RTK Reliability", "value": "Good"},
        ],
        iono_stress=iono,
        feed_reliability=feed,
    )


class AiRecommendationsTests(unittest.TestCase):
    def test_calm_day_recommendations(self) -> None:
        forecasts = [
            _city("HARARE", "excellent"),
            _city("MUTARE", "excellent"),
        ]
        sw = {"kp": 1.0, "dst": -10, "s4": 0.05}
        out = build_ai_recommendations(forecasts, sw, computed_at="2026-07-06T12:00:00Z")
        by_id = {r["id"]: r for r in out["recommendations"]}

        self.assertEqual(by_id["surveyors"]["headline"], "Proceed.")
        self.assertEqual(
            by_id["surveyors"]["detail"],
            "Expected accuracy 1–2 cm · RTK Good · Window 07:00 – 11:00",
        )
        self.assertEqual(by_id["farmers"]["headline"], "Good day for precision planting.")
        self.assertEqual(by_id["power"]["headline"], "No GIC warning.")
        self.assertEqual(by_id["telecom"]["headline"], "Timing stable.")

    def test_moderate_storm_pilot_note(self) -> None:
        forecasts = [_city("HARARE", "moderate", iono=35, feed=72)]
        sw = {"kp": 4.0, "dst": -45, "s4": 0.2}
        out = build_ai_recommendations(forecasts, sw)
        pilots = next(r for r in out["recommendations"] if r["id"] == "pilots")
        self.assertIn("18:00", pilots["detail"] or "")


if __name__ == "__main__":
    unittest.main()
