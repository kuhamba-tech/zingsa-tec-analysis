"""RINEX download for post-processing (PPK / office processing).

Sources (real files only — never fabricated):
  1. RINEX_ARCHIVE_ROOT — local/network archive of daily observation files
  2. RINEX_DOWNLOAD_URL_TEMPLATE — optional HTTP(S) fetch template for SpiderWeb
     or FTP-gateway mirrors (must return real bytes)
  3. Optional BRDC navigation from BKG (public IGS mirror) bundled into the zip

Typical archive layouts recognised under RINEX_ARCHIVE_ROOT:
  {root}/{YYYY}/{DOY}/{site}*.{yy}o
  {root}/{YYYY}/{DOY}/{SITE}*_MO.rnx*
  {root}/{site}/{YYYY}/{DOY}/*
  {root}/{site}{DOY}0.{yy}o   (flat RINEX-2)
"""
from __future__ import annotations

import io
import logging
import os
import re
import zipfile
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import quote
from urllib.request import Request, urlopen

log = logging.getLogger(__name__)

_OBS_EXTS = {
    ".o",
    ".obs",
    ".rnx",
    ".24o",
    ".25o",
    ".26o",
    ".o.gz",
    ".obs.gz",
    ".rnx.gz",
    ".crx",
    ".crx.gz",
}
_NAV_EXTS = {".n", ".nav", ".p", ".g", ".24n", ".25n", ".26n", ".n.gz", ".nav.gz"}


@dataclass
class RinexFileHit:
    station: str
    day: date
    path: str
    name: str
    kind: str  # "obs" | "nav" | "other"
    source: str  # "archive" | "url" | "brdc"
    size_bytes: int | None = None


def archive_root() -> Path | None:
    raw = os.getenv("RINEX_ARCHIVE_ROOT", "").strip().strip('"').strip("'")
    if not raw:
        return None
    path = Path(raw)
    return path if path.exists() else path  # may not exist yet — callers check


def download_url_template() -> str:
    return os.getenv("RINEX_DOWNLOAD_URL_TEMPLATE", "").strip()


def _normalize_station(code: str) -> str:
    return (code or "").strip().lower().rstrip("_")


def _yy(day: date) -> str:
    return f"{day.year % 100:02d}"


def _doy(day: date) -> int:
    return int(day.timetuple().tm_yday)


def _daterange(start: date, end: date) -> list[date]:
    if end < start:
        start, end = end, start
    out: list[date] = []
    cur = start
    while cur <= end:
        out.append(cur)
        cur += timedelta(days=1)
    return out


def _is_obs_name(name: str) -> bool:
    lower = name.lower()
    return any(lower.endswith(ext) for ext in _OBS_EXTS)


def _is_nav_name(name: str) -> bool:
    lower = name.lower()
    return any(lower.endswith(ext) for ext in _NAV_EXTS)


def _station_in_name(name: str, station: str) -> bool:
    stem = name.split(".")[0].lower()
    st = _normalize_station(station)
    if stem.startswith(st):
        return True
    # RINEX3: HARA00ZWE_R_20262210000_01D_30S_MO.rnx
    if stem.startswith(f"{st}00") or f"_{st}" in stem:
        return True
    return st in stem[:9]


def _day_in_rinex2_name(name: str, day: date) -> bool:
    # karo1140.24o → DOY 114, year 24
    m = re.match(r"^[a-z0-9]{4}(\d{3})0\.(\d{2})[oOnNgGpP]", name, re.I)
    if not m:
        return False
    return int(m.group(1)) == _doy(day) and int(m.group(2)) == (day.year % 100)


def _day_in_rinex3_name(name: str, day: date) -> bool:
    m = re.search(r"_R_(\d{4})(\d{3})", name, re.I)
    if not m:
        return False
    return int(m.group(1)) == day.year and int(m.group(2)) == _doy(day)


def _matches_day(name: str, day: date) -> bool:
    return _day_in_rinex2_name(name, day) or _day_in_rinex3_name(name, day)


def _candidate_dirs(root: Path, station: str, day: date) -> list[Path]:
    st = _normalize_station(station)
    y, d = day.year, _doy(day)
    return [
        root / f"{y}" / f"{d:03d}",
        root / f"{y}" / f"{d:03d}" / st,
        root / st / f"{y}" / f"{d:03d}",
        root / st.upper() / f"{y}" / f"{d:03d}",
        root / st,
        root / st.upper(),
        root,
    ]


