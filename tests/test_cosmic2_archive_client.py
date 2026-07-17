"""Tests for COSMIC-2 real download/cache/extraction (no live network)."""
from __future__ import annotations

import hashlib
import tarfile
import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import MagicMock, patch

from zgiis.cosmic2 import archive_client as ac


class ArchiveClientTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        tmp_root = Path(self._tmpdir.name)
        self._patchers = [
            patch.object(ac, "TARBALL_DIR", tmp_root / "tarballs"),
            patch.object(ac, "EXTRACT_DIR", tmp_root / "extracted"),
        ]
        for p in self._patchers:
            p.start()

    def tearDown(self):
        for p in self._patchers:
            p.stop()
        self._tmpdir.cleanup()

    def test_file_url_convention(self):
        url, filename, doy = ac._file_url(date(2024, 4, 1))
        self.assertEqual(doy, 92)
        self.assertEqual(filename, "ionPrf_prov1_2024_092.tar.gz")
        self.assertEqual(
            url,
            "https://data.cosmic.ucar.edu/gnss-ro/cosmic2/provisional/spaceWeather/level2/2024/092/ionPrf_prov1_2024_092.tar.gz",
        )

    def test_fresh_download_writes_tarball_and_sidecar(self):
        content = b"fake-tarball-bytes"
        mock_resp = MagicMock(status_code=200)
        mock_resp.iter_content.return_value = [content]
        with patch.object(ac.requests, "get", return_value=mock_resp) as mock_get:
            result = ac.download_daily_tarball(date(2024, 4, 1))
        self.assertEqual(result.status, "downloaded")
        self.assertTrue(result.tarball_path.exists())
        self.assertEqual(result.tarball_path.read_bytes(), content)
        self.assertEqual(result.sha256, hashlib.sha256(content).hexdigest())
        sidecar = ac._sidecar_path(result.tarball_path)
        self.assertEqual(sidecar.read_text(encoding="ascii").strip(), result.sha256)
        mock_get.assert_called_once()

    def test_cache_hit_skips_network(self):
        content = b"fake-tarball-bytes"
        mock_resp = MagicMock(status_code=200)
        mock_resp.iter_content.return_value = [content]
        with patch.object(ac.requests, "get", return_value=mock_resp):
            ac.download_daily_tarball(date(2024, 4, 1))
        with patch.object(ac.requests, "get", return_value=mock_resp) as mock_get2:
            result2 = ac.download_daily_tarball(date(2024, 4, 1))
        self.assertTrue(result2.was_cached)
        self.assertEqual(result2.status, "cached")
        mock_get2.assert_not_called()

    def test_missing_day_returns_missing_status(self):
        mock_resp = MagicMock(status_code=404)
        with patch.object(ac.requests, "get", return_value=mock_resp):
            result = ac.download_daily_tarball(date(2024, 4, 1))
        self.assertEqual(result.status, "missing")
        self.assertIsNone(result.tarball_path)

    def test_ensure_extracted_reuses_existing_extraction(self):
        src_dir = Path(self._tmpdir.name) / "src"
        src_dir.mkdir()
        member_path = src_dir / "ionPrf_C2E1.2024.092.00.02.R07_0001.0001_nc"
        member_path.write_bytes(b"dummy")
        tarball_path = Path(self._tmpdir.name) / "test.tar.gz"
        with tarfile.open(tarball_path, "w:gz") as tf:
            tf.add(member_path, arcname=member_path.name)

        day = date(2024, 4, 1)
        extract_dir1 = ac.ensure_extracted(day, tarball_path)
        files = ac.list_profile_files(extract_dir1)
        self.assertEqual(len(files), 1)
        self.assertTrue(files[0].name.endswith("_nc"))

        with patch.object(ac.tarfile, "open") as mock_open:
            extract_dir2 = ac.ensure_extracted(day, tarball_path)
        self.assertEqual(extract_dir1, extract_dir2)
        mock_open.assert_not_called()

    def test_fetch_and_extract_daily_caches_across_calls(self):
        content_dir = Path(self._tmpdir.name) / "src2"
        content_dir.mkdir()
        member_path = content_dir / "ionPrf_C2E1.2024.092.00.02.R07_0001.0001_nc"
        member_path.write_bytes(b"dummy")

        call_count = {"n": 0}

        def fake_get(url, stream=True, timeout=120):
            call_count["n"] += 1
            buf = Path(self._tmpdir.name) / "tmp_tarball.tar.gz"
            with tarfile.open(buf, "w:gz") as tf:
                tf.add(member_path, arcname=member_path.name)
            data = buf.read_bytes()
            resp = MagicMock(status_code=200)
            resp.iter_content.return_value = [data]
            return resp

        with patch.object(ac.requests, "get", side_effect=fake_get):
            r1 = ac.fetch_and_extract_daily(date(2024, 4, 1))
            r2 = ac.fetch_and_extract_daily(date(2024, 4, 1))
        self.assertEqual(r1.status, "ok")
        self.assertEqual(r2.status, "ok")
        self.assertEqual(call_count["n"], 1)


if __name__ == "__main__":
    unittest.main()
