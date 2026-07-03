import unittest
from unittest.mock import Mock, patch

from zgiis.api.cors_client import _api_bases
from zgiis.space_weather.fetch_indices import (
    _CACHE,
    _cached,
    _fetch_noaa_solar_wind_history,
    _latest_solar_wind_from_history,
    _request_noaa_json,
    clear_space_weather_cache,
)


class SpaceWeatherApiResilienceTests(unittest.TestCase):
    def tearDown(self):
        _CACHE.clear()

    def test_duplicate_cors_api_bases_are_removed(self):
        self.assertEqual(len(_api_bases()), len(set(_api_bases())))

    def test_unavailable_cache_expires_quickly(self):
        _CACHE["space_weather"] = {
            "ts": 100.0,
            "data": {"mode": "unavailable", "kp": None},
        }

        with patch("time.time", return_value=111.0):
            result = _cached(
                "space_weather",
                lambda: {"mode": "live", "kp": 2.0},
            )

        self.assertEqual(result["mode"], "live")
        self.assertEqual(result["kp"], 2.0)

    def test_noaa_request_retries_once(self):
        success = Mock()
        success.raise_for_status.return_value = None
        success.json.return_value = [{"time_tag": "2026-06-15T07:00:00"}]

        with (
            patch(
                "zgiis.space_weather.fetch_indices.requests.get",
                side_effect=[TimeoutError("temporary"), success],
            ) as request,
            patch("time.sleep"),
        ):
            result = _request_noaa_json("https://example.test/data.json")

        self.assertEqual(request.call_count, 2)
        self.assertEqual(result, [{"time_tag": "2026-06-15T07:00:00"}])

    def test_cache_can_be_cleared_for_immediate_refresh(self):
        _CACHE["space_weather"] = {"ts": 100.0, "data": {"mode": "live"}}

        clear_space_weather_cache()

        self.assertNotIn("space_weather", _CACHE)

    def test_noaa_rtsw_solar_wind_feed_is_parsed(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = [
            {
                "time_tag": "2026-07-03T04:58:00",
                "active": False,
                "source": "ACE",
                "proton_speed": 425.35,
                "proton_density": 0.05,
            },
            {
                "time_tag": "2026-07-03T04:59:00",
                "active": True,
                "source": "SOLAR1",
                "proton_speed": 375.2,
                "proton_density": 2.73,
            },
        ]

        with patch(
            "zgiis.space_weather.fetch_indices.requests.get",
            return_value=response,
        ):
            history = _fetch_noaa_solar_wind_history()

        self.assertEqual(len(history), 2)
        self.assertEqual(history[-1]["speed"], 375.2)
        self.assertEqual(history[-1]["density"], 2.73)
        self.assertEqual(_latest_solar_wind_from_history(history), (375.2, 2.73))


if __name__ == "__main__":
    unittest.main()
