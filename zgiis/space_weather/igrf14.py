"""IGRF-14 inclination and dip latitude.

Dip latitude uses tan(mu) = (1/2) tan(I). Oryema et al. (2015), Advances in
Space Research, place the African equatorial ionization anomaly trough on the
magnetic equator and the crests about 15 degrees to either side.
"""
from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path

COEFF_PATH = Path(__file__).resolve().parents[2] / "static" / "data" / "igrf14coeffs.txt"
REF_KM = 6371.2
WGS_A = 6378.137
WGS_B = 6356.7523142
NMAX = 13
EIA_CREST_DIP_DEG = 15.0


@lru_cache(maxsize=1)
def _table() -> tuple[list[float], dict[tuple[str, int, int], tuple[list[float], float]]]:
    epochs: list[float] = []
    rows: dict[tuple[str, int, int], tuple[list[float], float]] = {}
    for raw in COEFF_PATH.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if parts[0] in {"g/h", "c/s"} or not parts[1].lstrip("-").isdigit():
            if parts[0] == "g/h":
                epochs = [float(part) for part in parts[3:-1]]
            continue
        kind, degree, order = parts[0], int(parts[1]), int(parts[2])
        values = [float(part) for part in parts[3:-1]]
        rows[(kind, degree, order)] = (values, float(parts[-1]))
    if not epochs or not rows:
        raise RuntimeError(f"IGRF-14 coefficients missing in {COEFF_PATH}")
    return epochs, rows


def coefficient(kind: str, degree: int, order: int, epoch: float) -> float:
    """Main-field coefficient in nT. Secular variation applies after 2025.0."""
    epochs, rows = _table()
    if epoch < epochs[0] or epoch > epochs[-1] + 5.0:
        raise ValueError(f"epoch {epoch} is outside IGRF-14")
    values, secular = rows[(kind, degree, order)]
    if epoch <= epochs[-1]:
        for index in range(len(epochs) - 1):
            left, right = epochs[index], epochs[index + 1]
            if left <= epoch <= right:
                weight = 0.0 if right == left else (epoch - left) / (right - left)
                return values[index] * (1.0 - weight) + values[index + 1] * weight
        return values[-1]
    return values[-1] + secular * (epoch - epochs[-1])


def _geocentric(lat_deg: float, alt_km: float) -> tuple[float, float]:
    lat = math.radians(lat_deg)
    cos_lat = math.cos(lat)
    sin_lat = math.sin(lat)
    radius_curv = WGS_A * WGS_A / math.sqrt(
        WGS_A * WGS_A * cos_lat * cos_lat + WGS_B * WGS_B * sin_lat * sin_lat
    )
    rho = (radius_curv + alt_km) * cos_lat
    vertical = (radius_curv * (WGS_B / WGS_A) ** 2 + alt_km) * sin_lat
    return math.hypot(rho, vertical), math.atan2(vertical, rho)


def _factorial_ratio(degree: int, order: int) -> float:
    """sqrt( (n-m)! / (n+m)! )."""
    value = 1.0
    for step in range(degree - order + 1, degree + order + 1):
        value /= step
    return math.sqrt(value)


def _legendre(colatitude: float) -> tuple[list[list[float]], list[list[float]]]:
    """Unnormalized associated Legendre P and dP/dθ, no Condon-Shortley phase."""
    cosine = math.cos(colatitude)
    sine = math.sin(colatitude)
    if abs(sine) < 1e-12:
        sine = math.copysign(1e-12, sine if sine != 0 else 1.0)
    values = [[0.0] * (NMAX + 1) for _ in range(NMAX + 1)]
    deriv = [[0.0] * (NMAX + 1) for _ in range(NMAX + 1)]
    values[0][0] = 1.0
    for degree in range(1, NMAX + 1):
        values[degree][degree] = (2 * degree - 1) * sine * values[degree - 1][degree - 1]
        deriv[degree][degree] = (2 * degree - 1) * (
            sine * deriv[degree - 1][degree - 1] + cosine * values[degree - 1][degree - 1]
        )
        values[degree][degree - 1] = (2 * degree - 1) * cosine * values[degree - 1][degree - 1]
        deriv[degree][degree - 1] = (2 * degree - 1) * (
            cosine * deriv[degree - 1][degree - 1] - sine * values[degree - 1][degree - 1]
        )
        for order in range(0, degree - 1):
            previous = values[degree - 2][order] if degree >= 2 else 0.0
            previous_d = deriv[degree - 2][order] if degree >= 2 else 0.0
            scale = (degree - order)
            values[degree][order] = (
                (2 * degree - 1) * cosine * values[degree - 1][order] - (degree + order - 1) * previous
            ) / scale
            deriv[degree][order] = (
                (2 * degree - 1) * (cosine * deriv[degree - 1][order] - sine * values[degree - 1][order])
                - (degree + order - 1) * previous_d
            ) / scale
    return values, deriv


