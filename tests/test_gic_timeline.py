"""Tests for GIC timeline loading used by the EKF pipeline."""
from __future__ import annotations

import unittest
from unittest.mock import MagicMock, patch

import pandas as pd

from zgiis.gic.timeline import _best_station_id, load_gic_timeline


class GicTimelineTests(unittest.TestCase):
    def test_best_station_id_prefers_most_records(self):
        summaries = [
            {"station_id": "ALASKA_001", "count": 12},
            {"station_id": "DEMA_001", "count": 48},
        ]
        self.assertEqual(_best_station_id(summaries), "DEMA_001")

    def test_best_station_id_skips_empty(self):
        summaries = [{"station_id": "ALASKA_001", "count": 0}]
        self.assertIsNone(_best_station_id(summaries))

    @patch("zgiis.db.gic_db.GicDB")
    def test_load_gic_timeline_returns_chronological_pairs(self, mock_db_cls: MagicMock) -> None:
        mock_db = mock_db_cls.return_value
        mock_db.station_summaries.return_value = [{"station_id": "DEMA_001", "count": 3}]
        mock_db.query_dataframe.return_value = pd.DataFrame(
            {
                "time": pd.to_datetime(
                    ["2024-06-01T12:00:00+00:00", "2024-06-01T13:00:00+00:00"],
                    utc=True,
                ),
                "gic_a": [2.5, 3.1],
            }
        )

        station_id, points = load_gic_timeline(hours=24, resample="1h")
        self.assertEqual(station_id, "DEMA_001")
        self.assertEqual(len(points), 2)
        self.assertAlmostEqual(points[0][1], 2.5)
        self.assertAlmostEqual(points[1][1], 3.1)

    @patch("zgiis.db.gic_db.GicDB")
    def test_load_gic_timeline_empty_when_no_measurements(self, mock_db_cls: MagicMock) -> None:
        mock_db = mock_db_cls.return_value
        mock_db.station_summaries.return_value = []
        station_id, points = load_gic_timeline()
        self.assertIsNone(station_id)
        self.assertEqual(points, [])


if __name__ == "__main__":
    unittest.main()
