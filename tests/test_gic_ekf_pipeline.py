"""Tests for GIC inclusion in the unified EKF status pipeline."""
from __future__ import annotations

import unittest
from unittest.mock import patch

from backend.schemas import TimelinePoint
from backend.timeline_builder import build_timelines
from zgiis.space_weather.ekf_service import compute_ekf_status


class GicEkfPipelineTests(unittest.TestCase):
    @patch("zgiis.gic.timeline.load_gic_timeline")
    def test_build_timelines_includes_gic_series(self, mock_load) -> None:
        mock_load.return_value = (
            "MARIMBA_001",
            [
                ("2024-06-01T10:00:00+00:00", 1.0),
                ("2024-06-01T11:00:00+00:00", 1.2),
            ],
        )
        tl = build_timelines({"kp": 2, "updated_utc": "2024-06-01T12:00:00+00:00"})
        self.assertGreaterEqual(len(tl.gic), 2)
        self.assertAlmostEqual(tl.gic[-1].v or 0, 1.2, places=3)

    @patch("zgiis.space_weather.ekf_service.build_timelines")
    def test_compute_ekf_status_exposes_gic_series(self, mock_build) -> None:
        from backend.schemas import SpaceWeatherTimelines

        gic_points = [
            TimelinePoint(t=f"2024-06-01T12:{i:02d}:00+00:00", v=2.0 + 0.05 * i)
            for i in range(10)
        ]
        mock_build.return_value = SpaceWeatherTimelines(gic=gic_points)

        status = compute_ekf_status({"kp": 2, "dst": -10}, dispatch_notifications=False)
        self.assertIn("gic", status.series)
        self.assertGreater(len(status.series["gic"].points), 0)


if __name__ == "__main__":
    unittest.main()
