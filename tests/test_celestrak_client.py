"""Tests for CelesTrak space-weather CSV parsing."""
import unittest
from datetime import date

from zgiis.space_weather.celestrak_client import _parse_csv, build_analysis


SAMPLE_CSV = (
    "DATE,BSRN,ND,KP1,KP2,KP3,KP4,KP5,KP6,KP7,KP8,KP_SUM,AP1,AP2,AP3,AP4,AP5,AP6,AP7,AP8,AP_AVG,"
    "CP,C9,ISN,F10.7_OBS,F10.7_ADJ,F10.7_DATA_TYPE,F10.7_OBS_CENTER81,F10.7_OBS_LAST81,"
    "F10.7_ADJ_CENTER81,F10.7_ADJ_LAST81\n"
    "2024-04-01,2600,8,17,33,37,53,17,20,23,13,213,6,18,22,32,6,7,9,5,13,0.6,3,31,120.4,120.3,OBS,163.7,164.0,163.6,160.6\n"
    "2024-04-02,2600,9,10,13,17,13,10,7,13,17,100,4,5,6,5,4,3,5,6,5,0.2,1,28,118.0,117.9,OBS,163.0,163.5,162.9,160.0\n"
)


class CelestrakClientTests(unittest.TestCase):
    def test_parse_csv_computes_kp_and_storm_flag(self):
        rows = _parse_csv(SAMPLE_CSV, date(2024, 4, 1), date(2024, 4, 2))
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["date"], "2024-04-01")
        self.assertEqual(rows[0]["kp"], 5.3)
        self.assertTrue(rows[0]["storm_flag"])
        self.assertEqual(rows[1]["kp"], 1.7)
        self.assertFalse(rows[1]["storm_flag"])

    def test_build_analysis_merges_vtec(self):
        rows = _parse_csv(SAMPLE_CSV, date(2024, 4, 1), date(2024, 4, 2))
        out = build_analysis(rows, {"2024-04-01": 22.5, "2024-04-02": 18.0})
        self.assertEqual(out["storm_days"], 1)
        self.assertEqual(out["mean_vtec_storm"], 22.5)
        self.assertEqual(out["mean_vtec_quiet"], 18.0)


if __name__ == "__main__":
    unittest.main()
