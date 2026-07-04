"""Tests for GIC field file parsing."""
from __future__ import annotations

import unittest

from zgiis.gic.ingest import parse_gic_file


class GicIngestTests(unittest.TestCase):
    def test_parse_csv_with_timestamp_and_gic_columns(self):
        csv_text = b"""TIMESTAMP,GIC_A,temp_c
2024-06-01T12:00:00+00:00,3.5,22.1
2024-06-01T12:01:00+00:00,4.2,22.0
"""
        rows = parse_gic_file(csv_text, "sample.csv", "marimba_001")
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["station_id"], "MARIMBA_001")
        self.assertAlmostEqual(rows[0]["gic_a"], 3.5)
        self.assertAlmostEqual(rows[1]["gic_a"], 4.2)
        self.assertEqual(rows[0]["temp_c"], 22.1)

    def test_parse_toa5_header(self):
        toa5 = b'''"TOA5",1,CR1000,12345,CRBasic,2.0,0,0,Example
TIMESTAMP,GIC_Avg,PTemp_C
TS,Watts,C
Avg,Avg,Inst
2024-06-01 12:00:00,1.25,21.5
2024-06-01 12:01:00,2.50,21.4
'''
        rows = parse_gic_file(toa5, "table.dat", "ALASKA_001")
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["station_id"], "ALASKA_001")
        self.assertAlmostEqual(rows[1]["gic_a"], 2.5)

    def test_empty_file_raises(self):
        with self.assertRaises(ValueError):
            parse_gic_file(b"", "empty.csv", "MARIMBA_001")


if __name__ == "__main__":
    unittest.main()
