"""Tests for GOP-style TEC plot series used on the processing page."""
from __future__ import annotations

import unittest

import numpy as np
import pandas as pd

from zgiis.processing.goptec_plot import build_tec_plot_series


class TecPlotSeriesTests(unittest.TestCase):
    def test_builds_mean_and_prn_datasets(self):
        n = 120
        df = pd.DataFrame(
            {
                "timestamp": pd.date_range("2024-06-20", periods=n, freq="5min"),
                "prn": ["G01"] * n,
                "vtec": np.linspace(10, 30, n),
                "vtec_raw": np.linspace(12, 32, n),
            }
        )
        plot = build_tec_plot_series(df, value_col="vtec")
        self.assertGreater(len(plot["mean"]), 0)
        self.assertGreater(len(plot["datasets"]), 0)
        self.assertEqual(plot["ylabel"], "VTEC (TECU)")

    def test_empty_frame_returns_safe_defaults(self):
        plot = build_tec_plot_series(pd.DataFrame(), value_col="vtec")
        self.assertEqual(plot["datasets"], [])
        self.assertEqual(plot["mean"], [])


if __name__ == "__main__":
    unittest.main()
