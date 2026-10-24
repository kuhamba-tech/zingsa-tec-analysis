"""Tests for Navigation News WhatsApp recipient registry."""
from __future__ import annotations

import unittest

from tests.supabase_isolation import prepare
from zgiis.db import broadcast_recipient_db as brd


class BroadcastRecipientDbTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = brd.BroadcastRecipientDB(
            dsn=prepare("broadcast_recipients", "broadcast_delivery_log")
        )

    def tearDown(self) -> None:
        self.db.close()

    def test_create_and_list_recipient(self) -> None:
        rec = self.db.create_recipient(
            recipient_type="phone",
            whatsapp_to="+263 77 123 4567",
            display_name="Test Farmer Group",
            audience="farmer",
        )
        self.assertEqual(rec["whatsapp_to"], "263771234567")
        self.assertEqual(rec["display_name"], "Test Farmer Group")
        self.assertTrue(rec["active"])
        listed = self.db.list_recipients()
        self.assertEqual(len(listed), 1)

    def test_duplicate_whatsapp_rejected(self) -> None:
        self.db.create_recipient(
            recipient_type="phone",
            whatsapp_to="263771234567",
            display_name="First",
        )
        with self.assertRaises(ValueError):
            self.db.create_recipient(
                recipient_type="phone",
                whatsapp_to="263771234567",
                display_name="Duplicate",
            )

    def test_create_recipient_with_language_accessibility(self) -> None:
        rec = self.db.create_recipient(
            recipient_type="phone",
            whatsapp_to="263771234568",
            display_name="ZINGSA Farmer Contact",
            audience="farmer",
            language="sn",
            accessibility="deaf",
        )
        self.assertEqual(rec["language"], "sn")
        self.assertEqual(rec["accessibility"], "deaf")

    def test_normalize_requires_min_digits(self) -> None:
        with self.assertRaises(ValueError):
            brd.normalize_whatsapp_to("123")

    def test_group_recipient_type_rejected(self) -> None:
        """WhatsApp Cloud API has no group endpoint — only "phone" is supported."""
        with self.assertRaises(ValueError):
            self.db.create_recipient(
                recipient_type="group",
                whatsapp_to="263771234569",
                display_name="Should be rejected",
            )


if __name__ == "__main__":
    unittest.main()
