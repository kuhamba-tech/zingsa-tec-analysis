"""
Fetch current-day GPS broadcast ephemeris (BRDC RINEX nav) and turn it into
the same nav-row format LiveNavCache expects from RTCM 1019.

Why this exists: the ZINGSA CORS casters relay MSM observation messages but
do not emit RTCM 1019 (GPS broadcast ephemeris) on any mountpoint (confirmed
by direct capture), so satellite elevation — required before any VTEC value
can be computed, see zgiis/live/satellite_geometry.py — never resolves from
the live NTRIP stream alone. This module sources the same ephemeris
independently from BKG's public combined BRDC mirror (anonymous HTTPS, no
Earthdata/CDDIS login required), refreshed periodically by
backend/live_manager.py.

Source: https://igs.bkg.bund.de/root_ftp/IGS/BRDC/<year>/<doy>/
        BRDC00WRD_R_<year><doy>0000_01D_MN.rnx.gz  (mixed-constellation,
        updated intraday; GPS records extracted via georinex).
"""
from __future__ import annotations

import gzip
import logging
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import requests

log = logging.getLogger(__name__)

_BKG_URL = (
    "https://igs.bkg.bund.de/root_ftp/IGS/BRDC/{year}/{doy:03d}/"
    "BRDC00WRD_R_{year}{doy:03d}0000_01D_MN.rnx.gz"
)

# Matches the nav-row keys LiveNavCache._gps entries already use (from RTCM
# 1019) and the keys tec_core._gps_sat_ecef reads — RINEX3 broadcast-orbit
# parameter names, which georinex exposes verbatim as dataframe columns.
_NAV_FIELDS = [
    "sqrtA", "Eccentricity", "M0", "DeltaN", "omega", "Omega0",
    "OmegaDot", "Io", "IDOT", "Cuc", "Cus", "Crc", "Crs", "Cic", "Cis", "Toe",
]


def _download_brdc(day: datetime, *, timeout: int = 60) -> Optional[Path]:
    year = day.year
    doy = day.timetuple().tm_yday
    url = _BKG_URL.format(year=year, doy=doy)
    try:
        resp = requests.get(url, timeout=timeout)
        resp.raise_for_status()
    except Exception as exc:
        log.info("Broadcast ephemeris fetch failed for %s: %s", url, exc)
        return None

    try:
        raw = gzip.decompress(resp.content)
    except OSError:
        raw = resp.content  # already uncompressed

    fd, tmp_name = tempfile.mkstemp(prefix=f"brdc_{year}{doy:03d}_", suffix=".rnx")
    tmp_path = Path(tmp_name)
    with open(fd, "wb") as f:
        f.write(raw)
    return tmp_path


def _load_gps_nav_df(path: Path):
    import georinex as gr

    try:
        nav_ds = gr.load(str(path), use="G")
        if isinstance(nav_ds, dict):
            import xarray as xr
            nav_ds = xr.merge(nav_ds.values())
        return nav_ds.to_dataframe().reset_index()
    except Exception as exc:
        log.warning("georinex failed to parse %s: %s", path, exc)
        return None


def _latest_per_sv(df, reference_time: datetime) -> dict[int, dict]:
    import pandas as pd

    if df is None or df.empty or "sv" not in df.columns or "time" not in df.columns:
        return {}

    ref_naive = reference_time.astimezone(timezone.utc).replace(tzinfo=None)
    ref = pd.Timestamp(ref_naive)
    # Broadcast ephemeris is valid for a couple of hours either side of Toe —
    # allow a little slack for clock skew / late transmission.
    cutoff = ref + pd.Timedelta(hours=2)

    out: dict[int, dict] = {}
    for sv, grp in df.groupby("sv"):
        sv = str(sv).strip()
        if not sv.upper().startswith("G"):
            continue
        try:
            sv_num = int(sv[1:])
        except ValueError:
            continue

        valid = grp[grp["time"] <= cutoff].dropna(subset=["sqrtA"])
        if valid.empty:
            continue
        row = valid.sort_values("time").iloc[-1]

        nav: dict[str, float] = {}
        ok = True
        for field in _NAV_FIELDS:
            v = row.get(field)
            if v is None or pd.isna(v):
                ok = False
                break
            nav[field] = float(v)
        if not ok or nav["sqrtA"] <= 0:
            continue
        out[sv_num] = nav
    return out


def fetch_gps_nav(reference_time: Optional[datetime] = None) -> dict[int, dict]:
    """
    Return {sv_number: nav_dict} — the most recent valid GPS broadcast
    ephemeris per satellite, as of reference_time (default: now), sourced
    from BKG's public combined BRDC mirror. Falls back to the previous UTC
    day's file if today's has no usable records yet (e.g. just after
    00:00 UTC). Returns {} if unreachable/unparsable — callers should treat
    that as "no update available", not an error.
    """
    reference_time = reference_time or datetime.now(tz=timezone.utc)
    for candidate_day in (reference_time, reference_time - timedelta(days=1)):
        path = _download_brdc(candidate_day)
        if path is None:
            continue
        try:
            df = _load_gps_nav_df(path)
        finally:
            try:
                path.unlink(missing_ok=True)
            except OSError:
                pass

        out = _latest_per_sv(df, reference_time)
        if out:
            return out
    return {}
