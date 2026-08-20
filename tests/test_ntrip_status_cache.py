"""Tests for NTRIP probe status cache helpers."""
from __future__ import annotations

import unittest

from zgiis.live.ntrip_status_cache import verdict_map_status, verdict_site_label


class NtripStatusCacheTests(unittest.TestCase):
    def test_verdict_map_status(self) -> None:
        self.assertEqual(verdict_map_status("msm_streaming"), "online")
        self.assertEqual(verdict_map_status("rtcm_no_msm"), "offline")
        self.assertEqual(verdict_map_status("connected_no_data"), "offline")
        self.assertEqual(verdict_map_status("offline"), "offline")

    def test_verdict_site_label(self) -> None:
        self.assertIn("Connected", verdict_site_label("msm_streaming"))
        self.assertIn("Connected", verdict_site_label("rtcm_no_msm"))


if __name__ == "__main__":
    unittest.main()
