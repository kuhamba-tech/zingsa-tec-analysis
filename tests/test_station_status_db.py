import tempfile
import unittest
from pathlib import Path

from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
from zgiis.db.station_status_db import StationStatusDB


class StationStatusDBTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self._db_path = Path(self._tmp.name) / "station_status_test.sqlite"
        import zgiis.db.station_status_db as mod

        self._mod = mod
        self._saved = mod._SQLITE_PATH
        mod._SQLITE_PATH = self._db_path
        self.db = StationStatusDB(dsn="")

    def tearDown(self) -> None:
        self.db.close()
        self._mod._SQLITE_PATH = self._saved
        self._tmp.cleanup()

    def test_status_change_event_and_snapshot(self) -> None:
        when = "2026-06-16T12:00:00+00:00"
        self.db.insert_event(
            {
                "time": when,
                "station_code": "zinh",
                "status": "online",
                "previous_status": "offline",
                "event_type": "status_change",
                "online_count": 1,
                "degraded_count": 0,
                "offline_count": 0,
                "unknown_count": 0,
                "api_reachable": True,
                "message": "offline → online",
                "source": "test",
            }
        )
        self.db.insert_snapshots(
            [
                {
                    "time": when,
                    "station_code": "zinh",
                    "status": "online",
                    "api_reachable": True,
                    "source": "test",
                }
            ]
        )

        self.assertEqual(self.db.event_count(), 1)
        self.assertEqual(self.db.snapshot_count(), 1)

        events = self.db.query_events(hours=48, station_code="zinh")
        self.assertEqual(len(events), 1)
        self.assertEqual(events.iloc[0]["event_type"], "status_change")

        uptime = self.db.uptime_summary(hours=48)
        self.assertEqual(len(uptime), len(ZIMBABWE_CORS_STATIONS))
        zinh = next(r for r in uptime if r["station_code"] == "zinh")
        self.assertEqual(zinh["online_pct"], 100.0)
        self.assertEqual(zinh["station_name"], "ZINGSA HQ")

    def test_connection_lost_marks_unknown(self) -> None:
        when = "2026-06-16T13:00:00+00:00"
        self.db.insert_event(
            {
                "time": when,
                "station_code": None,
                "status": "unknown",
                "previous_status": None,
                "event_type": "connection_lost",
                "api_reachable": False,
                "message": "timeout",
                "source": "test",
            }
        )
        self.db.insert_snapshots(
            [
                {
                    "time": when,
                    "station_code": "zinh",
                    "status": "unknown",
                    "api_reachable": False,
                    "source": "test",
                }
            ]
        )

        events = self.db.query_events(hours=48, event_type="connection_lost")
        self.assertEqual(len(events), 1)
        self.assertFalse(bool(events.iloc[0]["api_reachable"]))

        uptime = self.db.uptime_summary(hours=48)
        zinh = next(r for r in uptime if r["station_code"] == "zinh")
        self.assertEqual(zinh["unknown_pct"], 100.0)

    def test_uptime_returns_all_registered_stations_when_empty(self) -> None:
        uptime = self.db.uptime_summary(hours=48)
        self.assertEqual(len(uptime), len(ZIMBABWE_CORS_STATIONS))
        self.assertTrue(all(r["samples"] == 0 for r in uptime))


if __name__ == "__main__":
    unittest.main()
