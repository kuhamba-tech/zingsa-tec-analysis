"""Tests for GIC EKF evaluation with space-weather cross-check."""
from __future__ import annotations

import unittest

import pandas as pd

from zgiis.gic.ekf_context import evaluate_gic_with_context
from zgiis.space_weather.ekf import run_ekf_series


def _steady_gic_points(n: int = 30, base: float = 5.0) -> list:
    pts = []
    for i in range(n):
        t = f"2024-06-01T12:{i:02d}:00+00:00"
        v = base + (0.01 * i)
        pts.append((t, v))
    return run_ekf_series(pts, "gic")


class GicEkfContextTests(unittest.TestCase):
    def test_evaluate_without_space_weather_returns_gic_status(self):
        ekf_points = _steady_gic_points()
        result = evaluate_gic_with_context(ekf_points, pd.DataFrame())
        self.assertIn("status", result)
        self.assertIn("alerts", result)
        self.assertIsInstance(result["alerts"], list)

    def test_cross_check_includes_sw_series_when_available(self):
        ekf_points = _steady_gic_points()
        sw_df = pd.DataFrame(
            {
                "time": pd.date_range("2024-06-01T12:00:00", periods=30, freq="min", tz="UTC"),
                "kp": [2.0 + 0.01 * i for i in range(30)],
                "dst": [-10.0 - i for i in range(30)],
                "s4": [0.1] * 30,
                "plasma_speed": [400.0] * 30,
            }
        )
        result = evaluate_gic_with_context(ekf_points, sw_df)
        for alert in result["alerts"]:
            self.assertEqual(alert.get("parameter"), "gic")


if __name__ == "__main__":
    unittest.main()
