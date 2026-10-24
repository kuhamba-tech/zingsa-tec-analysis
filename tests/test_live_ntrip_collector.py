import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.live_ntrip_collector import (
    DEFAULT_STATUS_PUSH_URL,
    _status_push_url,
    _status_snapshot_rows,
)


class LiveNtripCollectorTests(unittest.TestCase):
    @patch("backend.env_bootstrap.load_dotenv")
    def test_load_env_keeps_supabase_session_url(self, load_dotenv) -> None:
        from scripts.live_ntrip_collector import _load_env

        with patch.dict(
            os.environ,
            {"SUPABASE_DATABASE_URL": "postgresql://session.example/postgres"},
            clear=True,
        ):
            _load_env()
            self.assertEqual(
                os.environ["SUPABASE_DATABASE_URL"],
                "postgresql://session.example/postgres",
            )
            self.assertEqual(os.environ["ZGIIS_SKIP_DB_SCHEMA_INIT"], "1")
            self.assertNotIn("ZGIIS_SERVERLESS_DB", os.environ)

    def test_default_status_push_uses_named_vercel_dispatcher(self) -> None:
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("STATUS_SNAPSHOT_PUSH_URL", None)
            url = _status_push_url()

        self.assertEqual(url, DEFAULT_STATUS_PUSH_URL)
        self.assertIn("/api/cors-router", url)
        self.assertIn("__zr=%2Fcors%2Fstatus%2Fsnapshots", url)

    def test_legacy_production_url_is_normalized_to_named_dispatcher(self) -> None:
        legacy = "https://zingsa-gnss-tec.vercel.app/api/cors/status/snapshots/"
        with patch.dict(os.environ, {"STATUS_SNAPSHOT_PUSH_URL": legacy}):
            url = _status_push_url()

        self.assertEqual(
            url,
            "https://zingsa-gnss-tec.vercel.app/api/cors-router/"
            "?__zr=%2Fcors%2Fstatus%2Fsnapshots",
        )

    def test_custom_collector_endpoint_is_preserved(self) -> None:
        custom = "https://collector.example/api/status"
        with patch.dict(os.environ, {"STATUS_SNAPSHOT_PUSH_URL": custom}):
            self.assertEqual(_status_push_url(), custom)

    def test_acquire_collector_lock_ignores_stale_pid(self) -> None:
        import scripts.live_ntrip_collector as collector

        with tempfile.TemporaryDirectory() as tmpdir:
            lock_path = Path(tmpdir) / ".live_ntrip_collector.lock"
            lock_path.write_text("999999\n", encoding="utf-8")
            with patch.object(collector, "_COLLECTOR_LOCK", lock_path):
                with patch.object(collector.os, "kill", side_effect=OSError("stale pid")):
                    self.assertTrue(collector._acquire_collector_lock())
                    handle = collector._COLLECTOR_LOCK_HANDLE
                    collector._COLLECTOR_LOCK_HANDLE = None
                    handle.close()
                    self.assertEqual(lock_path.read_text(encoding="utf-8").strip(), str(os.getpid()))

    def test_acquire_collector_lock_detects_live_pid_written_to_file(self) -> None:
        import scripts.live_ntrip_collector as collector

        with tempfile.TemporaryDirectory() as tmpdir:
            lock_path = Path(tmpdir) / ".live_ntrip_collector.lock"
            lock_path.write_text(f"{os.getpid()}\n", encoding="utf-8")
            with patch.object(collector, "_COLLECTOR_LOCK", lock_path):
                self.assertFalse(collector._acquire_collector_lock())

    @patch("zgiis.live.spider_site_status.get_cached_spider_site_statuses")
    def test_snapshot_rows_prefer_spider_status(self, spider_statuses) -> None:
        spider_statuses.return_value = {
            "by_station": {"nkay": {"status": "offline"}},
            "error": None,
        }
        rows = _status_snapshot_rows({"nkay": {"connected": True}})
        nkayi = next(row for row in rows if row["station_code"] == "nkay")

        self.assertEqual(nkayi["status"], "offline")
        self.assertEqual(nkayi["source"], "spider_site_status")

    @patch("zgiis.live.spider_site_status.get_cached_spider_site_statuses")
    def test_snapshot_rows_fall_back_to_ntrip(self, spider_statuses) -> None:
        spider_statuses.return_value = {"by_station": {}, "error": "unreachable"}
        rows = _status_snapshot_rows({})
        nkayi = next(row for row in rows if row["station_code"] == "nkay")

        self.assertEqual(nkayi["source"], "collector_ntrip_fallback")


if __name__ == "__main__":
    unittest.main()
