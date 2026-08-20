"""Unit tests for Spider Site Status mapping helpers."""
from __future__ import annotations

import unittest

from zgiis.live.spider_site_status import (
    _parse_sites_json,
    _station_code_from_site_code,
    spider_status_to_map,
)


class SpiderSiteStatusTests(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
