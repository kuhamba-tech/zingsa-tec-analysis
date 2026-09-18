import unittest

import pandas as pd

from tec_core import mark_storm_days


class StormDayDetectionTests(unittest.TestCase):
    def test_single_day_does_not_classify_itself_as_storm(self):
        daily = pd.DataFrame(
            {
                "date": [pd.Timestamp("2024-04-30")],
                "mean_vtec": [17.8],
                "max_vtec": [22.0],
                "min_vtec": [10.0],
                "samples": [100],
            }
        )

        result = mark_storm_days(daily)

        self.assertFalse(result.loc[0, "storm_flag"])
        self.assertFalse(result.loc[0, "tec_anomaly_flag"])
        self.assertTrue(pd.isna(result.loc[0, "vtec_threshold"]))

    def test_tec_percentile_rule_applies_with_sufficient_baseline(self):
        dates = pd.date_range("2024-04-01", periods=10, freq="D")
        daily = pd.DataFrame(
            {
                "date": dates,
                "mean_vtec": range(10),
                "max_vtec": range(10),
                "min_vtec": range(10),
                "samples": [100] * 10,
            }
        )

        result = mark_storm_days(daily)

        self.assertEqual(int(result["tec_anomaly_flag"].sum()), 1)
        self.assertFalse(result.iloc[-1]["storm_flag"])
        self.assertAlmostEqual(result.iloc[-1]["vtec_threshold"], 8.1)

    def test_kp_rule_still_applies_without_tec_baseline(self):
        daily = pd.DataFrame(
            {
                "date": [pd.Timestamp("2024-04-30")],
                "mean_vtec": [17.8],
                "max_vtec": [22.0],
                "min_vtec": [10.0],
                "samples": [100],
            }
        )
        kp = pd.DataFrame(
            {
                "date": [
                    pd.Timestamp("2024-04-30 00:00"),
                    pd.Timestamp("2024-04-30 03:00"),
                ],
                "kp_index": [3.0, 5.3],
            }
        )

        result = mark_storm_days(daily, kp_df=kp)

        self.assertEqual(len(result), 1)
        self.assertFalse(result.loc[0, "tec_anomaly_flag"])
        self.assertTrue(result.loc[0, "kp_storm_flag"])
        self.assertTrue(result.loc[0, "storm_flag"])
        self.assertEqual(result.loc[0, "kp_index"], 5.3)
        self.assertEqual(result.loc[0, "kp_g_scale"], "G1")
        self.assertEqual(result.loc[0, "kp_condition"], "Minor Storm G1")

    def test_official_noaa_kp_boundaries_assign_g1_through_g5(self):
        dates = pd.date_range("2024-05-01", periods=6, freq="D")
        daily = pd.DataFrame(
            {
                "date": dates,
                "mean_vtec": [20.0] * 6,
                "max_vtec": [25.0] * 6,
                "min_vtec": [10.0] * 6,
                "samples": [100] * 6,
            }
        )
        kp = pd.DataFrame(
            {
                "date": dates,
                "kp_index": [4.9, 5.0, 6.0, 7.0, 8.0, 9.0],
            }
        )

        result = mark_storm_days(daily, kp_df=kp)

        self.assertTrue(pd.isna(result.loc[0, "kp_g_scale"]))
        self.assertEqual(
            result.loc[1:, "kp_g_scale"].tolist(),
            ["G1", "G2", "G3", "G4", "G5"],
        )
        self.assertEqual(
            result["kp_storm_flag"].tolist(),
            [False, True, True, True, True, True],
        )

    def test_tec_response_uses_prior_kp_confirmed_quiet_days(self):
        dates = pd.date_range("2024-04-01", periods=12, freq="D")
        daily = pd.DataFrame(
            {
                "date": dates,
                "mean_vtec": [20.0, 21.0] * 5 + [20.0, 32.0],
                "max_vtec": [25.0, 26.0] * 5 + [25.0, 38.0],
                "min_vtec": [10.0] * 12,
                "samples": [100] * 12,
            }
        )
        kp = pd.DataFrame(
            {
                "date": dates,
                "kp_index": [2.0] * 11 + [5.0],
            }
        )

        result = mark_storm_days(daily, kp_df=kp)
        storm_day = result.iloc[-1]

        self.assertTrue(storm_day["storm_flag"])
        self.assertEqual(storm_day["kp_g_scale"], "G1")
        self.assertAlmostEqual(storm_day["tec_baseline"], 20.0)
        self.assertAlmostEqual(storm_day["tec_deviation_tecu"], 12.0)
        self.assertAlmostEqual(storm_day["tec_deviation_pct"], 60.0)
        self.assertEqual(
            storm_day["tec_response"],
            "Positive ionospheric response",
        )

    def test_tec_anomaly_without_kp_does_not_claim_geomagnetic_storm(self):
        dates = pd.date_range("2024-04-01", periods=10, freq="D")
        daily = pd.DataFrame(
            {
                "date": dates,
                "mean_vtec": list(range(10)),
                "max_vtec": list(range(10)),
                "min_vtec": [0.0] * 10,
                "samples": [100] * 10,
            }
        )

        result = mark_storm_days(daily)

        self.assertTrue(result.iloc[-1]["tec_anomaly_flag"])
        self.assertFalse(result.iloc[-1]["storm_flag"])
        self.assertEqual(
            result.iloc[-1]["tec_response"],
            "Insufficient quiet baseline",
        )


if __name__ == "__main__":
    unittest.main()
