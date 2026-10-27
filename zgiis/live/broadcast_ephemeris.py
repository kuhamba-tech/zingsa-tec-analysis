"""
Fetch current-day GPS broadcast ephemeris (BRDC RINEX nav) and turn it into
the same nav-row format LiveNavCache expects from RTCM 1019.

Why this exists: the ZINGSA CORS casters relay MSM observation messages but
do not emit RTCM 1019 (GPS broadcast ephemeris) on any mountpoint (confirmed
by direct capture), so satellite elevation — required before any VTEC value
can be computed, see zgiis/live/satellite_geometry.py — never resolves from
the live NTRIP stream alone. This module sources the same ephemeris
independently from public IGS / NGS mirrors, refreshed periodically by
backend/live_manager.py.

Primary:  BKG combined BRDC (RINEX 3 mixed) when reachable
Fallback: NOAA NGS daily GPS BRDC (RINEX 2) — used when BKG is down
"""
from __future__ import annotations

import gzip
import logging
import re
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

import requests

log = logging.getLogger(__name__)

# Tried in order for each candidate UTC day.
_BRDC_URL_TEMPLATES = (
    # BKG mixed-constellation RINEX 3 (preferred when the mirror is up).
    (
        "https://igs.bkg.bund.de/root_ftp/IGS/BRDC/{year}/{doy:03d}/"
        "BRDC00WRD_R_{year}{doy:03d}0000_01D_MN.rnx.gz"
    ),
    # NOAA NGS GPS-only RINEX 2 — public, no Earthdata login.
    "https://www.ngs.noaa.gov/corsdata/rinex/{year}/{doy:03d}/brdc{doy:03d}0.{yy}n.gz",
    "https://geodesy.noaa.gov/corsdata/rinex/{year}/{doy:03d}/brdc{doy:03d}0.{yy}n.gz",
)

# Matches the nav-row keys LiveNavCache._gps entries already use (from RTCM
# 1019) and the keys tec_core._gps_sat_ecef reads — RINEX3 broadcast-orbit
# parameter names, which georinex exposes verbatim as dataframe columns.
_NAV_FIELDS = [
    "sqrtA", "Eccentricity", "M0", "DeltaN", "omega", "Omega0",
    "OmegaDot", "Io", "IDOT", "Cuc", "Cus", "Crc", "Crs", "Cic", "Cis", "Toe",
]


def _brdc_urls_for_day(day: datetime) -> list[str]:
    year = day.year
    doy = day.timetuple().tm_yday
    yy = f"{year % 100:02d}"
    return [
        template.format(year=year, doy=doy, yy=yy)
        for template in _BRDC_URL_TEMPLATES
    ]


def _download_brdc(day: datetime, *, timeout: int = 60) -> Optional[Path]:
    year = day.year
    doy = day.timetuple().tm_yday
    last_exc: Exception | None = None
    for url in _brdc_urls_for_day(day):
        try:
            resp = requests.get(url, timeout=timeout)
            resp.raise_for_status()
            content_type = (resp.headers.get("content-type") or "").lower()
            # CDDIS and some mirrors return an HTML login page with HTTP 200.
            if "html" in content_type or resp.content[:1] == b"<":
                raise RuntimeError(f"HTML response instead of BRDC file from {url}")
            if len(resp.content) < 1000:
                raise RuntimeError(f"BRDC payload too small from {url}")
        except Exception as exc:
            last_exc = exc
            log.info("Broadcast ephemeris fetch failed for %s: %s", url, exc)
            continue

        try:
            raw = gzip.decompress(resp.content)
        except OSError:
            raw = resp.content  # already uncompressed

        if not raw.lstrip().startswith((b"     ", b"2.", b"3.", b"4.")):
            # RINEX nav headers start with version digits / spaces — reject junk.
            if b"RINEX" not in raw[:200]:
                log.info("Broadcast ephemeris payload is not RINEX nav from %s", url)
                continue

        fd, tmp_name = tempfile.mkstemp(prefix=f"brdc_{year}{doy:03d}_", suffix=".rnx")
        tmp_path = Path(tmp_name)
        with open(fd, "wb") as f:
            f.write(raw)
        log.info("Broadcast ephemeris downloaded from %s (%d bytes)", url, len(raw))
        return tmp_path

    if last_exc is not None:
        log.warning("All broadcast ephemeris mirrors failed for DOY %s: %s", doy, last_exc)
    return None


_FLOAT_RE = re.compile(
    r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[dDeE][-+]?\d+)?"
)
_RINEX3_GPS_EPOCH_RE = re.compile(
    r"^G(\d{2})\s+(\d{4})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})"
)
_RINEX2_GPS_EPOCH_RE = re.compile(
    r"^\s*(\d{1,2})\s+(\d{2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2})\s+(\d{1,2}(?:\.\d*)?)"
)


def _rinex_floats(line: str) -> list[float]:
    out: list[float] = []
    for token in _FLOAT_RE.findall(line):
        try:
            out.append(float(token.replace("D", "E").replace("d", "e")))
        except ValueError:
            continue
    return out


