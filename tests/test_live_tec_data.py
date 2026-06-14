import unittest
from unittest.mock import patch

from zgiis.api.cors_client import fetch_live_tec_stations
from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS


class LiveTecDataTests(unittest.TestCase):
    def test_rejects_archive_and_model_values_when_no_live_telemetry_exists(self):
        health = {
            "health_summary": {"telemetry_live": 0},
            "analysis_date": "2026-06-14T10:32:35Z",
            "_api_base": "https://example.test/api",
        }

        with patch(
            "zgiis.api.cors_client.fetch_station_health",
            return_value=health,
        ):
            result = fetch_live_tec_stations()

        self.assertEqual(result["stations"], [])
        self.assertEqual(result["telemetry_live"], 0)

    def test_accepts_only_explicit_live_telemetry_rows(self):
        health = {"health_summary": {"telemetry_live": 2}}
        ionosphere = {
            "updated_utc": "2026-06-14T10:32:35Z",
            "stations": [
                {
                    "id": "HARA",
                    "name": "Harare",
                    "lat": -17.78,
                    "lon": 31.05,
                    "vtec": 23.5,
                    "data_source": "live-telemetry",
                },
                {
                    "id": "MUTA",
                    "name": "Mutare",
                    "lat": -18.98,
                    "lon": 32.68,
                    "vtec": 24.3,
                    "data_source": "rinex-archive",
                },
                {
                    "id": "BULA",
                    "name": "Bulawayo",
                    "lat": -20.17,
                    "lon": 28.64,
                    "vtec": 28.6,
                    "data_source": "climatology-model",
                },
            ],
        }

        with (
            patch(
                "zgiis.api.cors_client.fetch_station_health",
                return_value=health,
            ),
            patch(
                "zgiis.api.cors_client.fetch_ionosphere_status",
                return_value=ionosphere,
            ),
        ):
            result = fetch_live_tec_stations()

        self.assertEqual([row["code"] for row in result["stations"]], ["hara"])

    def test_station_registry_contains_no_embedded_tec_measurements(self):
        self.assertTrue(
            all(station.current_tec == 0.0 for station in ZIMBABWE_CORS_STATIONS)
        )


if __name__ == "__main__":
    unittest.main()