def find_archive_files(station: str, day: date, *, kinds: Iterable[str] = ("obs", "nav")) -> list[RinexFileHit]:
    root = archive_root()
    if root is None or not root.exists():
        return []
    want = set(kinds)
    hits: list[RinexFileHit] = []
    seen: set[str] = set()
    for folder in _candidate_dirs(root, station, day):
        if not folder.is_dir():
            continue
        try:
            entries = list(folder.iterdir())
        except OSError:
            continue
        for path in entries:
            if not path.is_file():
                continue
            name = path.name
            if not _station_in_name(name, station):
                continue
            # Flat root may contain many days — require DOY/year in filename when searching root.
            if folder.resolve() == root.resolve() and not _matches_day(name, day):
                continue
            if folder.name == _normalize_station(station) and not _matches_day(name, day):
                # station folder without doy subfolder
                if not _matches_day(name, day):
                    continue
            kind = "obs" if _is_obs_name(name) else "nav" if _is_nav_name(name) else "other"
            if kind not in want and not (kind == "other" and "obs" in want and _is_obs_name(name)):
                if kind not in want:
                    continue
            key = str(path.resolve())
            if key in seen:
                continue
            seen.add(key)
            try:
                size = path.stat().st_size
            except OSError:
                size = None
            hits.append(
                RinexFileHit(
                    station=_normalize_station(station),
                    day=day,
                    path=str(path),
                    name=name,
                    kind=kind if kind in {"obs", "nav"} else "obs",
                    source="archive",
                    size_bytes=size,
                )
            )
    return hits


def _format_url(template: str, *, station: str, day: date, filename: str = "") -> str:
    st = _normalize_station(station)
    return template.format(
        station=st,
        code=st,
        SITE=st.upper(),
        mount=st.upper(),
        mountpoint=st.upper(),
        year=day.year,
        yy=_yy(day),
        doy=_doy(day),
        DOY=f"{_doy(day):03d}",
        date=day.isoformat(),
        file=filename,
        filename=filename,
    )


def _default_remote_filenames(station: str, day: date) -> list[str]:
    st = _normalize_station(station)
    yy = _yy(day)
    doy = _doy(day)
    return [
        f"{st}{doy:03d}0.{yy}o",
        f"{st}{doy:03d}0.{yy}n",
        f"{st.upper()}00ZWE_R_{day.year}{doy:03d}0000_01D_30S_MO.rnx",
        f"{st.upper()}00ZWE_R_{day.year}{doy:03d}0000_01D_MN.rnx",
    ]


def fetch_url_files(station: str, day: date, *, kinds: Iterable[str] = ("obs",)) -> list[tuple[RinexFileHit, bytes]]:
    template = download_url_template()
    if not template:
        return []
    out: list[tuple[RinexFileHit, bytes]] = []
    for filename in _default_remote_filenames(station, day):
        kind = "nav" if _is_nav_name(filename) else "obs"
        if kind not in set(kinds):
            continue
        url = _format_url(template, station=station, day=day, filename=filename)
        try:
            req = Request(url, headers={"User-Agent": "ZGIIS-RinexDownload/1.0"})
            with urlopen(req, timeout=30) as resp:
                data = resp.read()
            if not data or len(data) < 32:
                continue
            hit = RinexFileHit(
                station=_normalize_station(station),
                day=day,
                path=url,
                name=filename,
                kind=kind,
                source="url",
                size_bytes=len(data),
            )
            out.append((hit, data))
        except Exception as exc:
            log.info("RINEX URL miss %s: %s", url, exc)
    return out


def fetch_brdc_nav(day: date) -> tuple[RinexFileHit, bytes] | None:
    """Public BKG mixed BRDC navigation file for the UTC day."""
    try:
        from zgiis.live.broadcast_ephemeris import _download_brdc
    except Exception:
        return None
    path = _download_brdc(datetime(day.year, day.month, day.day, tzinfo=timezone.utc))
    if path is None or not path.exists():
        return None
    try:
        data = path.read_bytes()
    finally:
        try:
            path.unlink(missing_ok=True)
        except Exception:
            pass
    name = f"BRDC00WRD_R_{day.year}{_doy(day):03d}0000_01D_MN.rnx"
    hit = RinexFileHit(
        station="brdc",
        day=day,
        path=name,
        name=name,
        kind="nav",
        source="brdc",
        size_bytes=len(data),
    )
    return hit, data


