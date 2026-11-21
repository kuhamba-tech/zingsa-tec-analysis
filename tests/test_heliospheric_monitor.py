"""Unit tests for heliospheric monitor parsers (KNMI-style NOAA panels)."""
from __future__ import annotations

import unittest
from unittest.mock import patch

from zgiis.space_weather.heliospheric_monitor import (
    _soft_fetch,
    parse_dst_series,
    parse_imf_series,
    parse_kp_forecast_series,
    parse_proton_series,
    parse_solar_wind_speed_series,
    parse_xray_series,
)


class HeliosphericMonitorParseTests(unittest.TestCase):
    def test_feed_timeout_uses_recent_last_successful_response(self):
        cached = b'{"cached_at":"2026-11-13T10:00:00+00:00","payload":[{"time_tag":"2026-11-13T10:00:00Z"}]}'
        with (
            patch("zgiis.space_weather.heliospheric_monitor._fetch_json", side_effect=TimeoutError("connect timed out")),
            patch("zgiis.space_weather.heliospheric_monitor.read_source", return_value=cached),
        ):
            payload, error = _soft_fetch("https://example.test/feed.json")

        self.assertEqual(payload, [{"time_tag": "2026-11-13T10:00:00Z"}])
        self.assertIn("last successful feed received", error)
        self.assertNotIn("TimeoutError", error)

    def test_feed_timeout_without_cache_returns_safe_status(self):
        with (
            patch("zgiis.space_weather.heliospheric_monitor._fetch_json", side_effect=TimeoutError("connect timed out")),
            patch("zgiis.space_weather.heliospheric_monitor.read_source", return_value=None),
        ):
            payload, error = _soft_fetch("https://example.test/feed.json")

        self.assertIsNone(payload)
        self.assertEqual(error, "NOAA feed is temporarily unreachable; no recent cached observations are available.")

    def test_successful_feed_is_saved_for_outage_fallback(self):
        with (
            patch("zgiis.space_weather.heliospheric_monitor._fetch_json", return_value=[{"value": 1}]),
            patch("zgiis.space_weather.heliospheric_monitor.write_source") as write_source,
        ):
            payload, error = _soft_fetch("https://example.test/feed.json")

        self.assertEqual(payload, [{"value": 1}])
        self.assertIsNone(error)
        write_source.assert_called_once()

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
        self.assertAlmostEqual(parsed["pressure"][0], 1.6726e-6 * 8.5 * 450.0**2)
        self.assertIsNone(parsed["pressure"][1])
        self.assertEqual(len(parsed["epoch_ms"]), 2)

    def test_isolated_pressure_spike_disagreed_with_other_noaa_readings(self):
        rows = [
            {"time_tag": "2026-11-19T07:16:00", "active": True, "source": "ACE", "proton_speed": 449.93, "proton_density": 4.54},
            {"time_tag": "2026-11-19T07:17:00", "active": True, "source": "ACE", "proton_speed": 373.14, "proton_density": 26.88},
            {"time_tag": "2026-11-19T07:18:00", "active": True, "source": "ACE", "proton_speed": 410.06, "proton_density": 5.67},
            {"time_tag": "2026-11-19T07:17:01", "active": False, "source": "IMAP", "proton_speed": 430.62, "proton_density": 5.05},
        ]

        parsed = parse_solar_wind_speed_series(rows)
        pressure_by_time = dict(zip(parsed["times"], parsed["pressure"]))
        spike_time = "2026-11-19T07:17:00Z"

        self.assertIsNone(pressure_by_time[spike_time])
        self.assertAlmostEqual(pressure_by_time["2026-11-19T07:16:00Z"], 1.6726e-6 * 4.54 * 449.93**2)
        self.assertEqual(parsed["_pressure_invalid_times"], [spike_time])

    def test_pressure_spike_is_kept_when_another_source_confirms_it(self):
        rows = [
            {"time_tag": "2026-11-19T07:16:00", "active": True, "source": "ACE", "proton_speed": 400.0, "proton_density": 20.0},
            {"time_tag": "2026-11-19T07:17:00", "active": True, "source": "ACE", "proton_speed": 400.0, "proton_density": 20.0},
            {"time_tag": "2026-11-19T07:18:00", "active": True, "source": "ACE", "proton_speed": 400.0, "proton_density": 20.0},
            {"time_tag": "2026-11-19T07:17:01", "active": False, "source": "IMAP", "proton_speed": 400.0, "proton_density": 20.0},
        ]

        parsed = parse_solar_wind_speed_series(rows)
        self.assertTrue(all(value is not None for value in parsed["pressure"]))
        self.assertEqual(parsed["_pressure_invalid_times"], [])

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

    def test_xray_series_aligns_long_and_short_bands(self):
        rows = [
            {"time_tag": "2026-09-16T12:00:00Z", "energy": "0.1-0.8nm", "flux": 1.2e-6},
            {"time_tag": "2026-09-16T12:00:00Z", "energy": "0.05-0.4nm", "flux": 9.0e-7},
        ]
        parsed = parse_xray_series(rows)
        self.assertEqual(parsed["flux"], [1.2e-6])
        self.assertEqual(parsed["short_flux"], [9.0e-7])
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
