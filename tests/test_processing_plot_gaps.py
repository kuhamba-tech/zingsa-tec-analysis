import unittest

import numpy as np

from zgiis.processing.plot_gaps import gap_break_indices


class ProcessingPlotGapTests(unittest.TestCase):
    def test_daily_numeric_hours_use_fifteen_minute_threshold(self):
        values = np.array([0.0, 0.1, 0.2, 0.6, 0.7])

        breaks = gap_break_indices(values, xlabel="UT (hrs)")

        np.testing.assert_array_equal(breaks, np.array([3]))

    def test_month_numeric_days_use_one_day_threshold(self):
        values = np.array([1.0, 2.0, 4.0, 5.0])

        breaks = gap_break_indices(values, xlabel="Day of month")

        np.testing.assert_array_equal(breaks, np.array([2]))

    def test_datetime_values_use_timedelta_threshold(self):
        values = np.array(
            ["2024-01-01", "2024-01-02", "2024-01-04"],
            dtype="datetime64[D]",
        )

        breaks = gap_break_indices(values, xlabel="Month")

        np.testing.assert_array_equal(breaks, np.array([2]))


if __name__ == "__main__":
    unittest.main()
