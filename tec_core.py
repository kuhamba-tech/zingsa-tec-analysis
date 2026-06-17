from __future__ import annotations

import sys
import contextlib
import io

# Windows default encoding (cp1252) can't handle → and other Unicode chars
# that georinex emits in warning messages. Force UTF-8 on stdout/stderr.
for _stream in ("stdout", "stderr"):
    _s = getattr(sys, _stream, None)
    if _s is not None and hasattr(_s, "reconfigure"):
        try:
            _s.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

from dataclasses import dataclass
import logging
from pathlib import Path
from typing import Iterable, Optional

import numpy as np
import pandas as pd

from zgiis.space_weather.geomagnetic_scale import classify_kp

LOGGER = logging.getLogger(__name__)


def _ascii_diagnostic(value: object) -> str:
    """Return logging text that cannot fail on a legacy Windows code page."""
    return str(value).encode("ascii", errors="backslashreplace").decode("ascii")

# ── WGS-84 / GPS physical constants ───────────────────────────────────────────
_MU       = 3.986004418e14        # Earth gravitational parameter, m³/s²
_OMEGA_E  = 7.2921151467e-5       # Earth rotation rate, rad/s
_WGS84_A  = 6378137.0             # Semi-major axis, m
_WGS84_F  = 1.0 / 298.257223563
_WGS84_E2 = 2 * _WGS84_F - _WGS84_F**2
_C_LIGHT  = 2.99792458e8          # Speed of light, m/s

# GPS L1/L2 frequencies and TEC constant k = (f1²×f2²)/(40.3×(f1²−f2²))
_F1 = 1575.42e6
_F2 = 1227.60e6
_K  = (_F1**2 * _F2**2) / (40.3 * (_F1**2 - _F2**2))

# DCB conversion: 1 ns bias → TECU  (GPS_TEC readme confirms ≈ 2.854 TECU/ns)
_NS_TO_TECU = _C_LIGHT * 1e-9 * _K / 1e16


def _rinex_base_stem(path: Path) -> str:
    """Original RINEX stem (strip FastAPI upload prefixes like uuid_obs_)."""
    stem = path.stem
    for marker in ("_obs_", "_nav_"):
        if marker in stem:
            return stem.split(marker, 1)[1]
    return stem


def _is_nav_suffix(suffix: str) -> bool:
    s = suffix.lower()
    return s in {".n", ".nav", ".gnav", ".hnav"} or (len(s) == 4 and s.endswith("n"))


def _default_dcb_folder() -> Optional[Path]:
    import os

    env = os.getenv("TEC_DCB_FOLDER", "").strip()
    if env:
        p = Path(env)
        if p.is_dir():
            return p
    root = Path(__file__).resolve().parent
    for candidate in (
        root.parent / "GPS_Gopi_v3.5" / "DCB",
        root / "static" / "dcb",
        root.parent.parent / "GPS_Gopi_v3.5" / "DCB",
    ):
        if candidate.is_dir():
            return candidate
    return None


def _find_nav_file(
    obs_path: Path,
    provided: list[Path] | None = None,
) -> Optional[Path]:
    """Return companion GPS nav file for a RINEX obs file.

    Checks `provided` list first (user-selected files), then auto-discovers
    by stem name in the same folder as the obs file.
    """
    stem = obs_path.stem
    base = _rinex_base_stem(obs_path)
    ext = obs_path.suffix.lower()

    # 1. Match companion nav by original RINEX stem (handles upload_tmp prefixes)
    if provided:
        for p in provided:
            nav_path = Path(p)
            if not _is_nav_suffix(nav_path.suffix):
                continue
            if _rinex_base_stem(nav_path).lower() == base.lower():
                return nav_path
        nav_only = [Path(p) for p in provided if _is_nav_suffix(Path(p).suffix)]
        if len(nav_only) == 1:
            return nav_only[0]

    # 2. Auto-discover beside the obs file (original RINEX name, not upload prefix)
    folder = obs_path.parent
    candidates: list[Path] = []
    if len(ext) == 4 and ext.endswith("o"):
        yr = ext[1:3]
        candidates += [
            folder / f"{base}.{yr}n",
            folder / f"{base}.{yr}N",
            folder / f"{stem}.{yr}n",
            folder / f"{stem}.{yr}N",
        ]
    candidates += [
        folder / f"{base}.n",
        folder / f"{base}.N",
        folder / f"{base}.nav",
        folder / f"{base}.NAV",
        folder / f"{stem}.n",
        folder / f"{stem}.N",
    ]
    for c in candidates:
        if c.exists():
            return c

    # 3. Sibling upload_tmp nav files: * _nav _ * same base
    for p in folder.iterdir():
        if p.is_file() and _is_nav_suffix(p.suffix) and _rinex_base_stem(p).lower() == base.lower():
            return p
    return None


def _gps_sat_ecef(nav_row: dict, t_sow: float) -> Optional[np.ndarray]:
    """
    Broadcast-ephemeris GPS satellite ECEF position (IS-GPS-200).
    nav_row: dict of nav parameters for one SV/epoch.
    t_sow:   observation time in GPS seconds-of-week.
    Returns np.array([X, Y, Z]) metres, or None if parameters are missing.
    """
    try:
        sqrtA    = float(nav_row['sqrtA'])
        e        = float(nav_row['Eccentricity'])
        M0       = float(nav_row['M0'])
        dn       = float(nav_row['DeltaN'])
        omega    = float(nav_row['omega'])
        Omega0   = float(nav_row['Omega0'])
        OmegaDot = float(nav_row['OmegaDot'])
        i0       = float(nav_row['Io'])
        Idot     = float(nav_row['IDOT'])
        Cuc      = float(nav_row['Cuc']);  Cus = float(nav_row['Cus'])
        Crc      = float(nav_row['Crc']);  Crs = float(nav_row['Crs'])
        Cic      = float(nav_row['Cic']);  Cis = float(nav_row['Cis'])
        toe      = float(nav_row['Toe'])
    except (KeyError, TypeError, ValueError):
        return None

    a  = sqrtA**2
    n0 = np.sqrt(_MU / a**3)
    n  = n0 + dn

    tk = t_sow - toe
    if tk >  302400: tk -= 604800
    if tk < -302400: tk += 604800

    M = M0 + n * tk
    E = M
    for _ in range(12):           # Kepler's equation (Newton–Raphson)
        E = M + e * np.sin(E)

    nu  = np.arctan2(np.sqrt(1 - e**2) * np.sin(E), np.cos(E) - e)
    phi = omega + nu

    # Second-harmonic corrections
    du  = Cus * np.sin(2*phi) + Cuc * np.cos(2*phi)
    dr  = Crs * np.sin(2*phi) + Crc * np.cos(2*phi)
    di  = Cis * np.sin(2*phi) + Cic * np.cos(2*phi)
    u   = phi + du
    r   = a * (1 - e * np.cos(E)) + dr
    inc = i0 + Idot * tk + di

    xp = r * np.cos(u)
    yp = r * np.sin(u)

    Omega = Omega0 + (OmegaDot - _OMEGA_E) * tk - _OMEGA_E * toe
    X = xp * np.cos(Omega) - yp * np.cos(inc) * np.sin(Omega)
    Y = xp * np.sin(Omega) + yp * np.cos(inc) * np.cos(Omega)
    Z = yp * np.sin(inc)
    return np.array([X, Y, Z])


