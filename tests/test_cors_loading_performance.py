"""Regression checks for bounded station reads and short-lived response caching."""
import sqlite3
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from backend.routers import cors_network
from zgiis.cors.stations import CorsStation
from zgiis.db.station_status_db import StationStatusDB, _SQLITE_DDL


class LatestStationReadsTests(unittest.TestCase):
    def setUp(self):
        self.db = object.__new__(StationStatusDB)
        self.db._is_pg = False
        self.db._dsn = ""
        self.db._conn = sqlite3.connect(":memory:")
        self.db._conn.executescript(_SQLITE_DDL)

    def tearDown(self):
        self.db.close()

    def add(self, code, age_minutes, status):
        when = (datetime.now(timezone.utc) - timedelta(minutes=age_minutes)).isoformat()
        self.db._conn.execute(
            "INSERT INTO station_status_snapshots VALUES (?, ?, ?, ?, ?)",
            (when, code, status, 1, "collector"),
        )
        self.db._conn.commit()

    def test_returns_newest_status_per_normalized_site_and_excludes_expired(self):
        self.add("HARA", 10, "online")
        self.add("hara_", 1, "offline")
        self.add("bing", 2, "online")
        self.add("old", 120, "online")
        # Loading the full history is explicitly unnecessary for this path.
        with patch.object(self.db, "query_snapshots", side_effect=AssertionError("full history read")):
            rows = self.db.latest_snapshots(hours=1)
        self.assertEqual(set(rows), {"hara", "bing"})
        self.assertEqual(rows["hara"]["status"], "offline")
        self.assertEqual(rows["bing"]["status"], "online")
        self.assertEqual(rows["bing"]["source"], "collector")

    def test_empty_history_is_unavailable(self):
        self.assertEqual(self.db.latest_snapshots(), {})

    def test_latest_unknown_does_not_resurrect_older_online_reading(self):
        self.add("hara", 10, "online")
        self.add("hara", 1, "unknown")
        self.assertEqual(self.db.latest_snapshots()["hara"]["status"], "unknown")


class StationResponseCacheTests(unittest.TestCase):
    def setUp(self):
        cors_network.clear_stations_cache()

    def tearDown(self):
        cors_network.clear_stations_cache()

    def test_collector_rows_reused_then_refetched_after_ttl(self):
        rows = [CorsStation("hara", "Harare", -18, 31, "online", status_source="ntrip")]
        with (
            patch("backend.live_manager.pipeline_map_state", return_value=(False, {})),
            patch.object(cors_network, "_stations_impl", return_value=rows) as fetch,
            patch.object(cors_network.time, "monotonic", side_effect=[100, 101, 116]),
        ):
            self.assertEqual(cors_network._stations(), rows)
            self.assertEqual(cors_network._stations(), rows)
            self.assertEqual(fetch.call_count, 1)
            cors_network._stations()
            self.assertEqual(fetch.call_count, 2)

    def test_unknown_rows_are_not_cached(self):
        rows = [CorsStation("hara", "Harare", -18, 31, "unknown", status_source="unknown")]
        with (
            patch("backend.live_manager.pipeline_map_state", return_value=(False, {})),
            patch.object(cors_network, "_stations_impl", return_value=rows) as fetch,
        ):
            cors_network._stations()
            cors_network._stations()
        self.assertEqual(fetch.call_count, 2)


if __name__ == "__main__":
    unittest.main()
