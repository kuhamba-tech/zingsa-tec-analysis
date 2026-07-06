"""Timeline cache resilience on read-only filesystems (e.g. Vercel)."""
from __future__ import annotations

import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.schemas import TimelinePoint
from backend import timeline_cache as tc


class TimelineCacheTests(unittest.TestCase):
    def test_merge_timeline_falls_back_when_cache_is_readonly(self) -> None:
        tmpdir = Path(tempfile.mkdtemp())
        db = tmpdir / "cache.sqlite"
        import sqlite3

        conn = sqlite3.connect(db)
        conn.execute(
            """
            CREATE TABLE space_weather_timeline (
                metric TEXT NOT NULL,
                time_tag TEXT NOT NULL,
                value REAL,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (metric, time_tag)
            )
            """
        )
        conn.commit()
        conn.close()
        os.chmod(db, stat.S_IREAD)

        live = [
            TimelinePoint(t="2026-07-06T12:00:00", v=2.0),
            TimelinePoint(t="2026-07-06T12:01:00", v=3.0),
        ]
        with patch.object(tc, "_db_path", return_value=db):
            merged = tc.merge_timeline("kp", live)

        self.assertEqual(merged, live)

    def test_vercel_uses_temp_db_path(self) -> None:
        with patch.dict(os.environ, {"VERCEL": "1"}, clear=False):
            path = tc._db_path()
        self.assertIn("zgiis_space_weather_timeline_cache.sqlite", str(path))
        self.assertTrue(str(path).startswith(tempfile.gettempdir()))


if __name__ == "__main__":
    unittest.main()