def _ecef_elevation(rx: np.ndarray, sat: np.ndarray) -> float:
    """Elevation angle in degrees from receiver (ECEF) to satellite (ECEF)."""
    d = sat - rx
    x, y, z = rx
    lon = np.arctan2(y, x)
    p   = np.sqrt(x**2 + y**2)
    lat = np.arctan2(z, p * (1 - _WGS84_E2))
    for _ in range(5):
        N   = _WGS84_A / np.sqrt(1 - _WGS84_E2 * np.sin(lat)**2)
        lat = np.arctan2(z + _WGS84_E2 * N * np.sin(lat), p)
    sl, cl = np.sin(lat), np.cos(lat)
    so, co = np.sin(lon), np.cos(lon)
    U = cl*co*d[0] + cl*so*d[1] + sl*d[2]
    E = -so*d[0]   + co*d[1]
    N = -sl*co*d[0] - sl*so*d[1] + cl*d[2]
    return float(np.degrees(np.arctan2(U, np.sqrt(E**2 + N**2))))


def _compute_elevations_from_nav(
    obs_df: pd.DataFrame,
    nav_path: Path,
    rx_ecef: np.ndarray,
) -> pd.Series:
    """
    Compute elevation angles for each (timestamp, sv) row in obs_df using
    broadcast ephemeris from nav_path and receiver position rx_ecef (ECEF, m).
    Returns a Series of elevation angles (degrees), NaN where not computable.
    """
    try:
        import georinex as gr
        nav_ds = gr.load(str(nav_path))
        # georinex may return a Dataset or dict[str, Dataset]
        if isinstance(nav_ds, dict):
            import xarray as xr
            nav_ds = xr.merge(nav_ds.values())
        nav_df = nav_ds.to_dataframe().reset_index()
    except Exception:
        return pd.Series(np.full(len(obs_df), np.nan), index=obs_df.index)

    # Normalise SV names: 'G01' or '1' → 'G01'
    if 'sv' in nav_df.columns:
        nav_df['sv'] = nav_df['sv'].astype(str).str.strip()
    if 'time' in nav_df.columns:
        nav_df['time'] = pd.to_datetime(nav_df['time'], errors='coerce')
        nav_df['toe_sow'] = (
            ((nav_df['time'].dt.dayofweek + 1) % 7) * 86400
            + nav_df['time'].dt.hour * 3600
            + nav_df['time'].dt.minute * 60
            + nav_df['time'].dt.second
        )

    nav_by_sv: dict[str, pd.DataFrame] = {}
    for sv, grp in nav_df.groupby('sv'):
        nav_by_sv[str(sv)] = grp.sort_values('time').reset_index(drop=True)

    def _normalise_sv(sv_raw: str) -> str:
        sv_raw = str(sv_raw).strip()
        if sv_raw.startswith('G') and len(sv_raw) == 3:
            return sv_raw
        try:
            return f"G{int(sv_raw):02d}"
        except ValueError:
            return sv_raw

    elevations = []
    for _, row in obs_df.iterrows():
        ts   = pd.Timestamp(row['timestamp'])
        sv   = _normalise_sv(row['prn'])
        t_sow = (
            ((ts.dayofweek + 1) % 7) * 86400
            + ts.hour * 3600 + ts.minute * 60 + ts.second
        )
        nav_sv = nav_by_sv.get(sv)
        if nav_sv is None:
            elevations.append(np.nan)
            continue
        # Nearest ephemeris epoch ≤ observation time
        valid = nav_sv[nav_sv['toe_sow'] <= t_sow + 7200]
        if valid.empty:
            valid = nav_sv
        nav_row = valid.iloc[-1].to_dict()
        sat_pos = _gps_sat_ecef(nav_row, t_sow)
        if sat_pos is None:
            elevations.append(np.nan)
        else:
            elevations.append(_ecef_elevation(rx_ecef, sat_pos))

    return pd.Series(elevations, index=obs_df.index)


CMN_COLUMNS = [
    "mjdate",
    "time_hours",
    "prn",
    "az",
    "elevation",
    "lat",
    "lon",
    "stec",
    "vtec",
    "s4",
]


@dataclass
class TecConfig:
    elevation_min_deg: float = 25.0
    ipp_height_km: float = 350.0
    dcb_folder: Optional[Path] = None   # folder containing P1C1/P1P2 .DCB files

    def __post_init__(self) -> None:
        if self.dcb_folder is None:
            self.dcb_folder = _default_dcb_folder()
        elif isinstance(self.dcb_folder, str):
            self.dcb_folder = Path(self.dcb_folder)


RINEX_EMPTY_HELP = (
    "No observations were processed. For .o / .24o files you must also provide the "
    "matching navigation file (.24n) so satellite elevations can be computed "
    "(Gopi Ch.4, Sec 4.2). Ensure dual-frequency C1/P1, P2, L1, and L2 are present "
    "and elevation exceeds the mask (default 25°)."
)


def _parse_station_and_date(path: Path) -> tuple[str, Optional[pd.Timestamp]]:
    name = path.stem
    station = "".join(ch for ch in name if ch.isalpha()) or "unknown"
    date_match = pd.Series([name]).str.extract(r"(\d{4}-\d{2}-\d{2})", expand=False).iloc[0]
    if isinstance(date_match, str):
        result = pd.to_datetime(date_match, errors="coerce")
        return station.lower(), None if pd.isna(result) else result
    return station.lower(), None


