import unittest
from types import SimpleNamespace

from zgiis.device import is_mobile_request


class DeviceDetectionTests(unittest.TestCase):
    def test_detects_mobile_user_agent(self):
        streamlit = SimpleNamespace(
            context=SimpleNamespace(
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Linux; Android 14; Pixel 8) "
                        "AppleWebKit/537.36 Mobile Safari/537.36"
                    )
                }
            )
        )

        self.assertTrue(is_mobile_request(streamlit))

    def test_keeps_desktop_rendering_for_desktop_user_agent(self):
        streamlit = SimpleNamespace(
            context=SimpleNamespace(
                headers={
                    "User-Agent": (
                        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                        "AppleWebKit/537.36 Chrome/126.0"
                    )
                }
            )
        )

        self.assertFalse(is_mobile_request(streamlit))

    def test_missing_context_defaults_to_desktop(self):
        self.assertFalse(is_mobile_request(SimpleNamespace()))
