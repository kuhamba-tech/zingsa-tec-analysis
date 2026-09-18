"""Tests for GIC report period resampling configuration."""
from __future__ import annotations

import unittest

from zgiis.gic.analysis import REPORT_PERIODS


class GicReportPeriodTests(unittest.TestCase):
    def test_daily_and_longer_periods_define_resample(self):
        self.assertIsNone(REPORT_PERIODS["hourly"]["resample"])
        self.assertEqual(REPORT_PERIODS["daily"]["resample"], "10min")
        self.assertEqual(REPORT_PERIODS["weekly"]["resample"], "1h")
        self.assertEqual(REPORT_PERIODS["monthly"]["resample"], "3h")
        self.assertEqual(REPORT_PERIODS["yearly"]["resample"], "1D")

    def test_all_periods_have_hours_and_label(self):
        for period, meta in REPORT_PERIODS.items():
            self.assertIn("hours", meta, msg=period)
            self.assertIn("label", meta, msg=period)
            self.assertGreater(meta["hours"], 0)


if __name__ == "__main__":
    unittest.main()