def read_cmn_file(path: Path, config: TecConfig) -> pd.DataFrame:
    station, parsed_date = _parse_station_and_date(path)
    df = pd.read_csv(
        path,
        sep=r"\s+",
        engine="python",
        skiprows=3,
        names=CMN_COLUMNS,
        comment="#",
    )
    # Some CMN files may contain stray text/header-like rows in the data section.
    # Coerce critical numeric fields explicitly before time conversion.
    for col in ["time_hours", "elevation", "vtec", "stec", "prn", "az", "lat", "lon", "s4"]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")

    df = df.dropna(subset=["time_hours", "elevation", "vtec"]).copy()
    df["station"] = station
    df["source_file"] = path.name
    df["date"] = parsed_date
    if parsed_date is not None:
        midnight = pd.Timestamp(parsed_date.date())
        df["timestamp"] = midnight + pd.to_timedelta(df["time_hours"], unit="h")
    else:
        df["timestamp"] = pd.NaT
    df = df[df["elevation"] >= config.elevation_min_deg].copy()
    return df


def read_cmn_folder(folder: Path, config: TecConfig) -> pd.DataFrame:
    cmn_files = sorted(folder.rglob("*.Cmn")) + sorted(folder.rglob("*.cmn"))
    frames = [read_cmn_file(path, config) for path in cmn_files]
    if not frames:
        return pd.DataFrame(columns=CMN_COLUMNS + ["station", "source_file", "date", "timestamp"])
    return pd.concat(frames, ignore_index=True)


def _parse_dcb_file(path: Path) -> dict[str, float]:
    """
    Parse a CODE DCB file (P1C1 or P1P2 format).
    Returns {PRN: value_ns}, e.g. {'G01': 0.62, 'G02': -1.79, ...}.
    """
    result: dict[str, float] = {}
    try:
        with open(path, encoding="ascii", errors="ignore") as fh:
            for line in fh:
                parts = line.split()
                if len(parts) >= 2 and parts[0][0] in ("G", "R", "E", "C", "J"):
                    try:
                        result[parts[0]] = float(parts[1])
                    except ValueError:
                        pass
    except OSError:
        pass
    return result


def _load_dcb_for_date(dcb_folder: Path, date: pd.Timestamp) -> tuple[dict[str, float], dict[str, float]]:
    """
    Load P1C1 and P1P2 DCB files for the month containing *date*.
    Returns (p1c1_dict, p1p2_dict); empty dicts if files not found.
    """
    yymm = f"{date.year % 100:02d}{date.month:02d}"
    p1c1 = _parse_dcb_file(dcb_folder / f"P1C1{yymm}.DCB")
    p1p2 = _parse_dcb_file(dcb_folder / f"P1P2{yymm}.DCB")
    return p1c1, p1p2


def _estimate_receiver_dcb(dfx: pd.DataFrame, config: "TecConfig") -> float:
    """
    Estimate receiver differential code bias by minimising total σ of VTEC
    across all visible satellites (Book Sec 4.2.5, Eq 4.21–4.22).
    Variable step-size search: 50→10→1→0.1 TECU (70 total evaluations).
    dfx must have columns: timestamp, elevation, stec (satellite-DCB corrected).
    Returns receiver bias in TECU (add to stec to obtain corrected stec).
    """
    # Elevation mask ≥ 30° (Section 4.2.5) + decimate to 3-minute epochs
    sub = dfx[dfx["elevation"] >= 30.0].copy()
    if sub.empty:
        return 0.0
    sub["epoch_3min"] = pd.to_datetime(sub["timestamp"]).dt.floor("3min")
    M_arr   = _mapping_function(sub["elevation"], config.ipp_height_km)
    stec_arr = sub["stec"].to_numpy(float)
    epochs   = sub["epoch_3min"].to_numpy()

    def sigma_total(b: float) -> float:
        vtec = (stec_arr + b) / M_arr
        # Mean σ across epochs (Eq 4.21–4.22)
        df_tmp = pd.DataFrame({"ep": epochs, "v": vtec})
        return float(df_tmp.groupby("ep")["v"].std(ddof=1).sum())

    # 4-stage variable step search (Section 4.2.5, Fig 4.5)
    stages = [(500.0, 50.0), (50.0, 10.0), (10.0, 1.0), (1.0, 0.1)]
    center = 0.0
    for half_range, step in stages:
        cands  = np.arange(center - half_range, center + half_range + step * 0.5, step)
        sigmas = [sigma_total(c) for c in cands]
        center = float(cands[int(np.argmin(sigmas))])
    return center


def _apply_relative_vtec_bias_removal(dfx: pd.DataFrame, config: "TecConfig") -> pd.DataFrame:
    """
    Fallback bias removal when external CODE DCB files are not available.

    This cannot recover the absolute hardware DCB as accurately as P1C1/P1P2
    files, but it prevents the "bias removed" panel from being a raw copy:
      1. convert raw STEC to VTEC,
      2. estimate each PRN's median offset from the all-PRN epoch profile,
      3. remove those PRN offsets,
      4. apply one receiver-like level shift so the quiet lower envelope sits
         slightly above zero TECU.
    """
    out = dfx.copy()
    if out.empty or "stec" not in out or "elevation" not in out:
        return out

    if "m" not in out:
        out["m"] = _mapping_function(out["elevation"], config.ipp_height_km)

    temp = out[["timestamp", "prn", "stec", "m"]].copy()
    temp["timestamp"] = pd.to_datetime(temp["timestamp"], errors="coerce")
    temp["vtec_raw_tmp"] = temp["stec"].astype(float) / temp["m"].astype(float)
    temp = temp.dropna(subset=["timestamp", "prn", "vtec_raw_tmp"])
    if temp.empty:
        return out

    temp["epoch"] = temp["timestamp"].dt.floor("5min")
    epoch_profile = temp.groupby("epoch")["vtec_raw_tmp"].median()
    temp["epoch_median"] = temp["epoch"].map(epoch_profile)
    temp["residual"] = temp["vtec_raw_tmp"] - temp["epoch_median"]

    prn_bias = temp.groupby("prn")["residual"].median().dropna()
    if prn_bias.empty:
        return out

    prn_col = out["prn"].astype(str)
    vtec_corr = out["stec"].astype(float) / out["m"].astype(float)
    vtec_corr = vtec_corr - prn_col.map(prn_bias).fillna(0.0).to_numpy()

    finite = vtec_corr[np.isfinite(vtec_corr)]
    if finite.size:
        low = float(np.nanpercentile(finite, 5))
        # GOP bias-removed plots normally keep the quiet-time floor just above
        # zero. This receiver-like shift is only used when no DCB file exists.
        target_floor = 3.0
        level_shift = target_floor - low
        if np.isfinite(level_shift) and abs(level_shift) <= 75.0:
            vtec_corr = vtec_corr + level_shift

    out["stec"] = vtec_corr * out["m"].astype(float)
    out["bias_method"] = "relative_prn_epoch_leveling"
    return out


