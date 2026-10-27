"""Graph history is stored by metric and older days stay on the charts."""
from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from zgiis.space_weather.graph_archive import extend_monitor_payload, iter_monitor_rows


class GraphArchiveTests(unittest.TestCase):
    def test_monitor_rows_keep_each_series(self) -> None:
        payload = {
            "xray": {"times": ["2026-10-26T00:00:00Z"], "flux": [1.2e-6]},
            "imf": {"times": ["2026-10-26T00:01:00Z"], "bt": [5.0], "by": [1.0], "bz": [-2.0]},
            "solar_wind": {
                "times": ["2026-10-26T00:02:00Z"],
                "speed": [420.0],
                "density": [4.0],
                "temperature": [80000.0],
            },
            "dst": {"times": ["2026-10-26T00:00:00Z"], "dst": [-12.0]},
            "kp": {
                "times": ["2026-10-26T00:00:00Z"],
                "observed": [2.0],
                "estimated": [None],
                "predicted": [None],
            },
            "protons": {
                "times": ["2026-10-26T00:00:00Z"],
                "series": {">=10 MeV": [1.5]},
            },
        }
        metrics = {metric for metric, _time, _value in iter_monitor_rows(payload)}
        self.assertIn("xray_flux", metrics)
        self.assertIn("imf_bz", metrics)
        self.assertIn("solar_wind_speed", metrics)
        self.assertIn("proton_ge10mev", metrics)
        self.assertIn("kp_observed", metrics)

    def test_older_days_are_prepended_and_live_resolution_stays(self) -> None:
        live_time = datetime(2026, 10, 27, 12, 0, tzinfo=timezone.utc)
        older_time = live_time - timedelta(days=2)
        payload = {
            "xray": {
                "times": [live_time.isoformat().replace("+00:00", "Z")],
                "flux": [2.0e-6],
                "unit": "W/m²",
            },
            "imf": {},
            "solar_wind": {},
            "dst": {},
            "kp": {},
            "protons": {"times": [], "series": {}},
        }
        newer_time = live_time + timedelta(hours=6)
        stored = {
            "xray_flux": [(older_time, 1.0e-6), (newer_time, 3.0e-6)],
        }
        merged = extend_monitor_payload(payload, stored)
        self.assertEqual(merged["xray"]["flux"], [1.0e-6, 2.0e-6, 3.0e-6])
        self.assertLess(merged["xray"]["times"][0], merged["xray"]["times"][1])
        self.assertLess(merged["xray"]["times"][1], merged["xray"]["times"][2])
        self.assertEqual(merged["xray"]["unit"], "W/m²")


if __name__ == "__main__":
    unittest.main()
