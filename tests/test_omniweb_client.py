"""Tests for NASA OMNIWeb response parsing."""
import unittest

from zgiis.space_weather.omniweb_client import (
    _aggregate_daily,
    _parse_omni_html,
    build_analysis,
)


SAMPLE_HTML = """
<B>Listing for omni2 data from 20240401 to 20240402</B><hr><pre>Selected parameters:
 1 R (Sunspot No.)
 2 Kp index
 3 Dst-index, nT
 4 f10.7_index

YEAR DOY HR  1   2    3     4 
2024  92  0  31 17    -4 120.3
2024  92 12  31 33   -17 120.3
2024  92 18  31 50   -55 120.3
2024  93  0  28 10    -9 112.7
2024  93 12  28 17   -21 112.7
"""


class OmniWebClientTests(unittest.TestCase):
    def test_parse_and_aggregate_daily(self):
        hourly = _parse_omni_html(SAMPLE_HTML)
        self.assertEqual(len(hourly), 5)
        daily = _aggregate_daily(hourly)
        self.assertEqual(len(daily), 2)
        self.assertEqual(daily[0]["date"], "2024-04-01")
        self.assertEqual(daily[0]["kp"], 5.0)
        self.assertEqual(daily[0]["dst"], -55)
        self.assertTrue(daily[0]["storm_flag"])

    def test_build_analysis_merges_vtec(self):
        daily = _aggregate_daily(_parse_omni_html(SAMPLE_HTML))
        out = build_analysis(daily, {"2024-04-01": 22.5, "2024-04-02": 18.0})
        self.assertEqual(out["storm_days"], 1)
        self.assertEqual(out["mean_vtec_storm"], 22.5)
        self.assertEqual(out["mean_vtec_quiet"], 18.0)


if __name__ == "__main__":
    unittest.main()