def _gps_nav_from_block(sv: str, epoch: datetime, clock: list[float], data: list[list[float]]) -> Optional[dict]:
    """Map one GPS broadcast block onto the nav columns LiveNavCache expects."""
    if len(data) < 5:
        return None
    # RINEX GPS nav: 4 values per data line, same order in RINEX 2 and 3.
    # 0 IODE Crs DeltaN M0 / 1 Cuc e Cus sqrtA / 2 Toe Cic Omega0 Cis
    # 3 i0 Crc omega OmegaDot / 4 IDOT ...
    slots = {
        "Crs": (0, 1),
        "DeltaN": (0, 2),
        "M0": (0, 3),
        "Cuc": (1, 0),
        "Eccentricity": (1, 1),
        "Cus": (1, 2),
        "sqrtA": (1, 3),
        "Toe": (2, 0),
        "Cic": (2, 1),
        "Omega0": (2, 2),
        "Cis": (2, 3),
        "Io": (3, 0),
        "Crc": (3, 1),
        "omega": (3, 2),
        "OmegaDot": (3, 3),
        "IDOT": (4, 0),
    }
    row: dict = {"sv": sv, "time": epoch.replace(tzinfo=None)}
    for name, (line_i, col_i) in slots.items():
        line = data[line_i]
        if col_i >= len(line):
            return None
        row[name] = line[col_i]
    if row["sqrtA"] <= 0:
        return None
    if clock:
        row["SVclockBias"] = clock[0]
    return row


def _parse_rinex_gps_nav(text: str) -> list[dict]:
    """Read GPS broadcast ephemeris from a RINEX 2, 3, or 4 navigation file."""
    lines = text.splitlines()
    version = 3
    body = 0
    for i, line in enumerate(lines):
        if "RINEX VERSION" in line:
            try:
                version = int(float(line[:9].strip() or "3"))
            except ValueError:
                version = 3
        if "END OF HEADER" in line:
            body = i + 1
            break

    rows: list[dict] = []
    i = body
    while i < len(lines):
        line = lines[i]
        if line.startswith(">"):
            i += 1
            continue
        sv = None
        epoch = None
        clock: list[float] = []
        match3 = _RINEX3_GPS_EPOCH_RE.match(line)
        match2 = _RINEX2_GPS_EPOCH_RE.match(line) if version < 3 else None
        if match3:
            sv = f"G{int(match3.group(1)):02d}"
            epoch = datetime(
                int(match3.group(2)),
                int(match3.group(3)),
                int(match3.group(4)),
                int(match3.group(5)),
                int(match3.group(6)),
                int(float(match3.group(7))),
                tzinfo=timezone.utc,
            )
            clock = _rinex_floats(line[match3.end():])
        elif match2:
            year = int(match2.group(2))
            year += 2000 if year < 80 else 1900
            sv = f"G{int(match2.group(1)):02d}"
            epoch = datetime(
                year,
                int(match2.group(3)),
                int(match2.group(4)),
                int(match2.group(5)),
                int(match2.group(6)),
                int(float(match2.group(7))),
                tzinfo=timezone.utc,
            )
            clock = _rinex_floats(line[match2.end():])
        else:
            i += 1
            continue

        i += 1
        data: list[list[float]] = []
        while i < len(lines) and len(data) < 7:
            nxt = lines[i]
            if nxt.startswith(">"):
                break
            if _RINEX3_GPS_EPOCH_RE.match(nxt) or (
                version < 3 and _RINEX2_GPS_EPOCH_RE.match(nxt)
            ):
                break
            if nxt[:1].isalpha() and not nxt.startswith(" "):
                break
            data.append(_rinex_floats(nxt))
            i += 1
        if sv and epoch is not None:
            row = _gps_nav_from_block(sv, epoch, clock, data)
            if row is not None:
                rows.append(row)
    return rows


def _load_gps_nav_df(path: Path):
    """Parse GPS nav without georinex. Vercel functions do not install that module."""
    import pandas as pd

    try:
        text = path.read_text(encoding="ascii", errors="replace")
        rows = _parse_rinex_gps_nav(text)
    except OSError as exc:
        log.warning("Could not read broadcast ephemeris %s: %s", path, exc)
        rows = []
    if rows:
        return pd.DataFrame(rows)

    try:
        import georinex as gr
    except ImportError as exc:
        log.warning("georinex is not installed and the built-in parser found no GPS nav: %s", exc)
        return None
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
    ephemeris per satellite, as of reference_time (default: now).

    Tries BKG then NOAA NGS mirrors, falling back to the previous UTC day's
    file if today's has no usable records yet. Returns {} if unreachable /
    unparsable — callers should treat that as "no update available".
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


def start_refresh_thread(nav_cache, *, interval_s: float = 3600.0) -> threading.Thread:
    """Start a daemon thread that keeps `nav_cache` populated with fresh GPS
    broadcast ephemeris — required by any long-running NTRIP ingest process
    (backend's in-process pipeline and the standalone collector script alike),
    since the CORS casters never emit RTCM 1019 themselves."""

    def _loop() -> None:
        while True:
            try:
                nav_by_sv = fetch_gps_nav()
                if not nav_by_sv:
                    raise RuntimeError("broadcast ephemeris source returned no usable GPS satellites")
                updated = nav_cache.bulk_update_gps(nav_by_sv)
                log.info("Broadcast ephemeris refresh: %d GPS satellite(s) updated.", updated)
            except Exception as exc:
                log.warning("Broadcast ephemeris refresh failed: %s", exc)
                # A transient mirror/network failure must not leave VTEC dark
                # until the next hourly refresh.
                time.sleep(min(60.0, interval_s))
                continue
            time.sleep(interval_s)

    thread = threading.Thread(target=_loop, daemon=True, name="ephemeris-refresh")
    thread.start()
    return thread
