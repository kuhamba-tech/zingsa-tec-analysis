"""Dynamic-variable-name NetCDF reader for COSMIC-2 ionPrf profiles.

Real per-file schema confirmed by downloading and inspecting an actual UCAR
file (2024/092, ionPrf_C2E1.2024.092.00.02.R07_0001.0001_nc) during planning:
variables MSL_alt (km), GEO_lat/GEO_lon (degrees, per-altitude arrays),
ELEC_dens (units='el/cm3' — NOT el/m3), TEC_cal, OCC_azi; global attributes
carry the occultation time as separate year/month/day/hour/minute/second
fields, plus CDAAC's own precomputed edmax (~NmF2, el/cm3), edmaxalt
(~hmF2, km), edmaxlat/edmaxlon (the tangent-point location at the density
peak), and critfreq (~foF2, MHz). CDAAC product versions can differ, so
variable/attribute resolution tries a small candidate list before raising,
never guesses a single hard-coded name silently.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

VARIABLE_CANDIDATES: dict[str, tuple[str, ...]] = {
    "altitude_km": ("MSL_alt", "MSL_altitude", "Alt", "alt", "altitude"),
    "electron_density": ("ELEC_dens", "Elec_dens", "Ne", "edens"),
}
TIME_ATTR_CANDIDATES: dict[str, tuple[str, ...]] = {
    "year": ("year", "YEAR"),
    "month": ("month", "MONTH"),
    "day": ("day", "DAY"),
    "hour": ("hour", "HOUR"),
    "minute": ("minute", "MINUTE"),
    "second": ("second", "SECOND"),
}
LOCATION_ATTR_CANDIDATES: dict[str, tuple[str, ...]] = {
    "lat": ("edmaxlat", "botlat"),
    "lon": ("edmaxlon", "botlon"),
}
LOCATION_VAR_CANDIDATES: dict[str, tuple[str, ...]] = {
    "lat": ("GEO_lat", "GEO_LAT", "lat"),
    "lon": ("GEO_lon", "GEO_LON", "lon"),
}
REFERENCE_ATTR_CANDIDATES: dict[str, tuple[str, ...]] = {
    "nmf2": ("edmax",),
    "hmf2": ("edmaxalt",),
    "fof2": ("critfreq",),
}

_CM3_MARKERS = ("cm3", "cm-3", "cm^3", "cm^-3")


class NetcdfSchemaError(Exception):
    """Raised when a profile file's variable/attribute names don't match
    any known candidate — never silently guessed."""


@dataclass
class RawProfile:
    profile_id: str
    occ_time: datetime
    tangent_lat: float
    tangent_lon: float
    altitude_km: np.ndarray
    electron_density_m3: np.ndarray
    source_file: str
    reference_nmf2_el_m3: float | None
    reference_hmf2_km: float | None
    reference_fof2_mhz: float | None


def _resolve_variable(ds, candidates: tuple[str, ...], label: str) -> str:
    names = list(ds.variables.keys())
    for c in candidates:
        if c in names:
            return c
    lower_map = {n.lower(): n for n in names}
    for c in candidates:
        if c.lower() in lower_map:
            return lower_map[c.lower()]
    raise NetcdfSchemaError(f"No known variable for '{label}'; tried {candidates}; file has {names}")


def _resolve_attr(ds, candidates: tuple[str, ...], label: str, *, required: bool = True) -> float | None:
    attrs = ds.ncattrs()
    for c in candidates:
        if c in attrs:
            return float(getattr(ds, c))
    lower_map = {a.lower(): a for a in attrs}
    for c in candidates:
        if c.lower() in lower_map:
            return float(getattr(ds, lower_map[c.lower()]))
    if required:
        raise NetcdfSchemaError(f"No known global attribute for '{label}'; tried {candidates}; file has {attrs}")
    return None


def _detect_density_scale_to_m3(ds, var_name: str) -> float:
    units = getattr(ds.variables[var_name], "units", "") or ""
    units_lower = units.lower()
    if any(marker in units_lower for marker in _CM3_MARKERS):
        log.info("COSMIC-2 electron density units detected as %r (cm^-3) -> scaling by 1e6 to el/m^3", units)
        return 1e6
    log.info("COSMIC-2 electron density units detected as %r -> assuming el/m^3 (no scaling)", units)
    return 1.0


def _resolve_occ_time(ds) -> datetime:
    parts = {}
    for label, candidates in TIME_ATTR_CANDIDATES.items():
        value = _resolve_attr(ds, candidates, label, required=True)
        parts[label] = value
    second = parts["second"]
    whole_second = int(second)
    microsecond = int(round((second - whole_second) * 1_000_000))
    return datetime(
        int(parts["year"]), int(parts["month"]), int(parts["day"]),
        int(parts["hour"]), int(parts["minute"]), whole_second, microsecond,
        tzinfo=timezone.utc,
    )


def _resolve_location(ds) -> tuple[float, float]:
    lat = _resolve_attr(ds, LOCATION_ATTR_CANDIDATES["lat"], "tangent latitude", required=False)
    lon = _resolve_attr(ds, LOCATION_ATTR_CANDIDATES["lon"], "tangent longitude", required=False)
    if lat is not None and lon is not None:
        return lat, lon

    lat_var = _resolve_variable(ds, LOCATION_VAR_CANDIDATES["lat"], "latitude array")
    lon_var = _resolve_variable(ds, LOCATION_VAR_CANDIDATES["lon"], "longitude array")
    lat_arr = np.asarray(ds.variables[lat_var][:], dtype=float)
    lon_arr = np.asarray(ds.variables[lon_var][:], dtype=float)
    lat_arr = lat_arr[np.isfinite(lat_arr)]
    lon_arr = lon_arr[np.isfinite(lon_arr)]
    if lat_arr.size == 0 or lon_arr.size == 0:
        raise NetcdfSchemaError("Could not resolve profile tangent-point location from attrs or arrays")
    return float(np.mean(lat_arr)), float(np.mean(lon_arr))


def read_profile(path: Path) -> RawProfile:
    import netCDF4

    with netCDF4.Dataset(str(path)) as ds:
        alt_var = _resolve_variable(ds, VARIABLE_CANDIDATES["altitude_km"], "altitude")
        dens_var = _resolve_variable(ds, VARIABLE_CANDIDATES["electron_density"], "electron density")

        altitude_km = np.asarray(ds.variables[alt_var][:], dtype=float)
        density_raw = np.asarray(ds.variables[dens_var][:], dtype=float)
        scale = _detect_density_scale_to_m3(ds, dens_var)
        density_m3 = density_raw * scale

        occ_time = _resolve_occ_time(ds)
        lat, lon = _resolve_location(ds)

        ref_nmf2_raw = _resolve_attr(ds, REFERENCE_ATTR_CANDIDATES["nmf2"], "reference NmF2", required=False)
        ref_hmf2 = _resolve_attr(ds, REFERENCE_ATTR_CANDIDATES["hmf2"], "reference hmF2", required=False)
        ref_fof2 = _resolve_attr(ds, REFERENCE_ATTR_CANDIDATES["fof2"], "reference foF2", required=False)
        ref_nmf2_m3 = ref_nmf2_raw * scale if ref_nmf2_raw is not None else None

    return RawProfile(
        # Use the full real filename (not .stem) as the id: these filenames
        # contain multiple dots (satellite.date.time.transmitter) with no
        # true trailing ".ext" (the real suffix is "_nc"), so .stem would
        # split on an arbitrary internal dot rather than a real extension.
        profile_id=path.name,
        occ_time=occ_time,
        tangent_lat=lat,
        tangent_lon=lon,
        altitude_km=altitude_km,
        electron_density_m3=density_m3,
        source_file=path.name,
        reference_nmf2_el_m3=ref_nmf2_m3,
        reference_hmf2_km=ref_hmf2,
        reference_fof2_mhz=ref_fof2,
    )