def _mapping_function(elevation_deg: pd.Series, ipp_height_km: float) -> np.ndarray:
    # Book Eq 4.17: Re = 6378 km (explicitly stated p.76), H_ipp = 350-400 km
    # S(E) = 1/sqrt(1 - (Re*cos(E) / (Re+H_ipp))^2),  VTEC = STEC / S(E)
    re_km = 6378.0
    elev_rad = np.deg2rad(elevation_deg.clip(lower=0.1))
    arg = 1.0 - ((re_km * np.cos(elev_rad)) / (re_km + ipp_height_km)) ** 2
    arg = np.clip(arg, 1e-6, None)
    return 1.0 / np.sqrt(arg)


def _rnx_to_frame(dataset) -> tuple[pd.DataFrame, bool]:
    """
    Convert georinex obs Dataset to a flat DataFrame with pseudorange and phase columns.
    Returns (df, used_c1) where used_c1=True when L1 pseudorange is civilian C1 code
    (not Y-code P1), which requires the P1-C1 satellite DCB correction.
    """
    df = dataset.to_dataframe().reset_index()
    code_candidates = {
        "p1": ["C1C", "P1", "C1W", "C1X", "C1"],
        "p2": ["C2W", "P2", "C2X", "C2L", "C2"],
    }
    # Carrier phase observables for L1/L2 (Book Eq 4.12; values in cycles)
    phase_candidates = {
        "l1": ["L1C", "L1W", "L1"],
        "l2": ["L2W", "L2C", "L2X", "L2"],
    }
    selected_code: dict[str, str] = {}
    for key, names in code_candidates.items():
        for n in names:
            if n in df.columns:
                selected_code[key] = n
                break

    if "p1" not in selected_code or "p2" not in selected_code:
        raise ValueError("RINEX missing dual-frequency pseudorange fields (C1/P1 and C2/P2).")

    selected_phase: dict[str, str] = {}
    for key, names in phase_candidates.items():
        for n in names:
            if n in df.columns:
                selected_phase[key] = n
                break

    # Track whether we're using civilian C1 (needs P1-C1 DCB) or Y-code P1 (no correction)
    used_c1 = selected_code["p1"] != "P1"

    el_col = "el" if "el" in df.columns else ("elevation" if "elevation" in df.columns else None)
    out = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(df["time"]),
            "prn": df.get("sv", pd.Series(["unknown"] * len(df))),
            "elevation": df[el_col] if el_col else np.nan,
            "p1": df[selected_code["p1"]],
            "p2": df[selected_code["p2"]],
            "l1": df[selected_phase["l1"]] if "l1" in selected_phase else np.nan,
            "l2": df[selected_phase["l2"]] if "l2" in selected_phase else np.nan,
        }
    )
    return out.dropna(subset=["timestamp", "p1", "p2"]), used_c1


def _cycle_slip_correct(tecp: np.ndarray) -> np.ndarray:
    """
    Arithmetic cycle slip detection and correction.
    Book Chapter 4, Section 4.2.2, Eq 4.13:
      - Detect slip when |xi - x_{i-1}| > sigma (std of last 10 samples).
      - Correct by subtracting (current_diff - running_mean_of_5_prev_diffs) from
        the current sample and all subsequent samples.
    """
    result = tecp.copy().astype(float)
    n = len(result)
    for i in range(1, n):
        prev_10 = result[max(0, i - 10):i]
        sigma = float(np.std(prev_10)) if len(prev_10) > 1 else 1.0
        sigma = max(sigma, 0.1)  # guard against near-zero sigma on flat signal
        current_diff = result[i] - result[i - 1]
        if abs(current_diff) <= sigma:
            continue
        prev_diffs = np.diff(result[max(0, i - 5):i])
        running_mean_diff = float(prev_diffs.mean()) if len(prev_diffs) > 0 else 0.0
        slip = current_diff - running_mean_diff
        result[i:] -= slip
    return result


def _level_tec_all_prns(dfx: pd.DataFrame) -> pd.Series:
    """
    Book Chapter 4, Section 4.2.3 (TEC leveling), Eq 4.14-4.15.
    For each PRN, detect connected arcs (gap > 5 min = new arc), correct cycle slips
    in TECP (Eq 4.13), then compute the arc baseline = mean(TECG - TECP) using only
    epochs with elevation > 20° (outliers removed via 2-sigma rule, Eq 4.14).
    Returns TECR = TECP_corrected + baseline  (the leveled slant TEC).
    Falls back to TECG (code TEC) when phase data is all NaN.
    """
    result = pd.Series(np.nan, index=dfx.index, dtype=float)

    for _sv, grp in dfx.groupby("prn"):
        grp = grp.sort_values("timestamp")
        idx  = grp.index.to_numpy()
        n    = len(grp)
        tecp = grp["tecp"].to_numpy(dtype=float)
        tecg = grp["tecg"].to_numpy(dtype=float)
        elev = grp["elevation"].to_numpy(dtype=float)
        times_ns = pd.to_datetime(grp["timestamp"].values).astype(np.int64)

        # Arc boundaries: time gap > 5 minutes
        if n > 1:
            dt_sec = np.diff(times_ns) / 1e9
            breaks = (np.where(dt_sec > 300)[0] + 1).tolist()
        else:
            breaks = []
        arc_starts = [0] + breaks
        arc_ends   = breaks + [n]

        for a0, a1 in zip(arc_starts, arc_ends):
            arc_tecp = tecp[a0:a1]
            arc_tecg = tecg[a0:a1]
            arc_elev = elev[a0:a1]
            arc_idx  = idx[a0:a1]

            # Cycle slip correction on phase TEC (Section 4.2.2, Eq 4.13)
            valid = ~np.isnan(arc_tecp)
            tecp_corr = arc_tecp.copy()
            if valid.sum() > 1:
                tecp_corr[valid] = _cycle_slip_correct(arc_tecp[valid])

            # Use elevation > 20° for baseline computation (Fig 4.3 / Eq 4.15)
            lev_mask = arc_elev > 20.0
            if lev_mask.sum() < 3:
                lev_mask = ~np.isnan(arc_elev)  # fallback: use all non-NaN elevations

            offsets = (arc_tecg - tecp_corr)[lev_mask]
            offsets = offsets[~np.isnan(offsets)]

            if len(offsets) == 0:
                result[arc_idx] = arc_tecg  # no phase data: use code TEC
                continue

            # Outlier removal per Eq 4.14: exclude |xi - mu| >= 2*sigma
            if len(offsets) > 3:
                mu    = offsets.mean()
                sigma = offsets.std()
                if sigma > 0:
                    keep = offsets[np.abs(offsets - mu) <= 2 * sigma]
                    if len(keep) > 0:
                        offsets = keep

            baseline = offsets.mean()
            result[arc_idx] = tecp_corr + baseline  # Eq 4.15: TECR = TECP + baseline

    return result


