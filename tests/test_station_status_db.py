import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import pandas as pd

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

        events = self.db.query_events(hours=24 * 365, station_code="zinh")
        self.assertEqual(len(events), 1)
        self.assertEqual(events.iloc[0]["event_type"], "status_change")

        uptime = self.db.uptime_summary(hours=24 * 365)
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

        events = self.db.query_events(hours=24 * 365, event_type="connection_lost")
        self.assertEqual(len(events), 1)
        self.assertFalse(bool(events.iloc[0]["api_reachable"]))

        uptime = self.db.uptime_summary(hours=24 * 365)
        zinh = next(r for r in uptime if r["station_code"] == "zinh")
        self.assertEqual(zinh["unknown_pct"], 100.0)

    def test_uptime_returns_all_registered_stations_when_empty(self) -> None:
        uptime = self.db.uptime_summary(hours=48)
        self.assertEqual(len(uptime), len(ZIMBABWE_CORS_STATIONS))
        self.assertTrue(all(r["samples"] == 0 for r in uptime))

    def test_uptime_timeline_and_analysis_for_station_and_network(self) -> None:
        base = pd.Timestamp("2026-08-07T10:00:00Z")
        rows = []
        for i in range(4):
            t = (base + pd.Timedelta(minutes=15 * i)).isoformat().replace("+00:00", "Z")
            rows.append(
                {
                    "time": t,
                    "station_code": "zinh",
                    "status": "online" if i < 3 else "offline",
                    "api_reachable": True,
                    "source": "test",
                }
            )
            rows.append(
                {
                    "time": t,
                    "station_code": "zimw",
                    "status": "offline" if i < 2 else "online",
                    "api_reachable": True,
                    "source": "test",
                }
            )
        self.db.insert_snapshots(rows)
        self.db.insert_event(
            {
                "time": rows[-1]["time"],
                "station_code": "zinh",
                "status": "offline",
                "previous_status": "online",
                "event_type": "status_change",
                "online_count": 1,
                "degraded_count": 0,
                "offline_count": 1,
                "unknown_count": 0,
                "api_reachable": True,
                "message": "online → offline",
                "source": "test",
            }
        )

        station_tl = self.db.uptime_timeline(hours=24 * 365, station_code="zinh", bucket_minutes=60)
        self.assertGreaterEqual(len(station_tl), 1)
        self.assertTrue(all("online_pct" in p for p in station_tl))

        network_tl = self.db.uptime_timeline(hours=24 * 365, bucket_minutes=60)
        self.assertGreaterEqual(len(network_tl), 1)

        analysis = self.db.uptime_analysis(hours=24 * 365, station_code="zinh", bucket_minutes=60)
        self.assertEqual(analysis["station_code"], "zinh")
        self.assertGreater(analysis["samples"], 0)
        self.assertEqual(analysis["outage_events"], 1)
        self.assertEqual(len(analysis["stations"]), len(ZIMBABWE_CORS_STATIONS))
        self.assertGreaterEqual(len(analysis["timeline"]), 1)

        filtered = self.db.uptime_summary(hours=24 * 365, station_code="zinh")
        self.assertEqual(len(filtered), 1)
        self.assertEqual(filtered[0]["station_code"], "zinh")
        self.assertEqual(filtered[0]["online_pct"], 75.0)

    def test_postgres_snapshot_read_reconnects_once(self) -> None:
        db = object.__new__(StationStatusDB)
        db._dsn = "postgresql://example.invalid/status"
        db._is_pg = True
        db._conn = Mock()
        stale = db._conn
        replacement = Mock()

        def reconnect() -> None:
            db._conn = replacement

        db._init_pg = Mock(side_effect=reconnect)
        expected = pd.DataFrame(
            [
                {
                    "time": "2026-07-25T05:18:00+00:00",
                    "station_code": "zinh",
                    "status": "online",
                    "api_reachable": True,
                    "source": "collector",
                }
            ]
        )

        with patch(
            "zgiis.db.station_status_db.pd.read_sql",
            side_effect=[RuntimeError("stale connection"), expected],
        ) as read_sql:
            result = db.query_snapshots(hours=1)

        self.assertTrue(result.equals(expected))
        self.assertEqual(read_sql.call_count, 2)
        self.assertIs(read_sql.call_args_list[0].args[1], stale)
        self.assertIs(read_sql.call_args_list[1].args[1], replacement)
        db._init_pg.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
