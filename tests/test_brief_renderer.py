"""Tests for language and accessibility Navigation News rendering."""
from __future__ import annotations

import unittest

from zgiis.navigation.brief_renderer import render_brief_for_recipient


SAMPLE_BRIEF = {
    "id": "farmer",
    "headline": "Quiet space weather — good day for GPS-guided farming",
    "summary": "Space weather is calm today.",
    "space_weather_today": "Mild space weather above Zimbabwe",
    "space_weather_bullets": ["Geomagnetic activity is quiet (Kp 2.0)"],
    "bullets": ["Field GPS outlook: Excellent", "RTK reliability: 95%"],
    "action": "Proceed with precision field work this morning.",
    "status_tone": "excellent",
    "broadcast_script": "English full script here",
    "social_script": "Short social post",
}


class BriefRendererTests(unittest.TestCase):
    def test_english_standard_uses_broadcast_script(self) -> None:
        text = render_brief_for_recipient(SAMPLE_BRIEF, language="en", accessibility="standard")
        self.assertEqual(text, "English full script here")

    def test_shona_includes_local_labels(self) -> None:
        text = render_brief_for_recipient(SAMPLE_BRIEF, language="sn", accessibility="standard")
        self.assertIn("Brief Yevapurazi", text)
        self.assertIn("Mamiriro ekuteerera nhasi", text)
        self.assertIn("Mamiriro ekuteerera ari akadzikama", text)

    def test_deaf_includes_visual_header(self) -> None:
        text = render_brief_for_recipient(SAMPLE_BRIEF, language="en", accessibility="deaf")
        self.assertIn("VISUAL BRIEF", text)
        self.assertIn("🟢 OK", text)

    def test_blind_strips_emojis_and_expands_gps(self) -> None:
        text = render_brief_for_recipient(SAMPLE_BRIEF, language="en", accessibility="blind")
        self.assertIn("Screen-reader friendly", text)
        self.assertNotIn("🟢", text)
        self.assertIn("global positioning system", text.lower())


if __name__ == "__main__":
    unittest.main()
