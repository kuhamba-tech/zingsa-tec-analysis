import time
import unittest
from unittest.mock import patch

from zgiis.space_weather.fetch_indices import (
    _CACHE,
    clear_space_weather_cache,
    get_space_weather,
)


def _delayed(value):
    time.sleep(0.08)
    return value


class SpaceWeatherParallelFetchTests(unittest.TestCase):
    def tearDown(self):
        _CACHE.clear()

    def test_independent_api_products_are_fetched_concurrently(self):
        africa = {
            "kp_index": 2,
            "kp_level": "Quiet",
            "kp_color": "#00f5a0",
            "history": [],
        }
        ionosphere = {"stations": [], "kp_index": 2}
        health = {"stations": [], "health_summary": {"telemetry_live": 0}}
        kp_history = [
            {"time_tag": "2026-06-15T07:00:00", "kp_index": 2}
        ]
        f107_history = [
            {"time_tag": "2026-06-15T06:00:00", "flux": 128.0}
        ]
        dst_history = [
            {"time_tag": "2026-06-15T06:00:00", "dst": -2.0}
        ]
        wind_history = [
            {
                "time_tag": "2026-06-15T07:00:00",
                "speed": 436.0,
                "density": 4.5,
            }
        ]

        with (
            patch(
                "zgiis.space_weather.fetch_indices.fetch_space_weather_africa",
                side_effect=lambda: _delayed(africa),
            ),
            patch(
                "zgiis.space_weather.fetch_indices.fetch_ionosphere_status",
                side_effect=lambda **_: _delayed(ionosphere),
            ),
            patch(
                "zgiis.space_weather.fetch_indices.fetch_station_health",
                side_effect=lambda **_: _delayed(health),
            ),
            patch(
                "zgiis.space_weather.fetch_indices._fetch_noaa_kp_history",
                side_effect=lambda: _delayed(kp_history),
            ),
            patch(
                "zgiis.space_weather.fetch_indices._fetch_noaa_f107_history",
                side_effect=lambda: _delayed(f107_history),
            ),
            patch(
                "zgiis.space_weather.fetch_indices._fetch_noaa_dst_history",
                side_effect=lambda: _delayed(dst_history),
            ),
            patch(
                "zgiis.space_weather.fetch_indices._fetch_noaa_solar_wind_history",
                side_effect=lambda: _delayed(wind_history),
            ),
        ):
            clear_space_weather_cache()
            started = time.perf_counter()
            result = get_space_weather()
            elapsed = time.perf_counter() - started

        self.assertLess(elapsed, 0.35)
        self.assertEqual(result["kp"], 2.0)
        self.assertEqual(result["f107"], 128.0)
        self.assertEqual(result["dst"], -2.0)
        self.assertEqual(result["solar_wind_speed"], 436)


if __name__ == "__main__":
    unittest.main()
