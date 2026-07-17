"""End-to-end tests for COSMIC-2 pipeline orchestration (mocked archive
download and CORS observation loading — no live network or DB)."""
from __future__ import annotations

import tempfile
import unittest
from datetime import date, datetime, timezone
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd

from zgiis.cosmic2 import pipeline
from zgiis.cosmic2.archive_client import DownloadResult, ExtractResult
from zgiis.cosmic2.netcdf_reader import RawProfile
from zgiis.db import cosmic2_db as c2db

# Real Harare CORS coordinates (zgiis/cors/stations.py) so the pipeline's
# real ZIMBABWE_CORS_STATIONS list deterministically matches this profile
# to "hara" regardless of what other stations exist in the registry.
HARARE_LAT = -17.78140871
HARARE_LON = 31.04856188


def _raw(profile_id: str, lat: float, lon: float, *, valid: bool) -> RawProfile:
    if valid:
        altitude = np.linspace(60, 700, 60)
        density = np.clip(1e12 * (1.0 - ((altitude - 300.0) / 300.0) ** 2), 1e8, None)
    else:
        altitude = np.linspace(200, 250, 5)  # too few samples + bad coverage -> rejected
        density = np.linspace(1e10, 2e10, 5)
    return RawProfile(
        profile_id=profile_id, occ_time=datetime(2024, 4, 1, 12, 0, 0, tzinfo=timezone.utc),
        tangent_lat=lat, tangent_lon=lon, altitude_km=altitude, electron_density_m3=density,
        source_file=f"{profile_id}_nc", reference_nmf2_el_m3=None, reference_hmf2_km=None, reference_fof2_mhz=None,
    )


class PipelineTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        tmp_path = Path(self._tmpdir.name) / "test_pipeline.sqlite"
        self._patcher = patch.object(c2db, "_SQLITE_PATH", tmp_path)
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        self._tmpdir.cleanup()

    def test_analyse_range_rejects_oversized_range(self):
        with self.assertRaises(ValueError):
            pipeline.analyse_range(date(2024, 4, 1), date(2024, 4, 30))

    def test_end_to_end_persists_expected_rows(self):
        day = date(2024, 4, 1)
        extract = ExtractResult(
            day=day,
            download=DownloadResult(
                day=day, tarball_path=Path("fake.tar.gz"), size_bytes=100, sha256="x",
                was_cached=False, status="downloaded", note="",
            ),
            extract_dir=Path(self._tmpdir.name),
            profile_files=[Path("ok_in_box_nc"), Path("bad_in_box_nc"), Path("out_of_box_nc")],
            status="ok", note="3 profile file(s).",
        )
        profiles_by_name = {
            "ok_in_box_nc": _raw("ok_in_box", HARARE_LAT, HARARE_LON, valid=True),
            "bad_in_box_nc": _raw("bad_in_box", HARARE_LAT, HARARE_LON, valid=False),
            "out_of_box_nc": _raw("out_of_box", 45.0, 45.0, valid=True),
        }
        obs_df = pd.DataFrame({
            "station": ["hara"],
            "timestamp": [pd.Timestamp("2024-04-01T12:01:00Z")],
            "vtec": [22.9],
        })

        def fake_read_profile(path):
            return profiles_by_name[path.name]

        with patch("zgiis.cosmic2.pipeline.fetch_and_extract_daily", return_value=extract), \
             patch("zgiis.cosmic2.pipeline.read_profile", side_effect=fake_read_profile), \
             patch("zgiis.cosmic2.pipeline._load_cors_observations", return_value=(obs_df, "archive")):
            result = pipeline.analyse_range(day, day)

        self.assertEqual(result["profiles_found"], 2)  # out_of_box excluded before persisting
        self.assertEqual(result["profiles_valid"], 1)
        self.assertEqual(result["profiles_matched"], 1)
        self.assertEqual(result["cors_stations_used"], 1)

        db = c2db.Cosmic2DB(dsn="")
        try:
            stored = db.query_profiles(day, day)
            self.assertEqual(len(stored), 2)
            self.assertNotIn("out_of_box", stored["profile_id"].tolist())

            ok_row = stored[stored["profile_id"] == "ok_in_box"].iloc[0]
            self.assertEqual(ok_row["quality_status"], "ok")
            self.assertIsNotNone(ok_row["partial_tec_tecu"])

            bad_row = stored[stored["profile_id"] == "bad_in_box"].iloc[0]
            self.assertEqual(bad_row["quality_status"], "rejected")
            self.assertTrue(pd.isna(bad_row["partial_tec_tecu"]))

            matches = db.query_matches(day, day)
            self.assertEqual(len(matches), 1)
            self.assertEqual(matches.iloc[0]["station_code"], "hara")
            self.assertTrue(bool(matches.iloc[0]["match_valid"]))

            calib = db.query_latest_calibration(start=day, end=day)
            self.assertIsNotNone(calib)
            # Only 1 valid match; default min_calibration_samples=10.
            self.assertEqual(calib["status"], "insufficient_samples")
        finally:
            db.close()

    def test_extraction_failure_recorded_as_warning_not_exception(self):
        day = date(2024, 4, 1)
        extract = ExtractResult(
            day=day,
            download=DownloadResult(day=day, tarball_path=None, size_bytes=None, sha256=None, was_cached=False, status="missing", note="UCAR returned HTTP 404"),
            extract_dir=None, profile_files=[], status="missing", note="UCAR returned HTTP 404",
        )
        with patch("zgiis.cosmic2.pipeline.fetch_and_extract_daily", return_value=extract), \
             patch("zgiis.cosmic2.pipeline._load_cors_observations", return_value=(pd.DataFrame(columns=["station", "timestamp", "vtec"]), "none")):
            result = pipeline.analyse_range(day, day)
        self.assertEqual(result["profiles_found"], 0)
        self.assertEqual(len(result["warnings"]), 1)


if __name__ == "__main__":
    unittest.main()
