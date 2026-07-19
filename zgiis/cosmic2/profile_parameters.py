"""Profile-parameter calculations for quality-controlled COSMIC-2 profiles.

NmF2/hmF2 use the global maximum of the QC-cleaned profile — not an
artificial fixed search window. A properly QC'd bottomside+topside profile's
density maximum *is* the F2 peak by definition, and an arbitrary altitude
window risks misplacing the peak during exactly the disturbed ionospheric
conditions this platform cares about most.

Partial TEC integrates over the profile's own actual QC-cleaned altitude
range (not a fixed a-priori window) — honest about what was actually
observed; the returned integration_bottom_km/integration_top_km record
that this varies per profile.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

FOF2_COEFFICIENT_MHZ = 8.98  # foF2_MHz = 8.98 * sqrt(NmF2_el_m3 / 1e12)
TECU_PER_EL_PER_M2 = 1e16


@dataclass
class ProfileParameters:
    nmf2_el_m3: float | None
    hmf2_km: float | None
    fof2_mhz: float | None
    partial_tec_tecu: float | None
    integration_min_km: float | None
    integration_max_km: float | None


def compute_nmf2_hmf2(altitude_km: np.ndarray, density_m3: np.ndarray) -> tuple[float | None, float | None]:
    if altitude_km is None or density_m3 is None or len(density_m3) == 0:
        return None, None
    idx = int(np.argmax(density_m3))
    return float(density_m3[idx]), float(altitude_km[idx])


def compute_fof2(nmf2_el_m3: float | None) -> float | None:
    if nmf2_el_m3 is None or nmf2_el_m3 <= 0:
        return None
    return FOF2_COEFFICIENT_MHZ * math.sqrt(nmf2_el_m3 / 1e12)


def compute_partial_tec(
    altitude_km: np.ndarray, density_m3: np.ndarray
) -> tuple[float | None, float | None, float | None]:
    if altitude_km is None or density_m3 is None or len(altitude_km) < 2:
        return None, None, None
    altitude_m = np.asarray(altitude_km, dtype=float) * 1000.0
    density = np.asarray(density_m3, dtype=float)
    # np.trapz was removed in NumPy 2.0 (renamed np.trapezoid); this repo's
    # numpy floor is 1.26.0, so fall back for pre-2.0 environments.
    trapz = getattr(np, "trapezoid", None) or np.trapz
    partial_tec_el_m2 = float(trapz(density, altitude_m))
    partial_tec_tecu = partial_tec_el_m2 / TECU_PER_EL_PER_M2
    return partial_tec_tecu, float(np.min(altitude_km)), float(np.max(altitude_km))


def compute_profile_parameters(altitude_km: np.ndarray, density_m3: np.ndarray) -> ProfileParameters:
    nmf2, hmf2 = compute_nmf2_hmf2(altitude_km, density_m3)
    fof2 = compute_fof2(nmf2)
    partial_tec, bottom_km, top_km = compute_partial_tec(altitude_km, density_m3)
    return ProfileParameters(
        nmf2_el_m3=nmf2, hmf2_km=hmf2, fof2_mhz=fof2,
        partial_tec_tecu=partial_tec, integration_min_km=bottom_km, integration_max_km=top_km,
    )
