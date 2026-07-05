"""Tests for EKF deviation alert evaluation."""
from __future__ import annotations

import unittest

from zgiis.space_weather.ekf import EkfPoint
from zgiis.space_weather.ekf_alerts import MIN_HISTORY, evaluate


def _series(errors: list[float], *, param: str = "kp") -> dict[str, list[EkfPoint]]:
    points: list[EkfPoint] = []
    for i, err in enumerate(errors):
        obs = 3.0 + err
        pred = 3.0
        points.append(
            EkfPoint(
                t=f"2024-06-01T12:{i:02d}:00+00:00",
                observed=obs,
                predicted=pred,
                error=err,
                confidence=90.0,
            )
        )
    return {param: points}


class EkfAlertsTests(unittest.TestCase):
    def test_insufficient_history_produces_no_alert(self):
        errors = [0.1] * (MIN_HISTORY - 1) + [5.0]
        result = evaluate(_series(errors))
        self.assertEqual(result["alerts"], [])
        self.assertFalse(result["status"]["kp"]["available"])

    def test_large_drift_triggers_alert(self):
        errors = [0.1] * MIN_HISTORY + [5.0]
        result = evaluate(_series(errors))
        self.assertEqual(len(result["alerts"]), 1)
        alert = result["alerts"][0]
        self.assertEqual(alert["parameter"], "kp")
        self.assertGreaterEqual(alert["prediction_error"], 5.0)
        self.assertIn(alert["severity"], {"Moderate", "High", "Severe"})

    def test_small_drift_below_threshold_is_silent(self):
        errors = [0.2] * MIN_HISTORY + [0.15]
        result = evaluate(_series(errors))
        self.assertEqual(result["alerts"], [])

    def test_severe_when_multiple_parameters_deviate(self):
        base = [0.1] * MIN_HISTORY + [5.0]
        series = _series(base, param="kp")
        series["dst"] = _series(base, param="dst")["dst"]
        series["s4"] = _series(base, param="s4")["s4"]
        result = evaluate(series)
        self.assertGreaterEqual(len(result["alerts"]), 1)
        severities = {a["severity"] for a in result["alerts"]}
        self.assertIn("Severe", severities)

    def test_related_indicators_lists_other_abnormal_params(self):
        base = [0.1] * MIN_HISTORY + [5.0]
        series = _series(base, param="kp")
        series["dst"] = _series(base, param="dst")["dst"]
        result = evaluate(series)
        kp_alert = next(a for a in result["alerts"] if a["parameter"] == "kp")
        self.assertIn("Dst Index", kp_alert["related_indicators"])


if __name__ == "__main__":
    unittest.main()
