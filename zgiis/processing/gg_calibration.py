"""Ciraolo / Cesaroni Gg-style TEC calibration helpers.

Implements the Gg technique from TEC_GNSS_Notebook_v5 §3.2–3.4
(Ciraolo et al. 2007; Cesaroni et al. 2015/2021; PyTECGg /
Ventriglia et al. 2026) so live CORS samples can be compared with the
operational GOPI / Seemala path.

Calibration is the key difference from Method 1:
  - Joint least squares for a VTEC(μ, LT) polynomial (MODIP × Local Time)
  - Per-arc biases (phase ambiguity + IFB residuals)
  - 15-minute windows (notebook §3.2)

Full RINEX-day PyTECGg is preferred when observation + navigation files
are available; otherwise this module applies the same Gg math to existing
STEC/VTEC rows (live NTRIP comparison path).
"""

from __future__ import annotations

import logging
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Iterable

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

# Match GOPI / Seemala geometry (tec_core Re=6378 km, H_ipp=350 km, elev≥30°)
# so Method 1 vs Method 2 differences reflect calibration, not shell or mask.
EARTH_RADIUS_KM = 6378.0
DEFAULT_SHELL_KM = 350.0
ARC_GAP_S = 600.0
MIN_ARC_POINTS = 8
WINDOW_MINUTES = 15
MAX_POLY_DEGREE = 2
ELEV_MASK_DEG = 30.0
# Magnetic dip equator offset over Africa (~15°E) — notebook Fig 5.
AFRICA_MAG_EQ_OFFSET_DEG = 5.0

GG_REFERENCES = [
    {
        "cite": "Ciraolo et al. (2007)",
        "title": "Calibration errors on experimental slant total electron content (TEC) determined with GPS",
        "doi": "10.1007/s00190-006-0093-1",
        "journal": "Journal of Geodesy, 81(2), 111–120",
    },
    {
        "cite": "Cesaroni et al. (2015)",
        "title": "L-band scintillations and calibrated total electron content gradients over Brazil during the last solar maximum",
        "doi": "10.1051/swsc/2015038",
        "journal": "J. Space Weather Space Clim., 5, A36",
    },
    {
        "cite": "Cesaroni et al. (2021)",
        "title": "IONORING: Real-Time Monitoring of the Total Electron Content over Italy",
        "doi": "10.3390/rs13163290",
        "journal": "Remote Sensing, 13(16), 3290",
    },
    {
        "cite": "Ventriglia et al. (2026)",
        "title": "PyTECGg: Total Electron Content reconstruction with GNSS data",
        "doi": "10.2139/ssrn.5215848",
        "journal": "SoftwareX (in press); preprint SSRN April 2026",
    },
]


@dataclass
class MethodMeta:
    id: str
    label: str
    short: str
    calibration: str
    color: str


GOPI_META = MethodMeta(
    id="gopi",
    label="GOPI / Seemala GPS_TEC",
    short="GOPI",
    calibration=(
        "Dual-frequency code/phase TEC with Seemala-style DCB / σ-minimisation (Gopi Ch. 4). "
        "Live CORS: code TEC, thin-shell IPP at 350 km, elev ≥ 30°. Fast operational VTEC; "
        "absolute scale can retain residual bias without monthly DCB files."
    ),
    color="#38bdf8",
)

GG_META = MethodMeta(
    id="gg",
    label="Gg = Cesaroni",
    short="Gg",
    calibration=(
        "Gg = Cesaroni technique: geometry-free arcs; 15-min windows; "
        "joint least squares for VTEC(MODIP μ, LT) polynomial + arc biases / receiver DCB "
        "(Ciraolo 2007; Cesaroni 2015/2021; PyTECGg on full RINEX). "
        "Same geometry as GOPI: elev ≥ 30°, IPP shell 350 km, Re=6378 km — calibration differs."
    ),
    color="#f59e0b",
)


def thin_shell_mapping(elevation_deg: float, shell_km: float = DEFAULT_SHELL_KM) -> float:
    el = max(1.0, min(89.9, float(elevation_deg)))
    cos_e = math.cos(math.radians(el))
    ratio = (EARTH_RADIUS_KM / (EARTH_RADIUS_KM + shell_km)) * cos_e
    inside = 1.0 - ratio * ratio
    if inside <= 1e-12:
        return float("inf")
    return 1.0 / math.sqrt(inside)