def list_station_catalog() -> list[dict[str, str]]:
    try:
        from zgiis.cors.stations import get_stations

        return [
            {"code": s.code, "name": s.name, "mountpoint": getattr(s, "mountpoint", "") or s.code.upper()}
            for s in get_stations()
        ]
    except Exception:
        return []


def availability(
    stations: list[str],
    start: date,
    end: date,
    *,
    include_nav: bool = True,
) -> dict[str, Any]:
    days = _daterange(start, end)
    if len(days) > 31:
        return {
            "ok": False,
            "message": "Date range limited to 31 days per request.",
            "days": [],
            "files": [],
            "station_rows": [],
            "coverage_pct": 0.0,
            "period_days": len(days),
            "archive_configured": archive_root() is not None and bool(archive_root() and archive_root().exists()),
            "url_configured": bool(download_url_template()),
        }

    kinds = ("obs", "nav") if include_nav else ("obs",)
    files: list[dict[str, Any]] = []
    by_day: list[dict[str, Any]] = []
    root = archive_root()
    archive_ok = root is not None and root.exists()
    url_ok = bool(download_url_template())

    for day in days:
        day_hits: list[RinexFileHit] = []
        for st in stations:
            if archive_ok:
                day_hits.extend(find_archive_files(st, day, kinds=kinds))
            # URL availability is optimistic listing of expected names when template set
            if url_ok and not any(h.station == _normalize_station(st) and h.day == day for h in day_hits):
                for name in _default_remote_filenames(st, day):
                    kind = "nav" if _is_nav_name(name) else "obs"
                    if kind not in kinds:
                        continue
                    if kind == "nav" and not include_nav:
                        continue
                    day_hits.append(
                        RinexFileHit(
                            station=_normalize_station(st),
                            day=day,
                            path=_format_url(download_url_template(), station=st, day=day, filename=name),
                            name=name,
                            kind=kind,
                            source="url",
                            size_bytes=None,
                        )
                    )
        by_day.append(
            {
                "date": day.isoformat(),
                "doy": _doy(day),
                "file_count": len(day_hits),
                "stations_with_files": sorted({h.station for h in day_hits}),
            }
        )
        for h in day_hits:
            files.append(
                {
                    "station": h.station,
                    "date": h.day.isoformat(),
                    "name": h.name,
                    "kind": h.kind,
                    "source": h.source,
                    "size_bytes": h.size_bytes,
                    "path": h.path if h.source == "archive" else None,
                }
            )

    # Per-station coverage over the requested period (for SpiderWeb-style list).
    station_rows: list[dict[str, Any]] = []
    catalog = { _normalize_station(s["code"]): s for s in list_station_catalog() }
    n_days = max(1, len(days))
    for st in stations:
        code = _normalize_station(st)
        days_with = sum(1 for d in by_day if code in d["stations_with_files"])
        file_count = sum(1 for f in files if f["station"] == code and f["kind"] == "obs")
        pct = round(100.0 * days_with / n_days, 2)
        meta = catalog.get(code) or {"code": code, "name": code.upper(), "mountpoint": code.upper()}
        station_rows.append(
            {
                "code": code,
                "name": meta.get("name") or code.upper(),
                "mountpoint": meta.get("mountpoint") or code.upper(),
                "days_available": days_with,
                "days_requested": n_days,
                "obs_files": file_count,
                "availability_pct": pct,
            }
        )

    return {
        "ok": True,
        "message": None
        if (archive_ok or url_ok)
        else (
            "No RINEX archive configured. Set RINEX_ARCHIVE_ROOT to the CORS daily RINEX "
            "folder (FTP push from GR50 / Spider), or RINEX_DOWNLOAD_URL_TEMPLATE for SpiderWeb."
        ),
        "archive_configured": archive_ok,
        "url_configured": url_ok,
        "brdc_nav_available": True,
        "days": by_day,
        "files": files,
        "station_rows": station_rows,
        "stations": [_normalize_station(s) for s in stations],
        "start": start.isoformat(),
        "end": end.isoformat(),
        "period_days": n_days,
        "coverage_pct": round(
            100.0
            * (sum(1 for d in by_day if d["file_count"] > 0) / n_days),
            2,
        )
        if n_days
        else 0.0,
    }


