"""Tests for private broadcast recipients file sync."""
from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from zgiis.db import broadcast_recipient_db as brd
from zgiis.navigation.broadcast_recipients_file import load_recipients_file, sync_recipients_from_file


class BroadcastRecipientsFileTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self._db_path = Path(self._tmpdir.name) / "recipients.sqlite"
        patcher = patch.object(brd, "_SQLITE_PATH", self._db_path)
        patcher.start()
        self.addCleanup(patcher.stop)

    def tearDown(self) -> None:
        self._tmpdir.cleanup()

    def test_load_and_sync_phone(self) -> None:
        file_path = Path(self._tmpdir.name) / "recipients.json"
        file_path.write_text(
            json.dumps(
                [
                    {
                        "recipient_type": "phone",
                        "whatsapp_to": "263771234567",
                        "display_name": "Private Farmers Contact",
                        "audience": "farmer",
                    }
                ]
            ),
            encoding="utf-8",
        )

        rows = load_recipients_file(file_path)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["display_name"], "Private Farmers Contact")

        result = sync_recipients_from_file(path=file_path)
        self.assertEqual(result["synced"], 1)

        db = brd.BroadcastRecipientDB()
        listed = db.list_recipients()
        self.assertEqual(len(listed), 1)
        self.assertEqual(listed[0]["whatsapp_to"], "263771234567")
        db.close()


if __name__ == "__main__":
    unittest.main()
