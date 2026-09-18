"""Unit tests for monthly F10.7 / SSN solar-cycle merge helpers."""
from __future__ import annotations

import unittest

from zgiis.space_weather.solar_cycle_indices import (
    aggregate_lisird_daily_to_monthly,
    merge_solar_cycle_series,
    parse_noaa_monthly,
)


class SolarCycleIndicesTests(unittest.TestCase):
    def test_parse_noaa_treats_minus_one_as_missing(self):
        rows = [
            {
                "time-tag": "2004-09",
                "ssn": 48.8,
                "f10.7": -1.0,
            },
            {
                "time-tag": "2004-10",
                "ssn": 74.2,
                "f10.7": 137.56,
            },
            {
                "time-tag": "1960-01",
                "ssn": 100.0,
                "f10.7": 120.0,
            },
        ]
        parsed = parse_noaa_monthly(rows, start_year=1965)
        self.assertNotIn("1960-01", parsed)
        self.assertEqual(parsed["2004-09"]["ssn"], 48.8)
        self.assertIsNone(parsed["2004-09"]["f107"])
        self.assertEqual(parsed["2004-10"]["f107"], 137.56)
        self.assertEqual(parsed["2004-10"]["f107_source"], "noaa")

    def test_lisird_daily_aggregates_to_monthly_mean(self):
        csv_text = (
            "time (yyyyMMdd),f107_adjusted (solar flux unit (SFU)),f107_observed (solar flux unit (SFU))\n"
            "19650101,80.0,100.0\n"
            "19650102,80.0,110.0\n"
            "19650201,90.0,\n"
        )
        monthly = aggregate_lisird_daily_to_monthly(csv_text, start_year=1965)
        self.assertEqual(monthly["1965-01"], 105.0)
        self.assertEqual(monthly["1965-02"], 90.0)

    def test_merge_prefers_noaa_f107_over_lisird(self):
        noaa = parse_noaa_monthly(
            [
                {"time-tag": "2004-09", "ssn": 48.8, "f10.7": -1.0},
                {"time-tag": "2004-10", "ssn": 74.2, "f10.7": 137.56},
            ],
            start_year=1965,
        )
        lisird = {"2004-09": 120.0, "2004-10": 999.0}
        points = merge_solar_cycle_series(noaa, lisird, start_year=1965)
        by_tag = {p["time_tag"]: p for p in points}
        self.assertEqual(by_tag["2004-09"]["f107"], 120.0)
        self.assertEqual(by_tag["2004-09"]["f107_source"], "lisird")
        self.assertEqual(by_tag["2004-10"]["f107"], 137.56)
        self.assertEqual(by_tag["2004-10"]["f107_source"], "noaa")
        self.assertEqual(by_tag["2004-10"]["ssn"], 74.2)


if __name__ == "__main__":
    unittest.main()
