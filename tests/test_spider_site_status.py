"""Unit tests for Spider Site Status mapping helpers."""
from __future__ import annotations

import unittest
import time
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

    def test_live_ensure_does_not_return_stale_cache_after_refresh_failure(self) -> None:
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
        ):
            result = ensure_spider_site_statuses(max_age_sec=15.0)

        self.assertEqual(result["by_station"], {})
        self.assertEqual(result["error"], "Spider unreachable")


if __name__ == "__main__":
    unittest.main()
