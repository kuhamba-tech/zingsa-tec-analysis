"""Unit tests for heliospheric monitor parsers (KNMI-style NOAA panels)."""
from __future__ import annotations

import unittest

from zgiis.space_weather.heliospheric_monitor import (
    parse_dst_series,
    parse_imf_series,
    parse_kp_forecast_series,
    parse_proton_series,
    parse_solar_wind_speed_series,
    parse_xray_series,
)


class HeliosphericMonitorParseTests(unittest.TestCase):
    def test_proton_series_pivots_selected_energies(self):
        rows = [
            {"time_tag": "2026-09-16T00:00:00Z", "energy": ">=10 MeV", "flux": 1.5},
            {"time_tag": "2026-09-16T00:00:00Z", "energy": ">=50 MeV", "flux": 0.2},
            {"time_tag": "2026-09-16T00:00:00Z", "energy": ">=1 MeV", "flux": 99.0},
            {"time_tag": "2026-09-16T00:05:00Z", "energy": ">=10 MeV", "flux": 1.7},
        ]
        parsed = parse_proton_series(rows)
        self.assertEqual(len(parsed["labels"]), 2)
        self.assertIn(">=10 MeV", parsed["series"])
        self.assertNotIn(">=1 MeV", parsed["series"])
        self.assertEqual(parsed["series"][">=10 MeV"][0], 1.5)
        self.assertEqual(parsed["series"][">=50 MeV"][0], 0.2)

    def test_imf_series_reads_gsm_components(self):
        rows = [
            {
                "time_tag": "2026-09-16T12:00:00",
                "active": True,
                "bt": 5.0,
                "by_gsm": -2.0,
                "bz_gsm": 3.5,
            },
            {
                "time_tag": "2026-09-16T12:01:00",
                "active": False,
                "bt": 9.0,
                "by_gsm": 1.0,
                "bz_gsm": -1.0,
            },
        ]
        parsed = parse_imf_series(rows)
        self.assertEqual(len(parsed["labels"]), 1)
        self.assertEqual(parsed["bt"][0], 5.0)
        self.assertEqual(parsed["by"][0], -2.0)
        self.assertEqual(parsed["bz"][0], 3.5)

    def test_solar_wind_includes_density_and_epoch(self):
        rows = [
            {
                "time_tag": "2026-09-16T12:00:00",
                "active": True,
                "proton_speed": 450.0,
                "proton_density": 8.5,
            },
            {
                "time_tag": "2026-09-16T12:01:00",
                "active": True,
                "proton_speed": -9999,
                "proton_density": 3.0,
            },
        ]
        parsed = parse_solar_wind_speed_series(rows)
        self.assertEqual(parsed["speed"], [450.0, None])
        self.assertEqual(parsed["density"], [8.5, 3.0])
        self.assertEqual(len(parsed["epoch_ms"]), 2)

    def test_rtsw_rows_newest_first_are_sorted_oldest_to_newest(self):
        """NOAA RTSW often returns newest samples first — charts must read left→right in time."""
        rows = [
            {
                "time_tag": "2026-09-16T14:00:00",
                "active": True,
                "proton_speed": 600.0,
                "proton_density": 4.0,
            },
            {
                "time_tag": "2026-09-16T12:00:00",
                "active": True,
                "proton_speed": 400.0,
                "proton_density": 6.0,
            },
        ]
        parsed = parse_solar_wind_speed_series(rows)
        self.assertEqual(parsed["speed"], [400.0, 600.0])
        self.assertLess(parsed["epoch_ms"][0], parsed["epoch_ms"][1])
        self.assertTrue(parsed["times"][0] < parsed["times"][1])

    def test_xray_series_keeps_long_band_only(self):
        rows = [
            {"time_tag": "2026-09-16T12:00:00Z", "energy": "0.1-0.8nm", "flux": 1.2e-6},
            {"time_tag": "2026-09-16T12:00:00Z", "energy": "0.05-0.4nm", "flux": 9.0e-7},
        ]
        parsed = parse_xray_series(rows)
        self.assertEqual(parsed["flux"], [1.2e-6])
        self.assertEqual(len(parsed["epoch_ms"]), 1)

    def test_dst_series_accepts_dict_rows(self):
        rows = [
            {"time_tag": "2026-09-16T15:00:00", "dst": -9},
            {"time_tag": "2026-09-16T16:00:00", "dst": -15},
        ]
        parsed = parse_dst_series(rows)
        self.assertEqual(parsed["dst"], [-9.0, -15.0])
        self.assertEqual(len(parsed["epoch_ms"]), 2)


if __name__ == "__main__":
    unittest.main()
