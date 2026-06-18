import unittest
from datetime import datetime, timezone

from zgiis.cors.stations import derive_status_from_stream, stations_for_map_live


class StationsForMapLiveTests(unittest.TestCase):
    def test_derive_status_offline_when_not_connected(self):
        self.assertEqual(
            derive_status_from_stream({"connected": False, "last_seen": None}),
            "offline",
        )

    def test_derive_status_degraded_when_connected_without_data(self):
        self.assertEqual(
            derive_status_from_stream({"connected": True, "last_seen": None}),
            "degraded",
        )

    def test_derive_status_online_when_recent_data(self):
        now = datetime.now(timezone.utc).isoformat()
        self.assertEqual(
            derive_status_from_stream({"connected": True, "last_seen": now}),
            "online",
        )

    def test_live_map_marks_missing_stream_offline_when_pipeline_configured(self):
        streams = {
            "zinh": {"connected": True, "last_seen": datetime.now(timezone.utc).isoformat()},
            "gsu": {"connected": True, "last_seen": None},
            "hara": {"connected": False, "last_seen": None},
        }

        class FakeLiveManager:
            @staticmethod
            def status():
                return {"configured": True, "streams": streams}

        import backend.live_manager as live_manager_mod

        original = live_manager_mod.status
        live_manager_mod.status = FakeLiveManager.status
        try:
            rows = stations_for_map_live(streams)
        finally:
            live_manager_mod.status = original

        by_code = {s.code: s.status for s in rows}
        self.assertEqual(by_code["zinh"], "online")
        self.assertEqual(by_code["gsu"], "degraded")
        self.assertEqual(by_code["hara"], "offline")
        # No stream entry while pipeline is configured → offline, not unknown.
        self.assertEqual(by_code["karo"], "offline")
        self.assertNotIn("unknown", by_code.values())


if __name__ == "__main__":
    unittest.main()
