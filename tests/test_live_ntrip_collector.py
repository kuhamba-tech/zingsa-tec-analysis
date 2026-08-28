import os
import unittest
from unittest.mock import patch

from scripts.live_ntrip_collector import (
    DEFAULT_STATUS_PUSH_URL,
    _status_push_url,
    _status_snapshot_rows,
)


class LiveNtripCollectorTests(unittest.TestCase):
    @patch("backend.env_bootstrap.load_dotenv")
    @patch("backend.env_bootstrap.dotenv_values")
    def test_load_env_prefers_explicitly_enabled_neon(self, env_values, load_dotenv) -> None:
        env_values.return_value = {
            "ALLOW_LEGACY_NEON_DATABASE_URL": "1",
            "SUPABASE_DATABASE_URL": "postgresql://stale.example/supabase",
            "POSTGRES_URL_NON_POOLING": "postgresql://active.example/neondb",
        }
        from scripts.live_ntrip_collector import _load_env

        with patch.dict(
            os.environ,
            {
                "SUPABASE_DATABASE_URL": "postgresql://stale.example/supabase",
                "ZGIIS_LOAD_VERCEL_ENV": "1",
            },
            clear=True,
        ):
            _load_env()
            self.assertNotIn("SUPABASE_DATABASE_URL", os.environ)
            self.assertEqual(os.environ["TSDB_DSN"], "postgresql://active.example/neondb")
            self.assertEqual(os.environ["ALLOW_LEGACY_NEON_DATABASE_URL"], "1")
            self.assertEqual(os.environ["ZGIIS_SKIP_DB_SCHEMA_INIT"], "1")

    @patch("backend.env_bootstrap.load_dotenv")
    @patch("backend.env_bootstrap.dotenv_values")
    def test_load_env_prefers_pooled_neon_url_for_collector(self, env_values, load_dotenv) -> None:
        env_values.return_value = {
            "ALLOW_LEGACY_NEON_DATABASE_URL": "1",
            "POSTGRES_URL": "postgresql://pooled.example/neondb",
            "POSTGRES_URL_NON_POOLING": "postgresql://direct.example/neondb",
        }
        from scripts.live_ntrip_collector import _load_env

        with patch.dict(os.environ, {"ZGIIS_LOAD_VERCEL_ENV": "1"}, clear=True):
            _load_env()
            self.assertEqual(os.environ["TSDB_DSN"], "postgresql://pooled.example/neondb")

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
