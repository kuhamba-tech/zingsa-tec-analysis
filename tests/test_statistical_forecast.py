import asyncio
import unittest
from unittest.mock import patch

import numpy as np
import pandas as pd
from fastapi import HTTPException

from backend.routers.forecast import statistical_forecast


class StatisticalForecastTests(unittest.TestCase):
    def test_forecast_uses_numpy_and_returns_requested_horizon(self):
        dates = pd.date_range("2025-01-01", periods=400, freq="D")
        t = np.arange(len(dates), dtype=float)
        frame = pd.DataFrame(
            {
                "date": dates,
                "vtec": 18.0 + 0.002 * t + 3.0 * np.sin(2 * np.pi * t / 365.25),
            }
        )

        with patch("zgiis.data.tec_archive.load_historical_tec", return_value=(frame, {})):
            result = asyncio.run(statistical_forecast(horizon_days=7, _=None))

        self.assertEqual(len(result), 7)
        self.assertTrue(all(point.lower <= point.predicted_vtec <= point.upper for point in result))
        self.assertEqual(result[0].t, "2026-02-05")

    def test_forecast_accepts_aggregated_archive_schema(self):
        dates = pd.date_range("2025-01-01", periods=40, freq="D")
        frame = pd.DataFrame({"timestamp": dates, "mean_vtec": np.linspace(12.0, 18.0, len(dates))})

        with patch("zgiis.data.tec_archive.load_historical_tec", return_value=(frame, {})):
            result = asyncio.run(statistical_forecast(horizon_days=3, _=None))

        self.assertEqual(len(result), 3)

    def test_missing_archive_returns_service_unavailable(self):
        with patch("zgiis.data.tec_archive.load_historical_tec", return_value=(pd.DataFrame(), {})):
            with self.assertRaises(HTTPException) as raised:
                asyncio.run(statistical_forecast(horizon_days=3, _=None))

        self.assertEqual(raised.exception.status_code, 503)


if __name__ == "__main__":
    unittest.main()