def read_rinex_folder(folder: Path, config: TecConfig) -> pd.DataFrame:
    _OBS = ("*.o", "*.O", "*.??o", "*.??O", "*.obs", "*.OBS", "*.rnx", "*.RNX")
    seen: set[Path] = set()
    for pat in _OBS:
        seen.update(folder.rglob(pat))
    return _read_rinex_files_impl(sorted(seen), config)


def _read_rinex_files_impl(
    rinex_files: Iterable[Path | str],
    config: TecConfig,
    nav_files: list[Path | str] | None = None,
) -> pd.DataFrame:
    rinex_paths = [Path(p) for p in rinex_files]
    nav_paths = [Path(p) for p in nav_files] if nav_files else None
    try:
        import georinex as gr
    except Exception as exc:
        raise RuntimeError(
            "Reading RINEX requires georinex. Install dependencies from requirements-streamlit.txt."
        ) from exc

    frames: list[pd.DataFrame] = []
    # GPS L1/L2 dual-frequency TEC constant (GOP / Chapter-4 style)
    # Use module-level constants (avoids redundant local definitions per file)
    f1, f2, k = _F1, _F2, _K

    # Cache DCB files per (year, month) to avoid re-reading per file
    _dcb_cache: dict[tuple[int, int], tuple[dict, dict]] = {}

    for path in rinex_paths:
        try:
            _buf = io.StringIO()
            with contextlib.redirect_stderr(_buf), contextlib.redirect_stdout(_buf):
                ds = gr.load(str(path))
            if isinstance(ds, dict):
                import xarray as xr
                ds = xr.merge(ds.values())
        except Exception as exc:
            LOGGER.warning(
                "Could not load %s: %s",
                _ascii_diagnostic(path.name),
                _ascii_diagnostic(exc),
            )
            continue

        dfx, used_c1 = _rnx_to_frame(ds)
        if dfx.empty:
            continue

        # ── Elevation: compute from nav file if not already present ───────────
        need_elev = dfx["elevation"].isna().all()
        if need_elev:
            nav_path = _find_nav_file(path, provided=nav_paths)
            rx_ecef  = None
            try:
                # georinex stores APPROX POSITION XYZ as ds.position (direct
                # dataset attribute), NOT in ds.attrs — try both for robustness
                pos = getattr(ds, "position", None)
                if pos is None:
                    pos = ds.attrs.get("position") or ds.attrs.get("position_ecef")
                if pos is not None:
                    arr = np.asarray(pos, dtype=float).ravel()
                    if arr.size >= 3 and np.linalg.norm(arr) > 1e3:
                        rx_ecef = arr[:3]
            except Exception:
                pass

            if nav_path is not None and rx_ecef is not None:
                LOGGER.info(
                    "%s: receiver ECEF=%s, navigation=%s; computing elevations",
                    path.name,
                    rx_ecef,
                    nav_path.name,
                )
                dfx["elevation"] = _compute_elevations_from_nav(dfx, nav_path, rx_ecef)
                LOGGER.info(
                    "%s: elevation range %.1f to %.1f degrees",
                    path.name,
                    dfx["elevation"].min(),
                    dfx["elevation"].max(),
                )
            else:
                LOGGER.warning(
                    "%s: nav=%s, ecef=%s; elevation set to NaN; rows below "
                    "the mask will be dropped.",
                    _ascii_diagnostic(path.name),
                    nav_path is not None,
                    "found" if rx_ecef is not None else "missing",
                )
                # NaN → all rows dropped by elevation mask below
                dfx["elevation"] = np.nan

        # Apply elevation mask
        dfx = dfx.dropna(subset=["elevation"])
        dfx = dfx[dfx["elevation"] >= config.elevation_min_deg].copy()
        if dfx.empty:
            continue

        # ── Code TEC (TECG): Book Eq 4.11 ────────────────────────────────────
        # TECG = k × (P2 − P1)  [TECU]
        dfx["tecg"] = (dfx["p2"] - dfx["p1"]) * k / 1e16

        # ── Phase TEC (TECP): Book Eq 4.12 ───────────────────────────────────
        # TECP = k × (L1_m − L2_m),  L_m = L_cycles × c/f  [TECU]
        has_phase = not (dfx["l1"].isna().all() or dfx["l2"].isna().all())
        if has_phase:
            l1_m = dfx["l1"] * _C_LIGHT / f1
            l2_m = dfx["l2"] * _C_LIGHT / f2
            dfx["tecp"] = k * (l1_m - l2_m) / 1e16
        else:
            dfx["tecp"] = np.nan

        # ── TEC Leveling per arc: Book Eq 4.13–4.15 ─────────────────────────
        if has_phase and not dfx["tecp"].isna().all():
            dfx["stec"] = _level_tec_all_prns(dfx)
            dfx["stec"] = dfx["stec"].fillna(dfx["tecg"])
        else:
            dfx["stec"] = dfx["tecg"]

        # Save pre-DCB leveled STEC/VTEC for the biased TEC plot.  The right
        # GOP plot must use the same VTEC scale after bias correction, not STEC.
        dfx["stec_raw"] = dfx["stec"].copy()
        dfx["m"]        = _mapping_function(dfx["elevation"], config.ipp_height_km)
        dfx["vtec_raw"] = dfx["stec_raw"] / dfx["m"]

        # ── Satellite DCB correction: Book Sec 4.2.5, Eq 4.16 ───────────────
        # Load P1C1 and P1P2 DCB files from CODE (cached per month).
        # Satellite correction (vectorised):
        #   If C1 used: subtract P1-C1 DCB to convert to P1-equivalent STEC
        #   Add P1-P2 DCB to account for satellite inter-frequency hardware delay
        dcb_applied = False
        dfx["bias_method"] = "none"

        if config.dcb_folder is not None:
            first_ts = pd.to_datetime(dfx["timestamp"].iloc[0])
            cache_key = (first_ts.year, first_ts.month)
            if cache_key not in _dcb_cache:
                _dcb_cache[cache_key] = _load_dcb_for_date(config.dcb_folder, first_ts)
            p1c1, p1p2 = _dcb_cache[cache_key]

            prn_col = dfx["prn"].astype(str).str.strip()
            if used_c1 and p1c1:
                dfx["stec"] -= prn_col.map(p1c1).fillna(0.0) * _NS_TO_TECU
                dcb_applied = True
            if p1p2:
                dfx["stec"] += prn_col.map(p1p2).fillna(0.0) * _NS_TO_TECU
                dcb_applied = True

            # ── Receiver DCB estimation: Book Sec 4.2.5, Eq 4.21–4.22 ──────
            if dcb_applied:
                rcv_dcb = _estimate_receiver_dcb(dfx, config)
                dfx["stec"] += rcv_dcb
                dfx["bias_method"] = "code_dcb_receiver_estimate"

        if not dcb_applied:
            dfx = _apply_relative_vtec_bias_removal(dfx, config)

        # ── VTEC conversion: Book Eq 4.16–4.17 ───────────────────────────────
        # VTEC = STEC_corrected / S(E)   (S(E) = mapping function, Re=6378 km)
        dfx["vtec"] = dfx["stec"] / dfx["m"]

        dfx["station"]     = path.stem[:4].lower()
        dfx["source_file"] = path.name
        dfx["date"]        = dfx["timestamp"].dt.floor("D")

        frames.append(dfx[["timestamp", "date", "station", "source_file",
                            "prn", "elevation", "stec_raw", "vtec_raw",
                            "stec", "vtec", "bias_method"]])

    if not frames:
        return pd.DataFrame(
            columns=["timestamp", "date", "station", "source_file",
                     "prn", "elevation", "stec_raw", "vtec_raw", "stec",
                     "vtec", "bias_method"]
        )
    return pd.concat(frames, ignore_index=True)


