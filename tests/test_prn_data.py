"""Tests for PRN Explorer data loader."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

import pandas as pd

from zgiis.gnss_prn.prn_data import (
    add_ionosphere_indicators,
    aggregate_prn_rows,
    format_prn,
    load_cmn_prn_observations,
    _normalize_obs_df,
)


class PrnDataTests(unittest.TestCase):
    def test_format_prn_numeric_gps(self):
        self.assertEqual(format_prn(1, "GPS"), "G01")
        self.assertEqual(format_prn("12", "Galileo"), "E12")

    def test_format_prn_rejects_all(self):
        self.assertIsNone(format_prn("ALL"))
        self.assertIsNone(format_prn(""))

    def test_normalize_live_columns(self):
        df = pd.DataFrame({
            "timestamp": ["2024-04-01T12:00:00Z"],
            "station": ["chim"],
            "prn": ["G01"],
            "vtec_tecu": [12.5],
            "stec_tecu": [18.0],
            "elevation_deg": [45.0],
            "cnr_dbhz": [42.0],
        })
        out = _normalize_obs_df(df)
        self.assertEqual(out.iloc[0]["prn"], "G01")
        self.assertAlmostEqual(float(out.iloc[0]["vtec"]), 12.5)
        self.assertIsNotNone(out.iloc[0]["quality"])

    def test_aggregate_prn_rows(self):
        df = pd.DataFrame({
            "prn": ["G01", "G01", "G02"],
            "constellation": ["GPS", "GPS", "GPS"],
            "vtec": [10.0, 12.0, 8.0],
            "stec": [15.0, 17.0, 11.0],
            "elevation_deg": [30.0, 40.0, 25.0],
            "quality": [80.0, 85.0, 70.0],
        })
        rows = aggregate_prn_rows(df)
        self.assertEqual(len(rows), 2)
        g01 = next(r for r in rows if r["prn"] == "G01")
        self.assertAlmostEqual(g01["mean_vtec"], 11.0)
        self.assertEqual(g01["samples"], 2)

    def test_roti_cycle_slip_and_integrity_metrics(self):
        df = pd.DataFrame({
            "timestamp": pd.date_range("2024-04-01T00:00:00Z", periods=8, freq="30s"),
            "station": ["chim"] * 8,
            "prn": ["G01"] * 8,
            "constellation": ["GPS"] * 8,
            "vtec": [10.0, 10.1, 10.3, 10.5, 22.0, 22.2, 22.4, 22.6],
            "stec": [15.0, 15.2, 15.5, 15.8, 45.0, 45.3, 45.6, 45.9],
            "elevation_deg": [45.0] * 8,
            "quality": [85.0] * 8,
            "cnr_dbhz": [42.0, 41.5, 42.2, 41.8, 39.0, 38.5, 39.3, 39.1],
        })
        enriched = add_ionosphere_indicators(df)
        self.assertIn("rot_tecu_per_min", enriched.columns)
        self.assertIn("roti_tecu_per_min", enriched.columns)
        self.assertTrue(enriched["cycle_slip_flag"].any())

        rows = aggregate_prn_rows(enriched)
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertGreater(row["max_roti"], 0.0)
        self.assertGreater(row["cycle_slip_count"], 0)
        self.assertIsNotNone(row["integrity_score"])
        self.assertIsNotNone(row["ppp_convergence_min"])
        self.assertIn(row["roti_level"], {"quiet", "mild", "moderate", "strong"})

    def test_load_cmn_from_temp_folder(self):
        sample = """# header
# header
# mjdate time prn az elevation lat lon stec vtec s4
60481 6.0 1 45 35 -17.8 31.0 24.0 14.0 0.10
60481 7.0 2 120 42 -17.7 31.1 27.0 16.0 0.12
"""
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "chim092-2024-04-01.Cmn"
            path.write_text(sample, encoding="utf-8")
            import os
            os.environ["ZGIIS_CMN_SOURCE"] = tmp
            try:
                df = load_cmn_prn_observations(start="2024-04-01", end="2024-04-01", elev_min=20)
            finally:
                os.environ.pop("ZGIIS_CMN_SOURCE", None)
        self.assertFalse(df.empty)
        self.assertIn("G01", df["prn"].tolist())
        self.assertIn("azimuth_deg", df.columns)


if __name__ == "__main__":
    unittest.main()