def _schmidt(values: list[list[float]], deriv: list[list[float]]) -> None:
    for degree in range(0, NMAX + 1):
        for order in range(0, degree + 1):
            factor = _factorial_ratio(degree, order)
            if order > 0:
                factor *= math.sqrt(2.0)
            values[degree][order] *= factor
            deriv[degree][order] *= factor


def field_geodetic(lat_deg: float, lon_deg: float, epoch: float, alt_km: float = 0.0) -> tuple[float, float, float]:
    """North, east and down components in nT."""
    radius, geocentric = _geocentric(lat_deg, alt_km)
    colatitude = math.pi / 2.0 - geocentric
    values, deriv = _legendre(colatitude)
    _schmidt(values, deriv)
    radial = 0.0
    theta = 0.0
    phi = 0.0
    longitude = math.radians(lon_deg)
    sine = math.sin(colatitude)
    for degree in range(1, NMAX + 1):
        ratio = (REF_KM / radius) ** (degree + 2)
        for order in range(0, degree + 1):
            g_nm = coefficient("g", degree, order, epoch)
            h_nm = 0.0 if order == 0 else coefficient("h", degree, order, epoch)
            cosine_m = math.cos(order * longitude)
            sine_m = math.sin(order * longitude)
            scalar = g_nm * cosine_m + h_nm * sine_m
            radial += (degree + 1) * ratio * scalar * values[degree][order]
            theta -= ratio * scalar * deriv[degree][order]
            if order > 0:
                phi += ratio * order * (g_nm * sine_m - h_nm * cosine_m) * values[degree][order] / sine
    delta = math.radians(lat_deg) - geocentric
    north = -theta * math.cos(delta) - radial * math.sin(delta)
    east = phi
    down = theta * math.sin(delta) - radial * math.cos(delta)
    return north, east, down


def inclination_deg(lat_deg: float, lon_deg: float, epoch: float, alt_km: float = 0.0) -> float:
    north, east, down = field_geodetic(lat_deg, lon_deg, epoch, alt_km)
    return math.degrees(math.atan2(down, math.hypot(north, east)))


def dip_latitude_deg(lat_deg: float, lon_deg: float, epoch: float, alt_km: float = 0.0) -> float:
    """Dip latitude in degrees. Zero on the magnetic dip equator."""
    inclination = math.radians(inclination_deg(lat_deg, lon_deg, epoch, alt_km))
    return math.degrees(math.atan(0.5 * math.tan(inclination)))


def _latitude_for_dip(lon_deg: float, target_deg: float, epoch: float) -> float:
    low, high = -60.0, 60.0
    for _ in range(18):
        mid = 0.5 * (low + high)
        if dip_latitude_deg(mid, lon_deg, epoch) < target_deg:
            low = mid
        else:
            high = mid
    return 0.5 * (low + high)


def anomaly_paths(epoch: float, lon_start: float = -180.0, lon_end: float = 180.0, step: float = 2.0) -> dict[str, list[tuple[float, float]]]:
    """Geographic polylines for the worldwide dip equator and the ±15° anomaly crests."""
    names = {
        "trough": 0.0,
        "northern_crest": EIA_CREST_DIP_DEG,
        "southern_crest": -EIA_CREST_DIP_DEG,
    }
    paths: dict[str, list[tuple[float, float]]] = {name: [] for name in names}
    lon = lon_start
    while lon <= lon_end + 1e-9:
        for name, target in names.items():
            paths[name].append((round(lon, 4), _latitude_for_dip(lon, target, epoch)))
        lon += step
    return paths


def eia_region(dip_lat: float) -> str:
    """Where a station sits in the African equatorial ionization anomaly."""
    distance = abs(dip_lat)
    hemisphere = "southern" if dip_lat < 0 else "northern"
    if distance <= 5.0:
        return "Magnetic-equator trough"
    if distance < 10.0:
        return f"Between trough and {hemisphere} crest"
    if distance <= 20.0:
        return f"{hemisphere.capitalize()} EIA crest"
    return f"Poleward of the {hemisphere} crest"
