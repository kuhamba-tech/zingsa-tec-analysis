"""Tests for Navigation News audience role metadata."""
from __future__ import annotations

import unittest

from zgiis.navigation.audience_roles import AUDIENCE_ROLE_BY_ID, enrich_recipient


class AudienceRolesTests(unittest.TestCase):
    def test_citizen_is_space_enthusiast(self) -> None:
        meta = AUDIENCE_ROLE_BY_ID["citizen"]
        self.assertEqual(meta["role"], "Space enthusiast")
        self.assertEqual(meta["title"], "Space Weather & You")

    def test_enrich_recipient_adds_labels(self) -> None:
        out = enrich_recipient({"audience": "farmer", "display_name": "Test"})
        self.assertEqual(out["audience_role"], "Farmer")
        self.assertEqual(out["audience_title"], "Farmer Brief")


if __name__ == "__main__":
    unittest.main()
