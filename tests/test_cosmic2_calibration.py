"""Tests for the COSMIC-2 <-> CORS OLS calibration."""
from __future__ import annotations

import unittest

import numpy as np

from zgiis.cosmic2.calibration import fit_ols_calibration


class CalibrationTests(unittest.TestCase):
    def test_recovers_known_slope_intercept(self):
        rng = np.random.default_rng(42)
        x = np.linspace(5, 50, 20)
        true_slope, true_intercept = 1.2, 1.8
        y = true_slope * x + true_intercept + rng.normal(0, 0.01, size=x.size)
        result = fit_ols_calibration(x, y, min_samples=10)
        self.assertEqual(result.status, "ok")
        self.assertAlmostEqual(result.slope, true_slope, places=2)
        self.assertAlmostEqual(result.intercept, true_intercept, places=1)
        self.assertEqual(result.sample_count, 20)

    def test_insufficient_samples_no_fabricated_numbers(self):
        x = np.array([1.0, 2.0, 3.0])
        y = np.array([1.0, 2.0, 3.0])
        result = fit_ols_calibration(x, y, min_samples=10)
        self.assertEqual(result.status, "insufficient_samples")
        self.assertIsNone(result.slope)
        self.assertIsNone(result.intercept)
        self.assertIsNone(result.r_squared)
        self.assertIn("Insufficient", result.message)

    def test_perfect_fit_rmse_mae_bias_and_pearson(self):
        x = np.arange(1.0, 11.0)
        y = x + 1.0  # perfectly linear
        result = fit_ols_calibration(x, y, min_samples=10)
        self.assertAlmostEqual(result.slope, 1.0, places=6)
        self.assertAlmostEqual(result.intercept, 1.0, places=6)
        self.assertAlmostEqual(result.rmse_tecu, 0.0, places=6)
        self.assertAlmostEqual(result.mae_tecu, 0.0, places=6)
        self.assertAlmostEqual(result.mean_bias_tecu, 0.0, places=6)
        self.assertAlmostEqual(result.pearson_r, 1.0, places=6)
        self.assertAlmostEqual(result.r_squared, 1.0, places=6)


if __name__ == "__main__":
    unittest.main()
