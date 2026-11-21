"""NOAA Solar-1 archive backfills only genuine historical measurements."""
from __future__ import annotations

import unittest
from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch

from zgiis.space_weather.solar_magnetic_archive import fill_imf_history
from zgiis.space_weather.solar_plasma_archive import _aggregate_daily_bins, fill_plasma_history


class SolarArchiveBackfillTests(unittest.TestCase):
    def test_archived_pressure_uses_simultaneous_samples_before_binning(self) -> None:
        day = date(2026, 11, 17)
        epoch = datetime(1958, 1, 1, tzinfo=timezone.utc)
        stamps = [datetime(2026, 11, 17, 9, minute, tzinfo=timezone.utc) for minute in (15, 16, 17)]
        times = [(stamp - epoch).total_seconds() * 1_000_000 for stamp in stamps]
        bins = _aggregate_daily_bins(
            day,
            times,
            {
                "solar_wind_speed": [300.0, 17328.0, 310.0],
                "solar_wind_density": [2.0, -9999.0, 2.0],
                "solar_wind_temperature": [80000.0, 80000.0, 80000.0],
            },
        )

        self.assertAlmostEqual(bins["solar_wind_speed"][0][1], 305.0)
        self.assertAlmostEqual(bins["solar_wind_density"][0][1], 2.0)
        pressure = bins["solar_wind_pressure"][0][1]
        expected = 1.6726e-6 * 2.0 * (300.0**2 + 310.0**2) / 2
        self.assertAlmostEqual(pressure, expected)

    def test_plasma_backfill_preserves_existing_samples(self) -> None:
        start = datetime(2026, 11, 17, tzinfo=timezone.utc)
        stop = start + timedelta(minutes=30)
        existing_time = start
        archive_time = start + timedelta(minutes=15)
        stored = {"solar_wind_speed": [(existing_time, 420.0)]}
        day_bins = {
            "solar_wind_speed": [(existing_time, 400.0), (archive_time, 430.0)],
            "solar_wind_density": [(archive_time, 5.0)],
        }

        with patch("zgiis.space_weather.solar_plasma_archive._daily_bins", return_value=day_bins):
            fill_plasma_history(stored, start=start, stop=stop, now=stop)

        self.assertEqual(stored["solar_wind_speed"], [(existing_time, 420.0), (archive_time, 430.0)])
        self.assertEqual(stored["solar_wind_density"], [(archive_time, 5.0)])

    def test_magnetic_backfill_fills_missing_bins_without_replacing_live_values(self) -> None:
        start = datetime(2026, 11, 17, tzinfo=timezone.utc)
        stop = start + timedelta(minutes=30)
        existing_time = start
        archive_time = start + timedelta(minutes=15)
        stored = {"imf_bz": [(existing_time, -3.0)]}
        day_bins = {
            "imf_bt": [(existing_time, 5.0), (archive_time, 6.0)],
            "imf_by": [(existing_time, 1.0), (archive_time, 2.0)],
            "imf_bz": [(existing_time, -1.0), (archive_time, -4.0)],
        }

        with patch("zgiis.space_weather.solar_magnetic_archive._daily_bins", return_value=day_bins):
            fill_imf_history(stored, start=start, stop=stop, now=stop)

        self.assertEqual(stored["imf_bz"], [(existing_time, -3.0), (archive_time, -4.0)])
        self.assertEqual(stored["imf_bt"], day_bins["imf_bt"])
        self.assertEqual(stored["imf_by"], day_bins["imf_by"])

    def test_magnetic_backfill_skips_days_with_complete_coverage(self) -> None:
        start = datetime(2026, 11, 17, tzinfo=timezone.utc)
        stop = start + timedelta(days=1)
        stamps = [start + timedelta(minutes=15 * index) for index in range(96)]
        stored = {metric: [(stamp, 1.0) for stamp in stamps] for metric in ("imf_bt", "imf_by", "imf_bz")}

        with patch("zgiis.space_weather.solar_magnetic_archive._daily_bins") as load:
            fill_imf_history(stored, start=start, stop=stop, now=stop)

        load.assert_not_called()


if __name__ == "__main__":
    unittest.main()
