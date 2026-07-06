"""Tests for ICAO TEC advisory helpers."""

from __future__ import annotations

import unittest

from zgiis.maps.heatmap_data import ICAO_TEC_MOD, ICAO_TEC_SEV, _absolute_weight, _classify_data_quality


class IcaoTecAdvisoryTests(unittest.TestCase):
    def test_absolute_weight_at_icao_mod(self) -> None:
        self.assertAlmostEqual(_absolute_weight(ICAO_TEC_MOD), ICAO_TEC_MOD / 200.0, places=3)

    def test_regional_codes_classified(self) -> None:
        stations = [
            {"code": "NW", "obs_count": 0},
            {"code": "NE", "obs_count": 0},
        ]
        self.assertEqual(_classify_data_quality(stations, None), "regional_mean")

    def test_station_quality_with_grid(self) -> None:
        stations = [{"code": "hara", "obs_count": 5}]
        grid = {"lons": [], "lats": [], "vtec": []}
        self.assertEqual(_classify_data_quality(stations, grid), "station")

    def test_icao_constants(self) -> None:
        self.assertEqual(ICAO_TEC_MOD, 125.0)
        self.assertEqual(ICAO_TEC_SEV, 175.0)


if __name__ == "__main__":
    unittest.main()