def approximate_modip_deg(lat_deg: float, lon_deg: float | None = None) -> float:
    """MODIP latitude for Africa-sector live CORS (notebook Fig 5).

    Full IGRF dip is preferred when available; for streaming comparison we use
    the notebook's Africa magnetic-equator offset (~+5°N geographic) so the
    EIA is approximately symmetric in μ.
    """
    _ = lon_deg  # reserved for a lon-dependent IGRF lookup later
    return float(lat_deg) - AFRICA_MAG_EQ_OFFSET_DEG


def _to_utc(ts) -> datetime | None:
    if ts is None or (isinstance(ts, float) and not math.isfinite(ts)):
        return None
    if isinstance(ts, datetime):
        return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    try:
        parsed = pd.to_datetime(ts, utc=True)
        if pd.isna(parsed):
            return None
        return parsed.to_pydatetime()
    except Exception:
        return None


def _hour_ut(ts: datetime) -> float:
    return ts.hour + ts.minute / 60.0 + ts.second / 3600.0 + ts.microsecond / 3.6e9


def _assign_arcs(times: list[datetime], prns: list[str]) -> np.ndarray:
    """Number continuous arcs per PRN; gap > ARC_GAP_S starts a new arc."""
    n = len(times)
    arcs = np.full(n, -1, dtype=int)
    next_id = 0
    last_t: dict[str, datetime] = {}
    last_arc: dict[str, int] = {}
    for i, (t, prn) in enumerate(zip(times, prns)):
        key = str(prn or "").upper() or "?"
        prev = last_t.get(key)
        if prev is None or (t - prev).total_seconds() > ARC_GAP_S:
            last_arc[key] = next_id
            next_id += 1
        arcs[i] = last_arc[key]
        last_t[key] = t
    return arcs


def _poly_basis_lt_modip(hour: float, modip_deg: float, degree: int) -> list[float]:
    """VTEC(μ, LT) ≈ Σ c_mn LT^m μ^n  (notebook §3.2), truncated to low degree."""
    lt = (hour - 12.0) / 12.0
    mu = float(modip_deg) / 30.0  # scale so |μ|~1 near EIA crests
    terms = [1.0]
    if degree >= 1:
        terms.extend([lt, mu])
    if degree >= 2:
        terms.extend([lt * lt, lt * mu, mu * mu])
    return terms


def _solve_window(
    mapped: np.ndarray,
    hours: np.ndarray,
    modips: np.ndarray,
    arcs: np.ndarray,
    *,
    degree: int,
) -> tuple[np.ndarray, np.ndarray] | None:
    """Joint LS for poly coeffs + arc biases in one 15-min window."""
    unique_arcs = sorted(int(a) for a in np.unique(arcs))
    arc_index = {a: i for i, a in enumerate(unique_arcs)}
    n_arcs = len(unique_arcs)
    basis0 = _poly_basis_lt_modip(12.0, 0.0, degree)
    n_poly = len(basis0)
    n_bias = max(0, n_arcs - 1)
    cols = n_poly + n_bias
    if cols < 1 or len(mapped) < cols + 2:
        return None

    A = np.zeros((len(mapped), cols), dtype=float)
    for i in range(len(mapped)):
        basis = _poly_basis_lt_modip(float(hours[i]), float(modips[i]), degree)
        A[i, :n_poly] = basis
        ai = arc_index[int(arcs[i])]
        if ai < n_bias:
            A[i, n_poly + ai] = 1.0

    try:
        coef, *_ = np.linalg.lstsq(A, mapped, rcond=None)
    except np.linalg.LinAlgError:
        return None

    poly = coef[:n_poly]
    biases = np.zeros(n_arcs, dtype=float)
    if n_bias:
        biases[:n_bias] = coef[n_poly:]
        biases[-1] = -float(np.sum(biases[:n_bias]))
    # Map biases back to arc ids via unique_arcs order
    bias_by_arc = {unique_arcs[i]: float(biases[i]) for i in range(n_arcs)}
    return poly, bias_by_arc  # type: ignore[return-value]


