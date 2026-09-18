"""Tests for COSMIC-2 persistence (SQLite backend)."""
from __future__ import annotations

import tempfile
import unittest
from datetime import date
from pathlib import Path
from unittest.mock import patch

from zgiis.db import cosmic2_db as c2db

_PROFILE_BASE = {
    "day": "2024-04-01", "occ_time": "2024-04-01T00:02:30+00:00",
    "tangent_lat": -17.8, "tangent_lon": 31.0, "source_file": "f",
    "quality_status": "ok", "quality_reasons": "", "valid_sample_count": 60,
    "nmf2_el_m3": 5e11, "hmf2_km": 300.0, "fof2_mhz": 6.4, "partial_tec_tecu": 15.0,
    "tec_integration_min_km": 100.0, "tec_integration_max_km": 600.0,
    "computed_at": "2024-04-01T01:00:00+00:00",
}
_MATCH_BASE = {
    "day": "2024-04-01", "station_code": "hara", "station_distance_km": 50.0,
    "cors_timestamp": "2024-04-01T00:03:00+00:00", "cors_vtec_tecu": 22.0,
    "time_delta_minutes": 0.5, "match_valid": True, "match_quality": "high",
    "match_reason": "matched", "computed_at": "2024-04-01T01:00:00+00:00",
}


class Cosmic2DBTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        tmp_path = Path(self._tmpdir.name) / "test_cosmic2.sqlite"
        self._patcher = patch.object(c2db, "_SQLITE_PATH", tmp_path)
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        self._tmpdir.cleanup()

    def test_ddl_creates_tables_sqlite(self):
        db = c2db.Cosmic2DB(dsn="")
        self.assertEqual(db.backend, "sqlite")
        cur = db._conn.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = {r[0] for r in cur.fetchall()}
        self.assertIn("cosmic2_profiles", tables)
        self.assertIn("cosmic2_matches", tables)
        self.assertIn("cosmic2_calibration_runs", tables)
        db.close()

    def test_upsert_profiles_idempotent(self):
        db = c2db.Cosmic2DB(dsn="")
        row = {**_PROFILE_BASE, "profile_id": "p1"}
        n1 = db.upsert_profiles([row], date(2024, 4, 1), date(2024, 4, 1))
        self.assertEqual(n1, 1)
        n2 = db.upsert_profiles([{**row, "nmf2_el_m3": 6e11}], date(2024, 4, 1), date(2024, 4, 1))
        self.assertEqual(n2, 1)
        df = db.query_profiles(date(2024, 4, 1), date(2024, 4, 1))
        self.assertEqual(len(df), 1)
        self.assertAlmostEqual(float(df.iloc[0]["nmf2_el_m3"]), 6e11)
        db.close()

    def test_query_profiles_filters_by_quality_status(self):
        db = c2db.Cosmic2DB(dsn="")
        db.upsert_profiles([
            {**_PROFILE_BASE, "profile_id": "ok1", "quality_status": "ok"},
            {**_PROFILE_BASE, "profile_id": "bad1", "quality_status": "rejected", "quality_reasons": "insufficient_samples"},
        ], date(2024, 4, 1), date(2024, 4, 1))
        df = db.query_profiles(date(2024, 4, 1), date(2024, 4, 1), quality_status="ok")
        self.assertEqual(len(df), 1)
        self.assertEqual(df.iloc[0]["profile_id"], "ok1")
        db.close()

    def test_query_profile_single(self):
        db = c2db.Cosmic2DB(dsn="")
        db.upsert_profiles([{**_PROFILE_BASE, "profile_id": "p2"}], date(2024, 4, 1), date(2024, 4, 1))
        found = db.query_profile("p2")
        self.assertIsNotNone(found)
        self.assertEqual(found["profile_id"], "p2")
        self.assertIsNone(db.query_profile("does-not-exist"))
        db.close()

    def test_upsert_matches_idempotent(self):
        db = c2db.Cosmic2DB(dsn="")
        row = {**_MATCH_BASE, "profile_id": "p1"}
        n1 = db.upsert_matches([row], date(2024, 4, 1), date(2024, 4, 1))
        self.assertEqual(n1, 1)
        n2 = db.upsert_matches([{**row, "cors_vtec_tecu": 23.0}], date(2024, 4, 1), date(2024, 4, 1))
        self.assertEqual(n2, 1)
        df = db.query_matches(date(2024, 4, 1), date(2024, 4, 1))
        self.assertEqual(len(df), 1)
        self.assertAlmostEqual(float(df.iloc[0]["cors_vtec_tecu"]), 23.0)
        db.close()

    def test_upsert_calibration_run_idempotent(self):
        db = c2db.Cosmic2DB(dsn="")
        row = {
            "start_date": "2024-04-01", "end_date": "2024-04-05", "slope": 1.2, "intercept": 1.8,
            "r_squared": 0.8, "pearson_r": 0.9, "rmse_tecu": 2.0, "mae_tecu": 1.5, "mean_bias_tecu": 0.1,
            "sample_count": 15, "status": "ok", "message": "OLS calibration fit from 15 matched profile(s).",
            "computed_at": "2024-04-05T01:00:00+00:00",
        }
        db.upsert_calibration_run(row)
        db.upsert_calibration_run({**row, "slope": 1.3})
        latest = db.query_latest_calibration(start=date(2024, 4, 1), end=date(2024, 4, 5))
        self.assertAlmostEqual(latest["slope"], 1.3)
        db.close()

    def test_query_latest_calibration_without_range(self):
        db = c2db.Cosmic2DB(dsn="")
        db.upsert_calibration_run({
            "start_date": "2024-04-01", "end_date": "2024-04-05", "slope": 1.0, "intercept": 0.0,
            "r_squared": 0.5, "pearson_r": 0.7, "rmse_tecu": 3.0, "mae_tecu": 2.0, "mean_bias_tecu": 0.0,
            "sample_count": 10, "status": "ok", "message": "m", "computed_at": "2024-04-05T00:00:00+00:00",
        })
        latest = db.query_latest_calibration()
        self.assertIsNotNone(latest)
        db.close()

    def test_summary_counts(self):
        db = c2db.Cosmic2DB(dsn="")
        db.upsert_profiles([{**_PROFILE_BASE, "profile_id": "p1"}], date(2024, 4, 1), date(2024, 4, 1))
        db.upsert_matches([{**_MATCH_BASE, "profile_id": "p1"}], date(2024, 4, 1), date(2024, 4, 1))
        counts = db.summary_counts()
        self.assertEqual(counts["total_profiles"], 1)
        self.assertEqual(counts["total_ok_profiles"], 1)
        self.assertEqual(counts["total_valid_matches"], 1)
        self.assertEqual(counts["latest_profile_day"], "2024-04-01")
        db.close()


if __name__ == "__main__":
    unittest.main()