def read_rinex_files(
    rinex_files: Iterable[Path | str],
    config: TecConfig,
    nav_files: Iterable[Path | str] | None = None,
) -> pd.DataFrame:
    return _read_rinex_files_impl(
        rinex_files,
        config,
        nav_files=list(nav_files) if nav_files else None,
    )


__all__ = [
    "TecConfig",
    "add_storm_intensity_index",
    "combine_sources",
    "mark_storm_days",
    "read_cmn_file",
    "read_cmn_folder",
    "read_kp_csv",
    "read_rinex_files",
    "read_rinex_folder",
    "RINEX_EMPTY_HELP",
    "summarize_daily",
    "summarize_daily_by_station",
    "summarize_monthly",
    "summarize_yearly",
]


def combine_sources(
    cmn_df: Optional[pd.DataFrame] = None,
    rinex_df: Optional[pd.DataFrame] = None,
) -> pd.DataFrame:
    frames = [x for x in [cmn_df, rinex_df] if x is not None and not x.empty]
    if not frames:
        return pd.DataFrame(
            columns=["timestamp", "date", "station", "source_file", "prn",
                     "elevation", "stec", "vtec_raw", "vtec", "bias_method"]
        )
    for frame in frames:
        if "stec" not in frame.columns:
            frame["stec"] = np.nan
    keep = ["timestamp", "date", "station", "source_file", "prn", "elevation",
            "stec_raw", "vtec_raw", "stec", "vtec", "bias_method"]
    keep = [c for c in keep if any(c in f.columns for f in frames)]
    return pd.concat([f[[c for c in keep if c in f.columns]] for f in frames], ignore_index=True)


def summarize_daily(df: pd.DataFrame) -> pd.DataFrame:
    """
    GOP/MATLAB-compatible daily metrics:
      1) For each day and time-of-day, compute mean VTEC across PRNs.
      2) Daily mean/max/min are computed over those per-time means.
      3) daytime_mean_vtec is the mean restricted to the 06:00-18:00 UT window.
    """
    cols = ["date", "mean_vtec", "max_vtec", "min_vtec", "samples", "daytime_mean_vtec"]
    if df.empty:
        return pd.DataFrame(columns=cols)

    temp = df.copy()
    temp["timestamp"] = pd.to_datetime(temp["timestamp"], errors="coerce")
    temp["date"] = pd.to_datetime(temp["date"], errors="coerce").dt.floor("D")
    temp = temp.dropna(subset=["timestamp", "date", "vtec"])
    if temp.empty:
        return pd.DataFrame(columns=cols)

    # Per (date, timestamp) mean across PRNs.
    time_means = (
        temp.groupby(["date", "timestamp"], as_index=False)
        .agg(mean_vtec_time=("vtec", "mean"))
        .sort_values(["date", "timestamp"])
    )
    ut_hour = (
        time_means["timestamp"].dt.hour
        + time_means["timestamp"].dt.minute / 60.0
        + time_means["timestamp"].dt.second / 3600.0
    )
    time_means["is_daytime"] = ut_hour.between(6.0, 18.0, inclusive="both")

    out = (
        time_means.groupby("date", as_index=False)
        .agg(
            mean_vtec=("mean_vtec_time", "mean"),
            max_vtec=("mean_vtec_time", "max"),
            min_vtec=("mean_vtec_time", "min"),
            samples=("mean_vtec_time", "size"),
        )
        .sort_values("date")
    )
    daytime = (
        time_means[time_means["is_daytime"]]
        .groupby("date", as_index=False)
        .agg(daytime_mean_vtec=("mean_vtec_time", "mean"))
    )
    out = out.merge(daytime, on="date", how="left")
    out["daytime_mean_vtec"] = out["daytime_mean_vtec"].fillna(out["mean_vtec"])
    return out


