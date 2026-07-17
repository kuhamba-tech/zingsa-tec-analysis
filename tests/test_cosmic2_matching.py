"""Tests for Haversine distance, geographic box filtering, and COSMIC-2 <->
Zimbabwe CORS matching."""
from __future__ import annotations

import unittest
from datetime import datetime, timezone

import pandas as pd

from zgiis.cors.stations import CorsStation
from zgiis.cosmic2.matching import (
    find_nearest_station,
    haversine_km,
    is_in_box,
    match_profile_to_cors,
)
from zgiis.cosmic2.models import Cosmic2Config


class HaversineTests(unittest.TestCase):
    def test_known_reference_distance(self):
        # Harare (-17.8252, 31.0335) to Bulawayo (-20.15, 28.5833): ~360-370km.
        d = haversine_km(-17.8252, 31.0335, -20.15, 28.5833)
        self.assertAlmostEqual(d, 366, delta=20)

    def test_zero_distance(self):
        self.assertAlmostEqual(haversine_km(-17.8, 31.0, -17.8, 31.0), 0.0, places=6)


class BoxFilterTests(unittest.TestCase):
    def test_default_box_membership(self):
        config = Cosmic2Config()
        self.assertTrue(is_in_box(-17.8, 31.0, config=config))  # Zimbabwe
        self.assertFalse(is_in_box(45.0, 45.0, config=config))  # far outside
        self.assertFalse(is_in_box(-17.8, 10.0, config=config))  # wrong longitude


class NearestStationTests(unittest.TestCase):
    def test_finds_nearest(self):
        stations = [
            CorsStation("hara", "Harare", -17.8252, 31.0335, "online"),
            CorsStation("bula", "Bulawayo", -20.15, 28.5833, "online"),
        ]
        station, distance = find_nearest_station(-17.83, 31.03, stations)
        self.assertEqual(station.code, "hara")
        self.assertLess(distance, 5.0)


class MatchProfileToCorsTests(unittest.TestCase):
    def setUp(self):
        self.stations = [CorsStation("hara", "Harare", -17.8252, 31.0335, "online")]
        self.config = Cosmic2Config()
        self.occ_time = datetime(2024, 4, 1, 12, 14, 0, tzinfo=timezone.utc)

    def _obs_df(self, minutes_offset: float, vtec: float = 22.9) -> pd.DataFrame:
        ts = pd.Timestamp("2024-04-01T12:14:00Z") + pd.Timedelta(minutes=minutes_offset)
        return pd.DataFrame({"station": ["hara"], "timestamp": [ts], "vtec": [vtec]})

    def test_matched_high_quality(self):
        result = match_profile_to_cors(-17.83, 31.03, self.occ_time, self._obs_df(1), self.stations, config=self.config)
        self.assertTrue(result.match_valid)
        self.assertEqual(result.match_quality, "high")
        self.assertEqual(result.match_reason, "matched")

    def test_medium_quality_classification(self):
        # ~220km from Harare, 15 min offset -> beyond high thresholds, within medium.
        result = match_profile_to_cors(-19.8, 31.03, self.occ_time, self._obs_df(15), self.stations, config=self.config)
        self.assertTrue(result.match_valid)
        self.assertEqual(result.match_quality, "medium")

    def test_time_tolerance_rejection(self):
        result = match_profile_to_cors(-17.83, 31.03, self.occ_time, self._obs_df(45), self.stations, config=self.config)
        self.assertFalse(result.match_valid)
        self.assertEqual(result.match_reason, "time_difference_too_large")

    def test_station_too_far_rejection(self):
        result = match_profile_to_cors(10.0, 10.0, self.occ_time, self._obs_df(1), self.stations, config=self.config)
        self.assertFalse(result.match_valid)
        self.assertEqual(result.match_reason, "station_too_far")

    def test_no_observation_in_window(self):
        empty_df = pd.DataFrame(columns=["station", "timestamp", "vtec"])
        result = match_profile_to_cors(-17.83, 31.03, self.occ_time, empty_df, self.stations, config=self.config)
        self.assertFalse(result.match_valid)
        self.assertEqual(result.match_reason, "no_cors_observation_in_window")

    def test_no_stations_available(self):
        result = match_profile_to_cors(-17.83, 31.03, self.occ_time, self._obs_df(1), [], config=self.config)
        self.assertFalse(result.match_valid)
        self.assertEqual(result.match_reason, "no_cors_stations")


if __name__ == "__main__":
    unittest.main()
