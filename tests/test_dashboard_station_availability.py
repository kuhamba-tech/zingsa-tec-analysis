"""Do not present an unobserved station network as all offline."""
import unittest
from unittest.mock import patch

from backend.routers import space_weather as routes
from backend import space_weather_logger


class StationAvailabilityTests(unittest.TestCase):
    def test_history_records_displayed_station_count_without_refetching_idle_pipeline(self):
        snapshot = {"stations_online": 11, "stations_total": 25}
        with (
            patch("zgiis.space_weather.fetch_indices.get_space_weather") as fetch,
            patch.object(space_weather_logger, "_attach_mean_vtec"),
            patch.object(space_weather_logger, "get_db") as get_db,
            patch.object(space_weather_logger, "_last_logged_at", None),
        ):
            self.assertTrue(space_weather_logger.log_snapshot(snapshot=snapshot))
            fetch.assert_not_called()
            row = get_db.return_value.insert_snapshot.call_args.args[0]
            self.assertEqual(row["stations_online"], 11)

    def test_unknown_counts_are_unavailable_but_observed_zero_is_preserved(self):
        for counts, expected in [((None, None), None), ((0, 25), 0), ((12, 25), 12)]:
            routes._CURRENT_CACHE["payload"] = None
            routes._CURRENT_CACHE["ts"] = 0.0
            with (
                self.subTest(counts=counts),
                patch.object(routes, "_sw", return_value={
                    "stations_online": 0, "stations_total": 25, "mean_vtec": 10,
                }),
                patch.object(routes, "_ntrip_stream_counts", return_value=counts),
                patch.object(routes.threading, "Thread"),
            ):
                result = routes.current()
                self.assertEqual(result.stations_online, expected)
                self.assertEqual(result.stations_total, 25)

    def test_archived_snapshot_wins_over_partial_live_probe_when_probe_is_stale(self):
        with (
            patch.object(routes, "_archived_online_total", return_value=(14, 25)),
            patch.object(routes.os, "getenv", side_effect=lambda key, default=None: default),
            patch("zgiis.live.ntrip_status_cache.get_cached_ntrip_probe", return_value={
                "error": None,
                "stations": [
                    {"station": "hara", "verdict": "msm_streaming"},
                    {"station": "gwer", "verdict": "offline"},
                ],
            }),
        ):
            self.assertEqual(routes._ntrip_stream_counts(), (14, 25))