def summarize_daily_by_station(df: pd.DataFrame) -> pd.DataFrame:
    """
    Station-aware daily metrics with daytime subset:
      - daytime window: 06:00 to 18:00 UT (inclusive)
      - daily stats computed over per-time-of-day mean across PRNs (MATLAB/GOP style)
    """
    if df.empty:
        return pd.DataFrame(
            columns=[
                "station",
                "date",
                "mean_vtec",
                "max_vtec",
                "min_vtec",
                "daytime_mean_vtec",
                "samples",
            ]
        )

    temp = df.copy()
    temp["timestamp"] = pd.to_datetime(temp["timestamp"], errors="coerce")
    temp["date"] = pd.to_datetime(temp["date"], errors="coerce").dt.floor("D")
    temp["station"] = temp["station"].astype(str).str.lower()
    temp = temp.dropna(subset=["timestamp", "date", "vtec", "station"])
    if temp.empty:
        return pd.DataFrame(
            columns=[
                "station",
                "date",
                "mean_vtec",
                "max_vtec",
                "min_vtec",
                "daytime_mean_vtec",
                "samples",
            ]
        )

    time_means = (
        temp.groupby(["station", "date", "timestamp"], as_index=False)
        .agg(mean_vtec_time=("vtec", "mean"))
        .sort_values(["station", "date", "timestamp"])
    )
    # Compute UT hour as float to define 06:00–18:00.
    ut_hour = (
        time_means["timestamp"].dt.hour
        + time_means["timestamp"].dt.minute / 60.0
        + time_means["timestamp"].dt.second / 3600.0
    )
    time_means["is_daytime"] = ut_hour.between(6.0, 18.0, inclusive="both")

    day_all = (
        time_means.groupby(["station", "date"], as_index=False)
        .agg(
            mean_vtec=("mean_vtec_time", "mean"),
            max_vtec=("mean_vtec_time", "max"),
            min_vtec=("mean_vtec_time", "min"),
            samples=("mean_vtec_time", "size"),
        )
        .sort_values(["station", "date"])
    )
    day_6_18 = (
        time_means[time_means["is_daytime"]]
        .groupby(["station", "date"], as_index=False)
        .agg(daytime_mean_vtec=("mean_vtec_time", "mean"))
    )
    out = day_all.merge(day_6_18, on=["station", "date"], how="left")
    out["daytime_mean_vtec"] = out["daytime_mean_vtec"].fillna(out["mean_vtec"])
    return out


def summarize_24h_profile(df: pd.DataFrame) -> pd.DataFrame:
    """
    Monthly/yearly 'GOP-like' 24h profile:
      - For each day + time-of-day: mean VTEC across PRNs
      - Then for each UT hour: mean/max/min across days.
    Returns columns: ut_hour, mean_vtec, max_vtec, min_vtec, days_used
    """
    if df.empty:
        return pd.DataFrame(columns=["ut_hour", "mean_vtec", "max_vtec", "min_vtec", "days_used"])

    temp = df.copy()
    temp["timestamp"] = pd.to_datetime(temp["timestamp"], errors="coerce")
    temp["date"] = pd.to_datetime(temp["date"], errors="coerce").dt.floor("D")
    temp = temp.dropna(subset=["timestamp", "date", "vtec"])
    if temp.empty:
        return pd.DataFrame(columns=["ut_hour", "mean_vtec", "max_vtec", "min_vtec", "days_used"])

    time_means = (
        temp.groupby(["date", "timestamp"], as_index=False)
        .agg(mean_vtec_time=("vtec", "mean"))
        .sort_values(["date", "timestamp"])
    )
    ut_hour = (
        time_means["timestamp"].dt.hour
        + time_means["timestamp"].dt.minute / 60.0
        + time_means["timestamp"].dt.second / 3600.0
    )
    time_means["ut_hour"] = ut_hour

    prof = (
        time_means.groupby("ut_hour", as_index=False)
        .agg(
            mean_vtec=("mean_vtec_time", "mean"),
            max_vtec=("mean_vtec_time", "max"),
            min_vtec=("mean_vtec_time", "min"),
            days_used=("date", "nunique"),
        )
        .sort_values("ut_hour")
    )
    return prof


def add_storm_intensity_index(daily_df: pd.DataFrame) -> pd.DataFrame:
    if daily_df.empty:
        return daily_df.assign(storm_intensity=0.0, storm_class="Quiet")
    out = daily_df.copy()
    p95 = max(out["max_vtec"].quantile(0.95), 1e-6)
    p90 = max(out["mean_vtec"].quantile(0.90), 1e-6)
    out["storm_intensity"] = 0.6 * (out["max_vtec"] / p95) + 0.4 * (out["mean_vtec"] / p90)
    out["storm_intensity"] = out["storm_intensity"].clip(lower=0).round(3)
    out["storm_class"] = pd.cut(
        out["storm_intensity"],
        bins=[-np.inf, 0.8, 1.0, 1.2, np.inf],
        labels=["Quiet", "Active", "Minor Storm", "Strong Storm"],
    ).astype(str)
    return out


def summarize_monthly(df_daily: pd.DataFrame) -> pd.DataFrame:
    cols = ["month", "mean_vtec", "max_vtec", "min_vtec", "days", "daytime_mean_vtec"]
    if df_daily.empty:
        return pd.DataFrame(columns=cols)
    temp = df_daily.copy()
    temp["month"] = pd.to_datetime(temp["date"]).dt.to_period("M").astype(str)
    agg = {
        "mean_vtec": ("mean_vtec", "mean"),
        "max_vtec": ("max_vtec", "max"),
        "min_vtec": ("min_vtec", "min"),
        "days": ("date", "nunique"),
    }
    if "daytime_mean_vtec" in temp.columns:
        agg["daytime_mean_vtec"] = ("daytime_mean_vtec", "mean")
    return (
        temp.groupby("month", as_index=False)
        .agg(**agg)
        .sort_values("month")
    )


