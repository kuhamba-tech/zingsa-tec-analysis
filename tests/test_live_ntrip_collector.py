import os
import unittest
from unittest.mock import patch

from scripts.live_ntrip_collector import DEFAULT_STATUS_PUSH_URL, _status_push_url


class LiveNtripCollectorTests(unittest.TestCase):
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
            "https://zingsa-gnss-tec.vercel.app/api/cors-router"
            "?__zr=%2Fcors%2Fstatus%2Fsnapshots",
        )

    def test_custom_collector_endpoint_is_preserved(self) -> None:
        custom = "https://collector.example/api/status"
        with patch.dict(os.environ, {"STATUS_SNAPSHOT_PUSH_URL": custom}):
            self.assertEqual(_status_push_url(), custom)


if __name__ == "__main__":
    unittest.main()
