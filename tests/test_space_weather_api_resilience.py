import unittest
from unittest.mock import Mock, patch

from zgiis.api.cors_client import _api_bases
from zgiis.space_weather.fetch_indices import (
    _CACHE,
    _cached,
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


if __name__ == "__main__":
    unittest.main()
