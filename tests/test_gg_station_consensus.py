"""One repeated satellite must not set the station Gg label."""

import unittest

from backend.routers.live import _station_method_summary
from backend.schemas import LiveObservation


def _obs(station: str, prn: str, vtec: float, second: int) -> LiveObservation:
    return LiveObservation(
        time=f"2026-10-27T01:19:{second:02d}+00:00",
        station=station,
        prn=prn,
        vtec_tecu=vtec,
    )


class GgStationConsensusTest(unittest.TestCase):
    def test_repeated_high_prn_does_not_set_station_gg(self):
        """Victoria Falls 01:19 UTC: 59 copies of G31 near 65 TECU, peers near 6."""
        gopi = [_obs("VICF", "G31", 64.8, i % 60) for i in range(59)]
        gopi.append(_obs("VICF", "G08", 6.35, 10))
        gopi.append(_obs("VICF", "G27", 6.47, 20))
        # Calibration keeps only the long arc, so Gg is G31 alone.
        gg = [_obs("VICF", "G31", 64.8, i % 60) for i in range(59)]

        stations, _summary = _station_method_summary(gopi, gg)
        row = stations[0]
        self.assertIsNone(row.gopi_latest)
        self.assertIsNone(row.gg_latest)
        self.assertEqual(row.gopi_samples, 61)
        self.assertEqual(row.gg_samples, 59)

    def test_agreeing_satellites_keep_the_station_level(self):
        gopi = [_obs("GUTU", "G08", 5.6, i) for i in range(8)]
        gopi += [_obs("GUTU", "G27", 5.8, i) for i in range(8)]
        gg = [_obs("GUTU", "G08", 5.7, i) for i in range(8)]
        gg += [_obs("GUTU", "G27", 5.9, i) for i in range(8)]

        stations, _summary = _station_method_summary(gopi, gg)
        row = stations[0]
        self.assertIsNotNone(row.gopi_latest)
        self.assertIsNotNone(row.gg_latest)
        self.assertGreaterEqual(row.gopi_latest, 5.5)
        self.assertLessEqual(row.gopi_latest, 6.0)
        self.assertGreaterEqual(row.gg_latest, 5.5)
        self.assertLessEqual(row.gg_latest, 6.1)
        self.assertLess(abs(row.gg_latest - row.gopi_latest), 1.0)

    def test_one_quiet_satellite_is_still_published(self):
        rows = [_obs("KARO", "G10", 4.5, i) for i in range(8)]
        stations, _summary = _station_method_summary(rows, rows)
        row = stations[0]
        self.assertEqual(row.gopi_latest, 4.5)
        self.assertEqual(row.gg_latest, 4.5)


if __name__ == "__main__":
    unittest.main()
