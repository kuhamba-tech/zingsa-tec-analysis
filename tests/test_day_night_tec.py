"""Measured day–night TEC: source separation, weights, and blank gaps."""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
import unittest

import pandas as pd

from zgiis.processing.day_night_tec import build_from_frame
from zgiis.processing.measured_tec import is_measured_gopi, measured_gopi_clause
from zgiis.processing.north_south_tec_research import zimbabwe_lat_band
from zgiis.processing.tec_climatology import read_bins

NOW = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)
GOPI = "gopi_eq_4_11_code_live"


def _at(year, month, day, hour, minute=0):
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


class DayNightTests(unittest.TestCase):
    def test_measured_identity_rejects_other_products(self):
        self.assertTrue(is_measured_gopi(GOPI, "NTRIP"))
        self.assertFalse(is_measured_gopi("dlr_fc_1h_global"))
        self.assertFalse(is_measured_gopi("gg_ciraolo_window_ls"))
        self.assertFalse(is_measured_gopi("gopi_eq_4_11_code_live_interpolated"))
        self.assertFalse(is_measured_gopi(GOPI, "interpolated-fill"))
        self.assertFalse(is_measured_gopi("gopi_eq_4_12_phase_only_live_unleveled"))
        clause, params = measured_gopi_clause("%s", elevation=True)
        self.assertNotIn("<= 50", clause)
        self.assertIn("vtec_tecu < 200", clause)
        self.assertIn("elevation_deg >= 30", clause)
        self.assertEqual(params, ["gopi_%code_live%", "dlr_%", "%interpol%", "%model%"])

    def test_climatology_query_cannot_select_modelled_rows(self):
        class _Db:
            _is_pg = True

            def _read_sql(self, sql, params):
                self.sql = sql
                self.params = params
                return pd.DataFrame()

        db = _Db()
        read_bins(db, _at(2026, 1, 1, 0), _at(2026, 1, 2, 0), 60)
        self.assertIn("gopi_%code_live%", db.params)
        self.assertIn("%interpol%", db.params)
        self.assertIn("%model%", db.params)
        self.assertNotIn("%code_live%", db.params)
        self.assertIn("NOT LIKE", db.sql)
        self.assertNotIn("<= 50", db.sql)

    def test_regions_stay_on_the_existing_boundaries(self):
        self.assertEqual(zimbabwe_lat_band(-18.19), "northern")
        self.assertEqual(zimbabwe_lat_band(-18.2), "central")
        self.assertEqual(zimbabwe_lat_band(-20.2), "southern")
        payload = build_from_frame(
            pd.DataFrame([{
                "time": _at(2026, 11, 9, 10),
                "station": "gokw",
                "vtec": 22,
                "elevation_deg": 40,
                "tec_method": GOPI,
            }]),
            now=NOW,
        )
        # Gokwe is 0.012° south of −18.2°, so it stays in Central.
        self.assertEqual(payload["profile_24h"]["central"][12], 22)
        self.assertIsNone(payload["profile_24h"]["northern"][12])

    def test_equal_station_weight_keeps_high_tec_and_leaves_gaps(self):
        rows = [
            {"time": _at(2026, 11, 9, 10, 0), "station": "zinh", "vtec": 10, "elevation_deg": 40, "tec_method": GOPI},
            {"time": _at(2026, 11, 9, 10, 20), "station": "zinh", "vtec": 90, "elevation_deg": 45, "tec_method": GOPI},
            {"time": _at(2026, 11, 9, 10, 5), "station": "karo", "vtec": 10, "elevation_deg": 50, "tec_method": GOPI},
            {"time": _at(2026, 11, 9, 12, 0), "station": "zinh", "vtec": 40, "elevation_deg": 40, "tec_method": GOPI},
            {"time": _at(2026, 11, 9, 10, 0), "station": "zinh", "vtec": 180, "elevation_deg": 40, "tec_method": "dlr_fc_1h_global"},
            {"time": _at(2026, 11, 9, 10, 0), "station": "karo", "vtec": 30, "elevation_deg": 40, "tec_method": "gg_ciraolo_window_ls"},
            {"time": _at(2026, 11, 9, 10, 0), "station": "zinh", "vtec": 70, "elevation_deg": 40, "tec_method": GOPI, "data_source": "interpolated"},
            {"time": _at(2026, 11, 9, 10, 0), "station": "zinh", "vtec": 200, "elevation_deg": 40, "tec_method": GOPI},
            {"time": _at(2026, 11, 9, 10, 0), "station": "zinh", "vtec": 0, "elevation_deg": 40, "tec_method": GOPI},
            {"time": _at(2026, 11, 9, 10, 0), "station": "karo", "vtec": 25, "elevation_deg": 12, "tec_method": GOPI},
        ]
        payload = build_from_frame(pd.DataFrame(rows), now=NOW)
        # ZINH hour mean is (10+90)/2 = 50. Karoi is 10. Equal station weight is 30, not the sample mean.
        self.assertEqual(payload["profile_24h"]["network"][12], 30)
        self.assertEqual(payload["profile_24h"]["northern"][12], 30)
        self.assertEqual(payload["profile_24h"]["network"][14], 40)
        self.assertIsNone(payload["profile_24h"]["network"][13])
        self.assertGreater(payload["coverage"]["observations_above_50"], 0)
        self.assertIn("zinh", payload["coverage"]["stations"])
        self.assertNotIn("dlr", " ".join(payload["coverage"]["stations"]))

    def test_yesterday_today_and_spanning_night_use_cat(self):
        rows = [
            # 18:00 CAT on 8 Nov is 16:00 UTC.
            {"time": _at(2026, 11, 8, 16), "station": "zinh", "vtec": 11, "elevation_deg": 40, "tec_method": GOPI},
            # 00:00 CAT on 9 Nov is 22:00 UTC on 8 Nov.
            {"time": _at(2026, 11, 8, 22), "station": "zinh", "vtec": 22, "elevation_deg": 40, "tec_method": GOPI},
            # Yesterday daytime 12:00 CAT = 10:00 UTC.
            {"time": _at(2026, 11, 8, 10), "station": "zinh", "vtec": 18, "elevation_deg": 40, "tec_method": GOPI},
            {"time": _at(2026, 11, 9, 10), "station": "chir", "vtec": 36, "elevation_deg": 40, "tec_method": GOPI},
        ]
        payload = build_from_frame(pd.DataFrame(rows), now=NOW)
        self.assertEqual(payload["today"], "2026-11-09")
        self.assertEqual(payload["yesterday"], "2026-11-08")
        self.assertEqual(payload["daytime"]["yesterday"]["network"][6], 18)
        self.assertEqual(payload["daytime"]["today"]["southern"][6], 36)
        self.assertIsNone(payload["daytime"]["today"]["northern"][6])
        last_night = payload["nighttime"]["last_night"]
        self.assertEqual(last_night["evening_date"], "2026-11-08")
        self.assertEqual(last_night["morning_date"], "2026-11-09")
        self.assertEqual(last_night["series"]["network"][0], 11)
        self.assertEqual(last_night["series"]["network"][6], 22)
        self.assertEqual(len(payload["seven_day"]), 7)
        self.assertEqual(payload["seven_day"][-1]["date"], "2026-11-09")
        self.assertEqual(payload["seven_day"][0]["date"], "2026-11-03")
        today_south = next(
            row for row in payload["regional_comparison"]
            if row["date"] == "2026-11-09" and row["region"] == "southern"
        )
        self.assertEqual(today_south["day_mean"], 36)
        self.assertEqual(today_south["day_hours"], 1)
