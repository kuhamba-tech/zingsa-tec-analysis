import unittest

from tests.supabase_isolation import prepare
from zgiis.db.space_weather_db import SpaceWeatherDB, gnss_risk_to_score, snapshot_from_sw_dict


class SpaceWeatherDBTests(unittest.TestCase):
    def setUp(self) -> None:
        self.db = SpaceWeatherDB(dsn=prepare("space_weather_log"))

    def tearDown(self) -> None:
        self.db.close()

    def test_insert_and_query_snapshot(self) -> None:
        row = snapshot_from_sw_dict(
            {
                "kp": 2.0,
                "kp_condition": "Quiet",
                "dst": -15.0,
                "f107": 114.0,
                "solar_wind_speed": 406.0,
                "s4": 0.05,
                "gnss_risk": "Low",
                "stations_online": 12,
                "stations_total": 24,
                "updated_utc": "2026-06-16T19:36:10+00:00",
            },
            source="test",
        )
        self.db.insert_snapshot(row)
        self.assertEqual(self.db.record_count(), 1)
        df = self.db.query_dataframe(hours=24 * 365)
        self.assertEqual(len(df), 1)
        self.assertAlmostEqual(float(df.iloc[0]["kp"]), 2.0)

    def test_correlation_matrix_with_multiple_rows(self) -> None:
        base = {
            "kp_condition": "Quiet",
            "dst": -10.0,
            "f107": 100.0,
            "plasma_speed": 400.0,
            "s4": 0.1,
            "gnss_risk": "Low",
            "stations_online": 10,
            "stations_total": 20,
            "source": "test",
        }
        for i in range(12):
            row = snapshot_from_sw_dict(
                {
                    **base,
                    "kp": 1.0 + i * 0.2,
                    "dst": -10.0 - i * 2.0,
                    "f107": 100.0 + i,
                    "updated_utc": f"2026-06-16T{10 + i:02d}:00:00+00:00",
                }
            )
            self.db.insert_snapshot(row)

        result = self.db.correlation_matrix(hours=24 * 365, resample="1h", min_samples=3)
        self.assertGreaterEqual(result["sample_count"], 8)
        self.assertIn("kp", result["matrix"])
        self.assertGreater(len(result["pairs"]), 0)

    def test_gnss_risk_score_mapping(self) -> None:
        self.assertEqual(gnss_risk_to_score("High"), 2.0)
        self.assertIsNone(gnss_risk_to_score("Unavailable"))

    def test_timeline_keeps_latest_value_for_one_time(self) -> None:
        from datetime import datetime, timedelta, timezone

        when = datetime.now(tz=timezone.utc).replace(microsecond=0)
        metric = "test_graph_archive_xray"
        self.db.upsert_timeline(
            [
                (metric, when, 1.2e-6),
                (metric, when, 1.5e-6),
            ]
        )
        found = self.db.read_timeline_bins(
            [metric],
            since=when - timedelta(hours=1),
            before=when + timedelta(hours=1),
            bin_minutes=15,
        )
        values = [value for _stamp, value in found.get(metric, [])]
        self.assertIn(1.5e-6, values)
        self.assertNotIn(1.2e-6, values)


if __name__ == "__main__":
    unittest.main()
