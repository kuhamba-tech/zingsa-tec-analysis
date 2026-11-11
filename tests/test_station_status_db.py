import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch

import pandas as pd

from tests.supabase_isolation import prepare
from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
from zgiis.db.station_status_db import StationStatusDB


def _hours_ago(hours: float) -> str:
    """ISO timestamp inside the rolling outage lookback, independent of the calendar date."""
    return (
        datetime.now(timezone.utc) - timedelta(hours=hours)
    ).replace(microsecond=0).isoformat()


class StationStatusDBTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = StationStatusDB(
            dsn=prepare("station_status_events", "station_status_snapshots")
        )

    def tearDown(self) -> None:
        self.db.close()

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

    def test_site_down_opens_ongoing_outage_for_details(self) -> None:
        down_at = _hours_ago(2)
        self.db.insert_event(
            {
                "time": down_at,
                "station_code": "gokw",
                "status": "offline",
                "previous_status": "online",
                "event_type": "site_down",
                "online_count": 17,
                "degraded_count": 0,
                "offline_count": 1,
                "unknown_count": 0,
                "api_reachable": True,
                "message": "Site went offline (online → offline)",
                "source": "test",
            }
        )
        intervals = self.db.outage_intervals(hours=24, station_code="gokw", limit=10)
        self.assertEqual(len(intervals), 1)
        self.assertTrue(intervals[0]["ongoing"])
        self.assertEqual(pd.Timestamp(intervals[0]["started_at"]), pd.Timestamp(down_at))
        self.assertIsNone(intervals[0]["ended_at"])

    def test_initial_offline_does_not_create_outage(self) -> None:
        down_at = pd.Timestamp.now(tz="UTC").isoformat()
        self.db.insert_event(
            {
                "time": down_at,
                "station_code": "gokw",
                "status": "offline",
                "previous_status": None,
                "event_type": "initial_state",
                "online_count": 17,
                "degraded_count": 0,
                "offline_count": 1,
                "unknown_count": 0,
                "api_reachable": True,
                "message": None,
                "source": "test",
            }
        )
        intervals = self.db.outage_intervals(hours=24, station_code="gokw", limit=10)
        self.assertEqual(intervals, [])

    def test_outage_intervals_list_ongoing_sites_before_short_recovered(self) -> None:
        """Zero-uptime sites must not be crowded out by short recovered flaps."""
        self.db.insert_event(
            {
                "time": _hours_ago(72),
                "station_code": "bula",
                "status": "offline",
                "previous_status": "online",
                "event_type": "site_down",
                "online_count": 20,
                "degraded_count": 0,
                "offline_count": 1,
                "unknown_count": 0,
                "api_reachable": True,
                "message": "Site went offline",
                "source": "test",
            }
        )
        self.db.insert_event(
            {
                "time": _hours_ago(3),
                "station_code": "zinh",
                "status": "offline",
                "previous_status": "online",
                "event_type": "site_down",
                "online_count": 20,
                "degraded_count": 0,
                "offline_count": 1,
                "unknown_count": 0,
                "api_reachable": True,
                "message": "Site went offline",
                "source": "test",
            }
        )
        self.db.insert_event(
            {
                "time": _hours_ago(2),
                "station_code": "zinh",
                "status": "online",
                "previous_status": "offline",
                "event_type": "site_up",
                "online_count": 21,
                "degraded_count": 0,
                "offline_count": 0,
                "unknown_count": 0,
                "api_reachable": True,
                "message": "Site back online",
                "source": "test",
            }
        )
        intervals = self.db.outage_intervals(hours=24 * 7, limit=50)
        self.assertGreaterEqual(len(intervals), 2)
        self.assertEqual(intervals[0]["station_code"], "bula")
        self.assertTrue(intervals[0]["ongoing"])
        codes = {row["station_code"] for row in intervals}
        self.assertIn("bula", codes)
        self.assertIn("zinh", codes)

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

    def _event(self, hours_ago: float, code: str, kind: str, status: str, prev: str | None = None) -> None:
        self.db.insert_event(
            {
                "time": _hours_ago(hours_ago),
                "station_code": code,
                "status": status,
                "previous_status": prev,
                "event_type": kind,
                "api_reachable": True,
                "message": None,
                "source": "test",
            }
        )

    def test_short_drops_are_not_outages(self) -> None:
        """Same 10-minute rule as the Slack alerts."""
        with patch.dict("os.environ", {"CORS_OFFLINE_ALERT_MINUTES": "10"}):
            self._event(5.0, "bing", "site_down", "offline", "online")
            self._event(5.0 - 1 / 60, "bing", "site_up", "online", "offline")  # 1 min blip
            self._event(3.0, "bing", "site_down", "offline", "online")
            self._event(2.5, "bing", "site_up", "online", "offline")  # 30 min outage
            analysis = self.db.uptime_analysis(hours=24, station_code="bing", bucket_minutes=60)
        self.assertEqual(analysis["outage_events"], 1)
        self.assertEqual(analysis["short_drops"], 1)
        self.assertEqual(analysis["outage_min_minutes"], 10.0)
        self.assertEqual(len(analysis["outage_intervals"]), 1)
        self.assertAlmostEqual(analysis["outage_intervals"][0]["duration_min"], 30.0, delta=0.2)

    def test_outage_from_before_window_is_ongoing(self) -> None:
        self._event(24 * 20, "chim", "site_down", "offline", "online")
        self._event(24 * 10, "chim", "initial_state", "offline")  # a restart while down
        intervals = self.db.outage_intervals(hours=24 * 7, station_code="chim", limit=10)
        self.assertEqual(len(intervals), 1)
        self.assertTrue(intervals[0]["ongoing"])
        self.assertTrue(intervals[0]["start_exact"])
        self.assertAlmostEqual(intervals[0]["duration_min"], 20 * 24 * 60, delta=2)

    def test_offline_since_only_baselines_is_not_exact(self) -> None:
        self._event(24 * 9, "nkay", "initial_state", "offline")
        self._event(24 * 8, "nkay", "initial_state", "offline")
        intervals = self.db.outage_intervals(hours=24 * 7, station_code="nkay", limit=10)
        self.assertEqual(len(intervals), 1)
        self.assertFalse(intervals[0]["start_exact"])
        self.assertEqual(pd.Timestamp(intervals[0]["started_at"]).floor("min"),
                         pd.Timestamp(_hours_ago(24 * 9)).floor("min"))

    def test_restart_finding_site_online_ends_outage(self) -> None:
        self._event(6, "gokw", "site_down", "offline", "online")
        self._event(4, "gokw", "initial_state", "online")
        intervals = self.db.outage_intervals(hours=24, station_code="gokw", limit=10)
        self.assertEqual(len(intervals), 1)
        self.assertFalse(intervals[0]["ongoing"])
        self.assertAlmostEqual(intervals[0]["duration_min"], 120.0, delta=0.5)


class StationStatusLoggerSeedTests(unittest.TestCase):
    def test_restart_resumes_last_archived_status(self) -> None:
        from backend import station_status_logger as logger

        db = Mock()
        db.latest_snapshots.return_value = {
            "bing": {"status": "online"},
            "tsho": {"status": "offline"},
        }
        with patch.object(logger, "get_db", return_value=db), \
                patch.object(logger, "_last_station_status", {}), \
                patch.object(logger, "_seeded_from_archive", False):
            logger._log_status_changes({"bing": "offline", "tsho": "offline", "gokw": "online"}, source="test")
        kinds = {c.args[0]["station_code"]: c.args[0]["event_type"] for c in db.insert_event.call_args_list}
        self.assertEqual(kinds, {"bing": "site_down", "gokw": "initial_state"})


if __name__ == "__main__":
    unittest.main()