def build_download_zip(
    stations: list[str],
    start: date,
    end: date,
    *,
    include_nav: bool = True,
    include_brdc_nav: bool = True,
) -> tuple[bytes, dict[str, Any]]:
    """Collect real RINEX bytes into a zip. Raises ValueError if nothing found."""
    days = _daterange(start, end)
    if len(days) > 31:
        raise ValueError("Date range limited to 31 days per download.")
    if not stations:
        raise ValueError("Select at least one CORS station.")

    buf = io.BytesIO()
    meta_files: list[dict[str, Any]] = []
    added = 0
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        for day in days:
            for st in stations:
                # Local archive first
                for hit in find_archive_files(st, day, kinds=("obs", "nav") if include_nav else ("obs",)):
                    try:
                        data = Path(hit.path).read_bytes()
                    except OSError as exc:
                        log.warning("Failed reading %s: %s", hit.path, exc)
                        continue
                    arcname = f"{day.isoformat()}/{_normalize_station(st)}/{hit.name}"
                    zf.writestr(arcname, data)
                    added += 1
                    meta_files.append(
                        {
                            "station": hit.station,
                            "date": day.isoformat(),
                            "name": hit.name,
                            "kind": hit.kind,
                            "source": "archive",
                            "bytes": len(data),
                        }
                    )
                # Remote URL fallback for missing obs
                have_obs = any(
                    m["station"] == _normalize_station(st)
                    and m["date"] == day.isoformat()
                    and m["kind"] == "obs"
                    for m in meta_files
                )
                if not have_obs and download_url_template():
                    for hit, data in fetch_url_files(
                        st, day, kinds=("obs", "nav") if include_nav else ("obs",)
                    ):
                        arcname = f"{day.isoformat()}/{_normalize_station(st)}/{hit.name}"
                        zf.writestr(arcname, data)
                        added += 1
                        meta_files.append(
                            {
                                "station": hit.station,
                                "date": day.isoformat(),
                                "name": hit.name,
                                "kind": hit.kind,
                                "source": "url",
                                "bytes": len(data),
                            }
                        )

            if include_brdc_nav:
                brdc = fetch_brdc_nav(day)
                if brdc is not None:
                    hit, data = brdc
                    arcname = f"{day.isoformat()}/nav/{hit.name}"
                    zf.writestr(arcname, data)
                    added += 1
                    meta_files.append(
                        {
                            "station": "brdc",
                            "date": day.isoformat(),
                            "name": hit.name,
                            "kind": "nav",
                            "source": "brdc",
                            "bytes": len(data),
                        }
                    )

        readme = (
            "ZGIIS RINEX download for post-processing\n"
            f"Generated: {datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}\n"
            f"Stations: {', '.join(_normalize_station(s) for s in stations)}\n"
            f"Range: {start.isoformat()} → {end.isoformat()}\n"
            f"Files: {added}\n"
            "\nUse observation files with your PPK / office software (e.g. Spider X-Pos, "
            "RTKLIB, commercial PP). BRDC nav (if included) is the IGS combined broadcast "
            "ephemeris from BKG for the UTC day.\n"
        )
        zf.writestr("README.txt", readme)

    if added == 0:
        raise ValueError(
            "No RINEX observation files found for the selected stations and dates. "
            "Configure RINEX_ARCHIVE_ROOT or RINEX_DOWNLOAD_URL_TEMPLATE with real CORS archives."
        )

    return buf.getvalue(), {
        "file_count": added,
        "files": meta_files,
        "stations": [_normalize_station(s) for s in stations],
        "start": start.isoformat(),
        "end": end.isoformat(),
    }


def status_summary() -> dict[str, Any]:
    root = archive_root()
    return {
        "archive_root": str(root) if root else None,
        "archive_exists": bool(root and root.exists()),
        "url_template_configured": bool(download_url_template()),
        "brdc_nav": True,
        "message": None
        if (root and root.exists()) or download_url_template()
        else (
            "Point RINEX_ARCHIVE_ROOT at the folder where GR50/Spider stores daily RINEX "
            "(or set RINEX_DOWNLOAD_URL_TEMPLATE) to enable observation downloads."
        ),
    }
