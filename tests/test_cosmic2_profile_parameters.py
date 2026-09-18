"""Tests for COSMIC-2 profile-parameter calculations (NmF2, hmF2, foF2,
partial TEC) using synthetic profiles with known analytic answers.

The foF2 formula and units conversion were separately cross-validated
against a real downloaded UCAR file during planning (foF2 computed from the
file's own edmax matched CDAAC's own critfreq to 0.02%) — see the plan.
"""
from __future__ import annotations

import unittest

import numpy as np

from zgiis.cosmic2.profile_parameters import (
    compute_fof2,
    compute_nmf2_hmf2,
    compute_partial_tec,
    compute_profile_parameters,
)


class ProfileParametersTests(unittest.TestCase):
    def test_nmf2_hmf2_from_parabolic_profile(self):
        altitude = np.linspace(100, 700, 601)
        peak_alt, peak_density = 300.0, 1e12
        density = np.clip(peak_density * (1.0 - ((altitude - peak_alt) / 300.0) ** 2), 1e8, None)
        nmf2, hmf2 = compute_nmf2_hmf2(altitude, density)
        self.assertAlmostEqual(hmf2, peak_alt, delta=1.0)
        self.assertAlmostEqual(nmf2, peak_density, delta=peak_density * 0.001)

    def test_fof2_formula_exact(self):
        self.assertAlmostEqual(compute_fof2(1e12), 8.98, places=6)
        self.assertIsNone(compute_fof2(None))
        self.assertIsNone(compute_fof2(0))
        self.assertIsNone(compute_fof2(-5))

    def test_partial_tec_constant_density_slab_analytic(self):
        altitude = np.array([100.0, 600.0])  # km
        density = np.array([1e11, 1e11])  # el/m3, constant
        tec, bottom, top = compute_partial_tec(altitude, density)
        expected_tecu = (1e11 * 500_000.0) / 1e16  # density * thickness_m / TECU scale
        self.assertAlmostEqual(tec, expected_tecu, places=8)
        self.assertEqual(bottom, 100.0)
        self.assertEqual(top, 600.0)

    def test_partial_tec_needs_at_least_two_samples(self):
        tec, bottom, top = compute_partial_tec(np.array([100.0]), np.array([1e11]))
        self.assertIsNone(tec)
        self.assertIsNone(bottom)
        self.assertIsNone(top)

    def test_compute_profile_parameters_ties_together(self):
        altitude = np.linspace(100, 700, 601)
        density = np.clip(1e12 * (1.0 - ((altitude - 300.0) / 300.0) ** 2), 1e8, None)
        params = compute_profile_parameters(altitude, density)
        self.assertIsNotNone(params.nmf2_el_m3)
        self.assertIsNotNone(params.hmf2_km)
        self.assertIsNotNone(params.fof2_mhz)
        self.assertIsNotNone(params.partial_tec_tecu)
        self.assertAlmostEqual(params.fof2_mhz, 8.98 * (params.nmf2_el_m3 / 1e12) ** 0.5, places=6)


if __name__ == "__main__":
    unittest.main()
