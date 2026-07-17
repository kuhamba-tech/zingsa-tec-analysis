"""Tests for COSMIC-2 profile quality control."""
from __future__ import annotations

import unittest
from datetime import datetime, timezone

import numpy as np

from zgiis.cosmic2.models import Cosmic2Config
from zgiis.cosmic2.netcdf_reader import RawProfile
from zgiis.cosmic2.quality import evaluate_profile


def _raw(altitude_km, density_m3, *, lat=-17.8, lon=31.0, occ_time=None) -> RawProfile:
    return RawProfile(
        profile_id="test_nc",
        occ_time=occ_time if occ_time is not None else datetime(2024, 4, 1, tzinfo=timezone.utc),
        tangent_lat=lat, tangent_lon=lon,
        altitude_km=np.asarray(altitude_km, dtype=float), electron_density_m3=np.asarray(density_m3, dtype=float),
        source_file="test_nc", reference_nmf2_el_m3=None, reference_hmf2_km=None, reference_fof2_mhz=None,
    )


class QualityTests(unittest.TestCase):
    def test_clean_profile_is_ok(self):
        altitude = np.linspace(60, 700, 60)
        density = np.linspace(1e10, 5e11, 60)
        result = evaluate_profile(_raw(altitude, density))
        self.assertEqual(result.status, "ok")
        self.assertEqual(result.reasons, [])
        self.assertEqual(result.valid_sample_count, 60)

    def test_too_few_samples_rejected(self):
        altitude = np.linspace(60, 700, 5)
        density = np.linspace(1e10, 5e11, 5)
        result = evaluate_profile(_raw(altitude, density), config=Cosmic2Config(min_valid_samples=20))
        self.assertEqual(result.status, "rejected")
        self.assertIn("insufficient_samples", result.reasons)

    def test_insufficient_altitude_coverage_rejected(self):
        altitude = np.linspace(200, 300, 60)  # never reaches <=150 or >=500
        density = np.linspace(1e10, 5e11, 60)
        result = evaluate_profile(_raw(altitude, density))
        self.assertEqual(result.status, "rejected")
        self.assertIn("insufficient_altitude_coverage_bottom", result.reasons)
        self.assertIn("insufficient_altitude_coverage_top", result.reasons)

    def test_invalid_location_rejected(self):
        altitude = np.linspace(60, 700, 60)
        density = np.linspace(1e10, 5e11, 60)
        result = evaluate_profile(_raw(altitude, density, lat=999.0))
        self.assertEqual(result.status, "rejected")
        self.assertIn("invalid_location", result.reasons)

    def test_invalid_timestamp_rejected(self):
        altitude = np.linspace(60, 700, 60)
        density = np.linspace(1e10, 5e11, 60)
        raw = _raw(altitude, density)
        raw.occ_time = None
        result = evaluate_profile(raw)
        self.assertEqual(result.status, "rejected")
        self.assertIn("invalid_timestamp", result.reasons)

    def test_fill_value_and_negative_density_masked(self):
        altitude = np.linspace(60, 700, 60)
        density = np.linspace(1e10, 5e11, 60).copy()
        density[0:35] = -999.0
        result = evaluate_profile(_raw(altitude, density))
        self.assertEqual(result.status, "rejected")
        self.assertIn("excess_invalid_density", result.reasons)


if __name__ == "__main__":
    unittest.main()
