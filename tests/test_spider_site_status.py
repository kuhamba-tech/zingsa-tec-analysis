"""Unit tests for Spider Site Status mapping helpers."""
from __future__ import annotations

import time
import unittest
from unittest.mock import patch

import zgiis.live.spider_site_status as spider_module
from zgiis.live.spider_site_status import (
    _parse_sites_json,
    _spider_base_url,
    _station_code_from_site_code,
    ensure_spider_site_statuses,
    spider_status_to_map,
)


class SpiderSiteStatusTests(unittest.TestCase):
    @patch.dict("os.environ", {"NTRIP_HOST": "http://41.174.184.62"}, clear=True)
    def test_spider_base_url_preserves_existing_scheme(self) -> None:
        self.assertEqual(_spider_base_url(), "http://41.174.184.62/sbc")

    @patch.dict("os.environ", {"NTRIP_HOST": "41.174.184.62"}, clear=True)
    def test_spider_base_url_accepts_bare_host(self) -> None:
        self.assertEqual(_spider_base_url(), "http://41.174.184.62/sbc")

    @patch.dict("os.environ", {"NTRIP_HOST": "https://example.test/sbc/"}, clear=True)
    def test_spider_base_url_does_not_duplicate_sbc_path(self) -> None:
        self.assertEqual(_spider_base_url(), "https://example.test/sbc")

    def test_status_3_is_online(self) -> None:
        self.assertEqual(spider_status_to_map(3), "online")

    def test_status_2_is_offline(self) -> None:
        self.assertEqual(spider_status_to_map(2), "offline")

    def test_status_0_is_offline(self) -> None:
        self.assertEqual(spider_status_to_map(0), "offline")

    def test_station_code_strips_trailing_underscore(self) -> None:
        self.assertEqual(_station_code_from_site_code("GSU_"), "gsu")
        self.assertEqual(_station_code_from_site_code("BING"), "bing")

    def test_parse_sites_json(self) -> None:
        html = """
        <script>
        var Sites = [{"SiteCode":"BULA","Status":2},{"SiteCode":"BING","Status":3}];
        </script>
        """
        rows = _parse_sites_json(html)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["SiteCode"], "BULA")
        self.assertEqual(rows[1]["Status"], 3)

    def test_live_ensure_does_not_return_plain_memory_after_refresh_failure(self) -> None:
        """In-memory rows without durable markers must not be re-served after a failed live pull."""
        stale = {
            "fetched_at": "2026-07-02T10:14:15Z",
            "by_station": {"nkay": {"status": "online"}},
            "error": None,
        }
        failed = {
            "fetched_at": "2026-08-24T12:00:00Z",
            "by_station": {},
            "error": "Spider unreachable",
        }
        with (
            patch.object(spider_module, "_CACHE", stale),
            patch.object(spider_module, "_CACHE_TS", time.monotonic() - 600),
            patch.object(spider_module, "_DISK_LOADED", True),
            patch.object(spider_module, "spider_status_enabled", return_value=True),
            patch.object(spider_module, "fetch_spider_site_statuses", return_value=failed),
            patch.object(spider_module, "_read_durable_cache", return_value=None),
            patch.object(spider_module, "_read_disk_cache", return_value=None),
        ):
            result = ensure_spider_site_statuses(max_age_sec=15.0)

        self.assertEqual(result["by_station"], {})
        self.assertEqual(result["error"], "Spider unreachable")

    def test_live_ensure_does_not_serve_durable_spider_as_current(self) -> None:
        """Last-good storage must not masquerade as current live status."""
        durable = {
            "fetched_at": "2026-08-24T18:00:00Z",
            "by_station": {
                "hara": {"status": "online"},
                "bing": {"status": "offline"},
            },
            "disk_saved_at": time.time() - 30,
            "from_durable_store": True,
            "error": None,
        }
        failed = {
            "fetched_at": "2026-08-24T18:05:00Z",
            "by_station": {},
            "error": "Spider unreachable",
        }
        with (
            patch.object(spider_module, "_CACHE", None),
            patch.object(spider_module, "_CACHE_TS", 0.0),
            patch.object(spider_module, "_DISK_LOADED", True),
            patch.object(spider_module, "spider_status_enabled", return_value=True),
            patch.object(spider_module, "fetch_spider_site_statuses", return_value=failed),
            patch.object(spider_module, "_read_durable_cache", return_value=durable),
            patch.object(spider_module, "_read_disk_cache", return_value=None),
        ):
            result = ensure_spider_site_statuses(max_age_sec=0.0)

        self.assertEqual(result["by_station"], {})
        self.assertEqual(result.get("error"), "Spider unreachable")

    def test_historical_caller_can_explicitly_request_durable_fallback(self) -> None:
        durable = {
            "fetched_at": "2026-08-24T18:00:00Z",
            "by_station": {"hara": {"status": "online"}},
            "disk_saved_at": time.time() - 30,
            "from_durable_store": True,
            "error": None,
        }
        failed = {"fetched_at": None, "by_station": {}, "error": "Spider unreachable"}
        with (
            patch.object(spider_module, "_CACHE", None),
            patch.object(spider_module, "_CACHE_TS", 0.0),
            patch.object(spider_module, "_DISK_LOADED", True),
            patch.object(spider_module, "spider_status_enabled", return_value=True),
            patch.object(spider_module, "fetch_spider_site_statuses", return_value=failed),
            patch.object(spider_module, "_read_durable_cache", return_value=durable),
            patch.object(spider_module, "_read_disk_cache", return_value=None),
        ):
            result = ensure_spider_site_statuses(max_age_sec=0.0, allow_stale_fallback=True)

        self.assertEqual(result["by_station"]["hara"]["status"], "online")
        self.assertTrue(result.get("served_from_durable"))


if __name__ == "__main__":
    unittest.main()