def summarize_yearly(df_daily: pd.DataFrame) -> pd.DataFrame:
    cols = ["year", "mean_vtec", "max_vtec", "min_vtec", "days", "daytime_mean_vtec"]
    if df_daily.empty:
        return pd.DataFrame(columns=cols)
    temp = df_daily.copy()
    temp["year"] = pd.to_datetime(temp["date"]).dt.year
    agg = {
        "mean_vtec": ("mean_vtec", "mean"),
        "max_vtec": ("max_vtec", "max"),
        "min_vtec": ("min_vtec", "min"),
        "days": ("date", "nunique"),
    }
    if "daytime_mean_vtec" in temp.columns:
        agg["daytime_mean_vtec"] = ("daytime_mean_vtec", "mean")
    return (
        temp.groupby("year", as_index=False)
        .agg(**agg)
        .sort_values("year")
    )


def mark_storm_days(
    daily_df: pd.DataFrame,
    kp_df: Optional[pd.DataFrame] = None,
    vtec_percentile: float = 0.9,
    min_vtec_days: int = 10,
    quiet_baseline_days: int = 27,
    tec_response_z_threshold: float = 2.0,
) -> pd.DataFrame:
    if daily_df.empty:
        return daily_df.assign(
            storm_flag=False,
            tec_anomaly_flag=False,
            kp_storm_flag=False,
            kp_index=np.nan,
            kp_condition=None,
            kp_g_scale=None,
            kp_severity=None,
            kp_summary=None,
            vtec_threshold=np.nan,
            tec_baseline=np.nan,
            tec_deviation_tecu=np.nan,
            tec_deviation_pct=np.nan,
            tec_response_z=np.nan,
            tec_response="Insufficient quiet baseline",
        )

    out = daily_df.copy()
    out["date"] = pd.to_datetime(out["date"], errors="coerce").dt.floor("D")
    max_vtec = pd.to_numeric(out["max_vtec"], errors="coerce")
    valid_vtec = max_vtec.dropna()
    out["tec_anomaly_flag"] = False
    out["vtec_threshold"] = np.nan
    out["kp_index"] = np.nan
    out["kp_storm_flag"] = False
    out["kp_condition"] = None
    out["kp_g_scale"] = None
    out["kp_severity"] = None
    out["kp_summary"] = None
    out["tec_baseline"] = np.nan
    out["tec_deviation_tecu"] = np.nan
    out["tec_deviation_pct"] = np.nan
    out["tec_response_z"] = np.nan
    out["tec_response"] = "Insufficient quiet baseline"

    if len(valid_vtec) >= min_vtec_days:
        threshold = float(valid_vtec.quantile(vtec_percentile))
        out["vtec_threshold"] = threshold
        out["tec_anomaly_flag"] = max_vtec >= threshold

    if kp_df is not None and not kp_df.empty:
        kp = kp_df.copy()
        kp["date"] = pd.to_datetime(kp["date"]).dt.floor("D")
        kp["kp_index"] = pd.to_numeric(kp["kp_index"], errors="coerce")
        kp = kp.dropna(subset=["date", "kp_index"])
        kp = kp.groupby("date", as_index=False)["kp_index"].max()
        out = out.merge(kp[["date", "kp_index"]], on="date", how="left", suffixes=("", "_src"))
        out["kp_index"] = out["kp_index_src"].combine_first(out["kp_index"])
        out = out.drop(columns=["kp_index_src"])
        conditions = [
            classify_kp(v) if pd.notna(v) else None
            for v in out["kp_index"]
        ]
        out["kp_condition"] = [c.condition if c else None for c in conditions]
        out["kp_g_scale"] = [c.g_scale if c else None for c in conditions]
        out["kp_severity"] = [c.severity if c else None for c in conditions]
        out["kp_summary"] = [c.summary if c else None for c in conditions]
        out["kp_storm_flag"] = [c.is_storm if c else False for c in conditions]

    # NOAA defines geomagnetic storms by Kp/G-scale, not by an absolute TECU
    # threshold. TEC is therefore a response diagnostic and cannot set storm_flag.
    out["storm_flag"] = out["kp_storm_flag"]

    mean_vtec = pd.to_numeric(out["mean_vtec"], errors="coerce")
    mean_vtec_values = mean_vtec.to_numpy(dtype=np.float64, na_value=np.nan)
    for row_position, (row_index, row) in enumerate(out.iterrows()):
        current_mean_vtec = float(mean_vtec_values[row_position])
        if pd.isna(row["date"]) or np.isnan(current_mean_vtec):
            continue

        window_start = row["date"] - pd.Timedelta(days=quiet_baseline_days)
        quiet_mask = (
            (out["date"] < row["date"])
            & (out["date"] >= window_start)
            & out["kp_index"].notna()
            & (out["kp_index"] < 4.0)
            & mean_vtec.notna()
        )
        quiet_values = mean_vtec.loc[quiet_mask]
        if len(quiet_values) < min_vtec_days:
            continue

        baseline = float(quiet_values.median())
        deviation = current_mean_vtec - baseline
        deviation_pct = (100.0 * deviation / baseline) if baseline != 0 else np.nan
        mad = float((quiet_values - baseline).abs().median())
        if mad > 0:
            response_z = 0.6745 * deviation / mad
        else:
            standard_deviation = float(quiet_values.std(ddof=1))
            response_z = (
                deviation / standard_deviation
                if standard_deviation > 0
                else 0.0
            )

        out.at[row_index, "tec_baseline"] = baseline
        out.at[row_index, "tec_deviation_tecu"] = deviation
        out.at[row_index, "tec_deviation_pct"] = deviation_pct
        out.at[row_index, "tec_response_z"] = response_z
        if response_z >= tec_response_z_threshold:
            out.at[row_index, "tec_response"] = "Positive ionospheric response"
        elif response_z <= -tec_response_z_threshold:
            out.at[row_index, "tec_response"] = "Negative ionospheric response"
        else:
            out.at[row_index, "tec_response"] = "Within quiet baseline"

    return out


def read_kp_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    date_col = None
    for c in df.columns:
        if c.lower() in {"date", "day", "timestamp"}:
            date_col = c
            break
    kp_col = None
    for c in df.columns:
        if c.lower() in {"kp", "kp_index", "kpindex"}:
            kp_col = c
            break
    if date_col is None or kp_col is None:
        raise ValueError("KP CSV must have date and KP columns (date, kp_index).")
    out = pd.DataFrame({"date": pd.to_datetime(df[date_col], errors="coerce"), "kp_index": df[kp_col]})
    return out.dropna(subset=["date", "kp_index"])