def calibrate_gg_from_observations(
    rows: Iterable[dict[str, Any]],
    *,
    shell_km: float = DEFAULT_SHELL_KM,
    elev_mask: float = ELEV_MASK_DEG,
    poly_degree: int = MAX_POLY_DEGREE,
    window_minutes: float = WINDOW_MINUTES,
) -> list[dict[str, Any]]:
    """Apply Gg arc-bias + VTEC(MODIP, LT) calibration (notebook §3.2–3.3).

    Each input row should include time, prn, elevation_deg, and either
    stec_tecu or vtec_tecu. Optional lat/lon (station or IPP) enable MODIP;
    otherwise latitude defaults to Zimbabwe network centre (~−19°).
    """
    records: list[dict[str, Any]] = []
    times: list[datetime] = []
    prns: list[str] = []
    stecs: list[float] = []
    elevs: list[float] = []
    mapped: list[float] = []
    modips: list[float] = []

    for raw in rows:
        t = _to_utc(raw.get("time"))
        elev = raw.get("elevation_deg")
        if t is None or elev is None:
            continue
        try:
            elev_f = float(elev)
        except (TypeError, ValueError):
            continue
        if elev_f < elev_mask:
            continue
        stec = raw.get("stec_tecu")
        vtec = raw.get("vtec_tecu")
        try:
            if stec is not None and float(stec) == float(stec):
                stec_f = float(stec)
            elif vtec is not None and float(vtec) == float(vtec):
                m = thin_shell_mapping(elev_f, shell_km)
                stec_f = float(vtec) * m
            else:
                continue
        except (TypeError, ValueError):
            continue
        m = thin_shell_mapping(elev_f, shell_km)
        if not math.isfinite(m) or m <= 0:
            continue
        vtec_map = stec_f / m
        if not (0.0 < vtec_map < 250.0):
            continue

        lat = raw.get("ipp_lat")
        if lat is None:
            lat = raw.get("lat")
        lon = raw.get("ipp_lon")
        if lon is None:
            lon = raw.get("lon")
        try:
            lat_f = float(lat) if lat is not None else -19.0
            lon_f = float(lon) if lon is not None else 30.0
        except (TypeError, ValueError):
            lat_f, lon_f = -19.0, 30.0

        # Local Time ≈ UT + lon/15° (notebook uses LT, not UT, in the poly).
        lt_h = _hour_ut(t) + lon_f / 15.0
        lt_h = lt_h % 24.0

        times.append(t)
        prns.append(str(raw.get("prn") or raw.get("sv") or "?"))
        stecs.append(stec_f)
        elevs.append(elev_f)
        mapped.append(vtec_map)
        modips.append(approximate_modip_deg(lat_f, lon_f))
        records.append({**dict(raw), "_lt_hour": lt_h, "_lat": lat_f, "_lon": lon_f})

    n = len(records)
    if n < MIN_ARC_POINTS:
        return []

    arcs = _assign_arcs(times, prns)
    keep = np.ones(n, dtype=bool)
    for arc_id in np.unique(arcs):
        idx = np.where(arcs == arc_id)[0]
        if len(idx) < MIN_ARC_POINTS:
            keep[idx] = False
    if int(keep.sum()) < MIN_ARC_POINTS:
        return []

    times_k = [t for t, k in zip(times, keep) if k]
    mapped_k = np.asarray([v for v, k in zip(mapped, keep) if k], dtype=float)
    elevs_k = np.asarray([e for e, k in zip(elevs, keep) if k], dtype=float)
    arcs_k = arcs[keep]
    records_k = [r for r, k in zip(records, keep) if k]
    # Prefer Local Time stored per row; fall back to UT if missing.
    hours = np.asarray(
        [
            float(r.get("_lt_hour")) if r.get("_lt_hour") is not None else _hour_ut(t)
            for r, t in zip(records_k, times_k)
        ],
        dtype=float,
    )
    modips_k = np.asarray([m for m, k in zip(modips, keep) if k], dtype=float)
    mapping = np.asarray([thin_shell_mapping(e, shell_km) for e in elevs_k], dtype=float)
    degree = max(0, min(int(poly_degree), MAX_POLY_DEGREE))

    # 15-minute windows across the sample span (notebook §3.2: 96 windows/day).
    win_h = max(0.25, float(window_minutes) / 60.0)
    t0 = min(times_k)
    epoch_h = np.asarray(
        [(t - t0).total_seconds() / 3600.0 for t in times_k],
        dtype=float,
    )
    window_ids = np.floor(epoch_h / win_h).astype(int)

    out: list[dict[str, Any]] = []
    for wid in sorted(set(int(w) for w in window_ids)):
        idx = np.where(window_ids == wid)[0]
        if len(idx) < max(MIN_ARC_POINTS, 6):
            continue
        solved = _solve_window(
            mapped_k[idx],
            hours[idx],
            modips_k[idx],
            arcs_k[idx],
            degree=degree,
        )
        if solved is None:
            # Per-arc median residual fallback inside the window
            global_med = float(np.median(mapped_k[idx]))
            for j in idx:
                arc = int(arcs_k[j])
                arc_idx = idx[arcs_k[idx] == arc]
                bias = float(np.median(mapped_k[arc_idx]) - global_med)
                vtec_c = float(mapped_k[j] - bias)
                if not (0.0 < vtec_c < 250.0):
                    continue
                out.append(
                    {
                        **{
                            k: v
                            for k, v in records_k[j].items()
                            if not str(k).startswith("_")
                        },
                        "stec_tecu": round(vtec_c * float(mapping[j]), 4),
                        "vtec_tecu": round(vtec_c, 4),
                        "tec_method": "gg_ciraolo_arc_median",
                        "bias_method": "gg_arc_median_window",
                        "arc_bias_tecu": round(bias, 4),
                        "modip_deg": round(float(modips_k[j]), 2),
                    }
                )
            continue

        poly, bias_by_arc = solved
        for j in idx:
            arc = int(arcs_k[j])
            bias = float(bias_by_arc.get(arc, 0.0))
            basis = _poly_basis_lt_modip(float(hours[j]), float(modips_k[j]), degree)
            poly_v = float(sum(float(poly[p]) * basis[p] for p in range(len(basis))))
            # Calibrated VTEC = mapped VTEC − arc bias; blend toward poly surface
            vtec_c = float(mapped_k[j] - bias)
            vtec_c = 0.85 * vtec_c + 0.15 * poly_v
            if not (0.0 < vtec_c < 250.0):
                continue
            base = {
                k: v
                for k, v in records_k[j].items()
                if not str(k).startswith("_")
            }
            out.append(
                {
                    **base,
                    "stec_tecu": round(vtec_c * float(mapping[j]), 4),
                    "vtec_tecu": round(vtec_c, 4),
                    "tec_method": "gg_ciraolo_window_ls",
                    "bias_method": "gg_arc_bias_modip_lt_poly",
                    "arc_bias_tecu": round(bias, 4),
                    "gg_poly_vtec": round(poly_v, 4),
                    "modip_deg": round(float(modips_k[j]), 2),
                }
            )
    return out


def try_pytecgg_available() -> bool:
    try:
        import pytecgg  # noqa: F401
        return True
    except Exception:
        return False


def method_catalog() -> list[dict[str, str]]:
    return [
        {
            "id": GOPI_META.id,
            "label": GOPI_META.label,
            "short": GOPI_META.short,
            "calibration": GOPI_META.calibration,
            "color": GOPI_META.color,
        },
        {
            "id": GG_META.id,
            "label": GG_META.label,
            "short": GG_META.short,
            "calibration": GG_META.calibration,
            "color": GG_META.color,
            # Live comparison always runs notebook Gg math on streaming rows.
            # Full RINEX-day PyTECGg is a separate offline path when obs+nav exist.
            "engine": (
                "gg_modip_lt_window_ls"
                + ("; pytecgg_importable" if try_pytecgg_available() else "")
            ),
        },
    ]


def references() -> list[dict[str, str]]:
    return list(GG_REFERENCES)
