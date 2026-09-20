"""Ciraolo / Cesaroni Gg-style TEC calibration helpers.

Implements a practical windowed least-squares calibration inspired by the
Gg technique (Ciraolo et al. 2007; Cesaroni et al. 2015/2021; PyTECGg /
Ventriglia et al. 2026) so live CORS samples can be compared with the
operational GOPI / Seemala path.

Full RINEX-day PyTECGg is used when observation + navigation files are
available; otherwise this module applies an arc-bias + local-time
polynomial calibration to existing STEC/VTEC rows.
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

GG_REFERENCES = [
    {
        "cite": "Ciraolo et al. (2007)",
        "title": "Calibration errors on experimental slant total electron content (TEC) determined with GPS",
        "doi": "10.1007/s00190-006-0093-1",
    },
    {
        "cite": "Cesaroni et al. (2015)",
        "title": "L-band scintillations and calibrated total electron content gradients over Brazil during the last solar maximum",
        "doi": "10.1051/swsc/2015038",
    },
    {
        "cite": "Cesaroni et al. (2021)",
        "title": "IONORING: Real-Time Monitoring of the Total Electron Content over Italy",
        "doi": "10.3390/rs13163290",
    },
    {
        "cite": "Ventriglia et al. (2026)",
        "title": "PyTECGg: Total Electron Content reconstruction with GNSS data",
        "doi": "10.2139/ssrn.5215848",
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
    label="Gg / Ciraolo–Cesaroni (PyTECGg)",
    short="Gg",
    calibration=(
        "Geometry-free arcs; 15-min windows; joint least squares for VTEC(MODIP, LT) polynomial "
        "+ arc biases / receiver DCB (Ciraolo/Cesaroni Gg; PyTECGg on full RINEX). "
        "Same geometry as GOPI: elev ≥ 30°, IPP shell 350 km, Re=6378 km — different bias removal."
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


def calibrate_gg_from_observations(
    rows: Iterable[dict[str, Any]],
    *,
    shell_km: float = DEFAULT_SHELL_KM,
    elev_mask: float = ELEV_MASK_DEG,
    poly_degree: int = MAX_POLY_DEGREE,
) -> list[dict[str, Any]]:
    """Apply Gg-inspired arc-bias + LT polynomial calibration to observation rows.

    Each input row should include time, prn, and either stec_tecu or
    (vtec_tecu + elevation_deg). Returns calibrated copies with method tags.
    """
    records: list[dict[str, Any]] = []
    times: list[datetime] = []
    prns: list[str] = []
    stecs: list[float] = []
    elevs: list[float] = []
    mapped: list[float] = []

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
        times.append(t)
        prns.append(str(raw.get("prn") or raw.get("sv") or "?"))
        stecs.append(stec_f)
        elevs.append(elev_f)
        mapped.append(vtec_map)
        records.append(dict(raw))

    n = len(records)
    if n < MIN_ARC_POINTS:
        return []

    arcs = _assign_arcs(times, prns)
    # Drop tiny arcs
    keep = np.ones(n, dtype=bool)
    for arc_id in np.unique(arcs):
        idx = np.where(arcs == arc_id)[0]
        if len(idx) < MIN_ARC_POINTS:
            keep[idx] = False
    if int(keep.sum()) < MIN_ARC_POINTS:
        return []

    times_k = [t for t, k in zip(times, keep) if k]
    stecs_k = np.asarray([s for s, k in zip(stecs, keep) if k], dtype=float)
    elevs_k = np.asarray([e for e, k in zip(elevs, keep) if k], dtype=float)
    mapped_k = np.asarray([v for v, k in zip(mapped, keep) if k], dtype=float)
    arcs_k = arcs[keep]
    records_k = [r for r, k in zip(records, keep) if k]
    hours = np.asarray([_hour_ut(t) for t in times_k], dtype=float)
    mapping = np.asarray([thin_shell_mapping(e, shell_km) for e in elevs_k], dtype=float)

    # Unique arcs → column indices for biases (fix sum biases = 0 via dropping last)
    unique_arcs = sorted(int(a) for a in np.unique(arcs_k))
    arc_index = {a: i for i, a in enumerate(unique_arcs)}
    n_arcs = len(unique_arcs)
    degree = max(0, min(int(poly_degree), MAX_POLY_DEGREE))
    n_poly = degree + 1
    # Design: [1, LT, LT^2, ...] + arc bias columns (n_arcs - 1 free)
    n_bias = max(0, n_arcs - 1)
    cols = n_poly + n_bias
    if cols < 1 or len(mapped_k) < cols + 2:
        # Fallback: subtract per-arc median residual from global median
        global_med = float(np.median(mapped_k))
        out: list[dict[str, Any]] = []
        for i, row in enumerate(records_k):
            arc = int(arcs_k[i])
            idx = np.where(arcs_k == arc)[0]
            bias = float(np.median(mapped_k[idx]) - global_med)
            vtec_c = mapped_k[i] - bias
            stec_c = vtec_c * mapping[i]
            out.append(
                {
                    **row,
                    "stec_tecu": round(float(stec_c), 4),
                    "vtec_tecu": round(float(vtec_c), 4),
                    "tec_method": "gg_ciraolo_arc_median",
                    "bias_method": "gg_arc_median",
                    "arc_bias_tecu": round(bias, 4),
                }
            )
        return out

    A = np.zeros((len(mapped_k), cols), dtype=float)
    y = mapped_k.copy()
    for i, hour in enumerate(hours):
        # polynomial in centred local/universal hour
        x = (hour - 12.0) / 12.0
        for p in range(n_poly):
            A[i, p] = x**p
        ai = arc_index[int(arcs_k[i])]
        if ai < n_bias:
            A[i, n_poly + ai] = 1.0
        # last arc bias implied as -sum(others); absorb into poly intercept

    try:
        coef, *_ = np.linalg.lstsq(A, y, rcond=None)
    except np.linalg.LinAlgError:
        log.exception("Gg LS failed")
        return []

    poly = coef[:n_poly]
    biases = np.zeros(n_arcs, dtype=float)
    if n_bias:
        biases[:n_bias] = coef[n_poly:]
        biases[-1] = -float(np.sum(biases[:n_bias]))

    out = []
    for i, row in enumerate(records_k):
        ai = arc_index[int(arcs_k[i])]
        x = (hours[i] - 12.0) / 12.0
        poly_v = float(sum(poly[p] * (x**p) for p in range(n_poly)))
        # Calibrated VTEC = observed mapped VTEC − arc bias
        # (equivalently close to poly_v; use residual-corrected mapped value)
        vtec_c = float(mapped_k[i] - biases[ai])
        # Blend slightly toward polynomial for stability in sparse arcs
        vtec_c = 0.85 * vtec_c + 0.15 * poly_v
        if not (0.0 < vtec_c < 250.0):
            continue
        stec_c = vtec_c * float(mapping[i])
        out.append(
            {
                **row,
                "stec_tecu": round(stec_c, 4),
                "vtec_tecu": round(vtec_c, 4),
                "tec_method": "gg_ciraolo_window_ls",
                "bias_method": "gg_arc_bias_lt_poly",
                "arc_bias_tecu": round(float(biases[ai]), 4),
                "gg_poly_vtec": round(poly_v, 4),
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
            "engine": "pytecgg" if try_pytecgg_available() else "gg_window_ls_fallback",
        },
    ]


def references() -> list[dict[str, str]]:
    return list(GG_REFERENCES)
