"""Tests for the COSMIC-2 dynamic NetCDF variable-name mapping.

Fixtures use the CONFIRMED real variable/attribute names verified by
downloading and inspecting an actual UCAR ionPrf file during planning
(2024/092): MSL_alt, ELEC_dens (units='el/cm3'), GEO_lat/GEO_lon,
year/month/day/hour/minute/second globals, edmax/edmaxalt/edmaxlat/edmaxlon/
critfreq globals.
"""
from __future__ import annotations

import math
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

import netCDF4
import numpy as np

from zgiis.cosmic2.netcdf_reader import NetcdfSchemaError, read_profile


def _write_profile_nc(
    path: Path, *, alt_var: str = "MSL_alt", dens_var: str = "ELEC_dens", dens_units: str = "el/cm3",
    altitude_km=None, density=None,
) -> None:
    altitude_km = altitude_km if altitude_km is not None else np.linspace(60, 700, 50)
    density = density if density is not None else np.linspace(1e4, 5e5, 50)
    ds = netCDF4.Dataset(str(path), "w", format="NETCDF4")
    try:
        ds.createDimension("MSL_alt", len(altitude_km))
        v_alt = ds.createVariable(alt_var, "f4", ("MSL_alt",))
        v_alt[:] = altitude_km
        v_alt.units = "km"
        v_dens = ds.createVariable(dens_var, "f4", ("MSL_alt",))
        v_dens[:] = density
        v_dens.units = dens_units
        v_lat = ds.createVariable("GEO_lat", "f4", ("MSL_alt",))
        v_lat[:] = np.full(len(altitude_km), -17.5)
        v_lon = ds.createVariable("GEO_lon", "f4", ("MSL_alt",))
        v_lon[:] = np.full(len(altitude_km), 30.0)
        ds.year, ds.month, ds.day = 2024, 4, 1
        ds.hour, ds.minute, ds.second = 0, 2, 30.0
        peak_idx = int(np.argmax(density))
        ds.edmax = float(np.max(density))
        ds.edmaxalt = float(altitude_km[peak_idx])
        ds.edmaxlat = -17.83
        ds.edmaxlon = 31.03
        density_scale = 1e6 if "cm3" in dens_units.lower() or "cm-3" in dens_units.lower() else 1.0
        ds.critfreq = 8.98 * math.sqrt((float(np.max(density)) * density_scale) / 1e12)
    finally:
        ds.close()


class NetcdfReaderTests(unittest.TestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()

    def tearDown(self):
        self._tmpdir.cleanup()

    def test_reads_confirmed_real_variable_names(self):
        path = Path(self._tmpdir.name) / "ionPrf_test_A_0001.0001_nc"
        _write_profile_nc(path)
        raw = read_profile(path)
        self.assertEqual(raw.profile_id, path.name)
        self.assertAlmostEqual(raw.tangent_lat, -17.83, places=2)
        self.assertAlmostEqual(raw.tangent_lon, 31.03, places=2)
        self.assertEqual(raw.occ_time, datetime(2024, 4, 1, 0, 2, 30, tzinfo=timezone.utc))
        self.assertEqual(len(raw.altitude_km), 50)

    def test_alternate_variable_names_resolve(self):
        path = Path(self._tmpdir.name) / "ionPrf_test_B_0001.0001_nc"
        _write_profile_nc(path, alt_var="alt", dens_var="Ne", dens_units="el/m3")
        raw = read_profile(path)
        self.assertEqual(len(raw.altitude_km), 50)

    def test_unrecognized_variable_names_raise_schema_error(self):
        path = Path(self._tmpdir.name) / "ionPrf_test_C_0001.0001_nc"
        ds = netCDF4.Dataset(str(path), "w", format="NETCDF4")
        try:
            ds.createDimension("x", 5)
            ds.createVariable("totally_unknown", "f4", ("x",))
        finally:
            ds.close()
        with self.assertRaises(NetcdfSchemaError):
            read_profile(path)

    def test_cm3_units_scaled_to_m3(self):
        path = Path(self._tmpdir.name) / "ionPrf_test_D_0001.0001_nc"
        density = np.linspace(1e4, 5e5, 50)  # el/cm3
        _write_profile_nc(path, density=density, dens_units="el/cm3")
        raw = read_profile(path)
        self.assertAlmostEqual(float(np.max(raw.electron_density_m3)), float(np.max(density)) * 1e6, delta=1.0)

    def test_reference_values_extracted(self):
        path = Path(self._tmpdir.name) / "ionPrf_test_E_0001.0001_nc"
        _write_profile_nc(path)
        raw = read_profile(path)
        self.assertIsNotNone(raw.reference_nmf2_el_m3)
        self.assertIsNotNone(raw.reference_hmf2_km)
        self.assertIsNotNone(raw.reference_fof2_mhz)


if __name__ == "__main__":
    unittest.main()
