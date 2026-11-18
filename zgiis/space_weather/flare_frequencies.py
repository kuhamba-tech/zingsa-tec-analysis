"""Yearly C/M/X solar-flare counts with mean sunspot number.

Historical years (1997–2016) come from NOAA NCEI GOES XRS flare reports.
Recent years (2017–present) are counted from NASA DONKI FLR so the current
year keeps updating. Yearly mean SSN is aggregated from NOAA SWPC observed
solar-cycle indices. Nothing is invented — a year is omitted when both flare
sources and SSN are missing.
"""
from __future__ import annotations

import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, timedelta, timezone
from typing import Any

try:
    import requests

    _REQUESTS_OK = True
except ImportError:
    _REQUESTS_OK = False

from zgiis.space_weather.solar_cycle_indices import NOAA_OBSERVED_URL, parse_noaa_monthly

NCEI_XRS_BASE = (
    "https://www.ngdc.noaa.gov/stp/space-weather/solar-data/"
    "solar-features/solar-flares/x-rays/goes/xrs"
)
NCEI_START_YEAR = 1997
NCEI_END_YEAR = 2016
DONKI_START_YEAR = 2017
DONKI_FLR_URL = "https://ccmc.gsfc.nasa.gov/DONKI-API/get/FLR"
_DONKI_MAX_DAYS = 60
_PARTIAL_CACHE_TTL_SECONDS = 5 * 60

_CACHE_TTL_SECONDS = 6 * 3600
_NCEI_CACHE_TTL_SECONDS = 7 * 24 * 3600
_CACHE: dict[str, Any] = {}
_CACHE_LOCK = threading.Lock()
_HEADERS = {"User-Agent": "ZGIIS/1.0 (Zimbabwe space-weather dashboard)", "Accept": "*/*"}

# Fixed-width / free-text GOES XRS rows carry the class letter before the GOES id.
_NCEI_CLASS_RE = re.compile(r"\b([BCMX])\s+\d+\s+G\d+\b", re.IGNORECASE)
_DONKI_CLASS_RE = re.compile(r"^([BCMX])", re.IGNORECASE)


def _empty_counts() -> dict[str, int]:
    return {"c_count": 0, "m_count": 0, "x_count": 0}


def _bump_class(bucket: dict[str, int], letter: str) -> None:
    key = letter.upper()
    if key == "C":
        bucket["c_count"] += 1
    elif key == "M":
        bucket["m_count"] += 1
    elif key == "X":
        bucket["x_count"] += 1


def count_ncei_xrs_text(text: str) -> dict[str, int]:
    """Count C/M/X flares in one NOAA NCEI GOES XRS yearly report."""
    counts = _empty_counts()
    for line in text.splitlines():
        match = _NCEI_CLASS_RE.search(line)
        if not match:
            continue
        _bump_class(counts, match.group(1))
    return counts


def count_donki_flares(rows: list[Any] | None) -> dict[str, int]:
    """Count C/M/X flares from a NASA DONKI FLR JSON array."""
    counts = _empty_counts()
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        klass = str(row.get("classType") or row.get("flrID") or "").strip()
        match = _DONKI_CLASS_RE.match(klass)
        if not match:
            continue
        _bump_class(counts, match.group(1))
    return counts


def yearly_mean_ssn(noaa_rows: list[dict[str, Any]], *, start_year: int) -> dict[int, float]:
    """Average NOAA monthly SSN into calendar-year means."""
    monthly = parse_noaa_monthly(noaa_rows, start_year=start_year)
    buckets: dict[int, list[float]] = {}
    for key, point in monthly.items():
        ssn = point.get("ssn")
        if ssn is None:
            continue
        year = int(key[:4])
        buckets.setdefault(year, []).append(float(ssn))
    return {
        year: round(sum(vals) / len(vals), 2)
        for year, vals in buckets.items()
        if vals
    }


def _fetch_text(url: str, *, timeout: int = 60) -> str:
    if not _REQUESTS_OK:
        raise RuntimeError("requests is not installed")
    resp = requests.get(url, timeout=timeout, headers=_HEADERS)
    resp.raise_for_status()
    return resp.text


def _fetch_json(url: str, *, timeout: int = 60) -> Any:
    if not _REQUESTS_OK:
        raise RuntimeError("requests is not installed")
    resp = requests.get(url, timeout=timeout, headers=_HEADERS)
    resp.raise_for_status()
    return resp.json()


def _fetch_ncei_year(year: int) -> tuple[int, dict[str, int] | None, str | None]:
    url = f"{NCEI_XRS_BASE}/goes-xrs-report_{year}.txt"
    try:
        text = _fetch_text(url, timeout=90)
        return year, count_ncei_xrs_text(text), None
    except Exception as exc:  # noqa: BLE001 — soft-fail one year, keep the rest
        return year, None, str(exc)


def _fetch_donki_year(year: int, today: date) -> tuple[int, dict[str, int] | None]:
    start = date(year, 1, 1)
    end = min(date(year, 12, 31), today)
    rows = []
    seen_ids = set()
    try:
        while start <= end:
            stop = min(start + timedelta(days=_DONKI_MAX_DAYS - 1), end)
            payload = _fetch_json(f"{DONKI_FLR_URL}?startDate={start}&endDate={stop}", timeout=20)
            if not isinstance(payload, list):
                return year, None
            for row in payload:
                event_id = row.get("flrID") if isinstance(row, dict) else None
                if event_id:
                    if event_id in seen_ids:
                        continue
                    seen_ids.add(event_id)
                rows.append(row)
            start = stop + timedelta(days=1)
    except Exception:  # noqa: BLE001 — keep other years available
        return year, None
    return year, count_donki_flares(rows)


def _load_ncei_counts(*, force_refresh: bool) -> dict[int, dict[str, int]]:
    with _CACHE_LOCK:
        cached = _CACHE.get("ncei")
        if (
            not force_refresh
            and isinstance(cached, dict)
            and time.time() - float(cached.get("at") or 0) < _NCEI_CACHE_TTL_SECONDS
        ):
            return dict(cached.get("years") or {})

    years: dict[int, dict[str, int]] = {}
    with ThreadPoolExecutor(max_workers=6) as pool:
        jobs = [pool.submit(_fetch_ncei_year, year) for year in range(NCEI_START_YEAR, NCEI_END_YEAR + 1)]
        for job in as_completed(jobs):
            year, counts, _error = job.result()
            if counts is not None:
                years[year] = counts

    with _CACHE_LOCK:
        _CACHE["ncei"] = {"at": time.time(), "years": years}
    return years


def _load_donki_counts(*, force_refresh: bool) -> tuple[dict[int, dict[str, int]], str | None]:
    today = datetime.now(timezone.utc).date()
    now_year = today.year
    with _CACHE_LOCK:
        cached = _CACHE.get("donki")
        if (
            not force_refresh
            and isinstance(cached, dict)
            and cached["year"] == now_year
            and time.time() - float(cached.get("at") or 0) < cached["ttl"]
        ):
            return dict(cached.get("years") or {}), cached.get("note")

    previous = dict(cached.get("years") or {}) if isinstance(cached, dict) else {}
    if cached and cached["year"] != now_year:
        previous.pop(cached["year"], None)
    years = dict(previous)
    errors: list[int] = []
    with ThreadPoolExecutor(max_workers=8) as pool:
        jobs = [
            pool.submit(_fetch_donki_year, year, today)
            for year in range(DONKI_START_YEAR, now_year + 1)
            if force_refresh or year == now_year or year not in previous
        ]
        for job in as_completed(jobs):
            year, counts = job.result()
            if counts is not None:
                years[year] = counts
            else:
                errors.append(year)

    note = None
    if errors:
        failed = ", ".join(str(year) for year in sorted(errors))
        note = f"DONKI could not refresh {failed}. Previously loaded totals are retained where available."
    ttl = _PARTIAL_CACHE_TTL_SECONDS if errors else _CACHE_TTL_SECONDS

    with _CACHE_LOCK:
        _CACHE["donki"] = {"at": time.time(), "year": now_year, "years": years, "note": note, "ttl": ttl}
    return years, note


def _load_yearly_ssn(*, force_refresh: bool) -> dict[int, float]:
    with _CACHE_LOCK:
        cached = _CACHE.get("ssn")
        if (
            not force_refresh
            and isinstance(cached, dict)
            and time.time() - float(cached.get("at") or 0) < _CACHE_TTL_SECONDS
        ):
            return dict(cached.get("years") or {})

    rows = _fetch_json(NOAA_OBSERVED_URL, timeout=45)
    if not isinstance(rows, list):
        rows = []
    years = yearly_mean_ssn(rows, start_year=NCEI_START_YEAR)
    with _CACHE_LOCK:
        _CACHE["ssn"] = {"at": time.time(), "years": years}
    return years


def build_flare_frequencies(*, force_refresh: bool = False) -> dict[str, Any]:
    """Assemble yearly C/M/X counts and mean SSN for the flare-frequency chart."""
    with _CACHE_LOCK:
        cached = _CACHE.get("payload")
        if (
            not force_refresh
            and isinstance(cached, dict)
            and cached["payload"]["end_year"] == datetime.now(timezone.utc).year
            and time.time() - float(cached.get("at") or 0) < cached["ttl"]
        ):
            return dict(cached.get("payload") or {})

    ncei = _load_ncei_counts(force_refresh=force_refresh)
    donki, donki_note = _load_donki_counts(force_refresh=force_refresh)
    try:
        ssn = _load_yearly_ssn(force_refresh=force_refresh)
    except Exception as exc:  # noqa: BLE001
        ssn = {}
        ssn_error = str(exc)
    else:
        ssn_error = None

    now_year = datetime.now(timezone.utc).year
    years = sorted(set(ncei) | set(donki) | set(ssn) | set(range(NCEI_START_YEAR, now_year + 1)))
    points: list[dict[str, Any]] = []
    for year in years:
        if year < NCEI_START_YEAR or year > now_year:
            continue
        if year <= NCEI_END_YEAR:
            counts = ncei.get(year)
            source = "noaa_ncei_goes_xrs" if counts is not None else None
        else:
            counts = donki.get(year)
            source = "nasa_donki_flr" if counts is not None else None
        mean_ssn = ssn.get(year)
        if counts is None and mean_ssn is None:
            continue
        c = int(counts["c_count"]) if counts else None
        m = int(counts["m_count"]) if counts else None
        x = int(counts["x_count"]) if counts else None
        points.append(
            {
                "year": year,
                "c_count": c,
                "m_count": m,
                "x_count": x,
                "ssn": mean_ssn,
                "flare_source": source,
                "ssn_source": "noaa_swpc" if mean_ssn is not None else None,
            }
        )

    mode = "live" if points else "unavailable"
    sources = []
    if ncei:
        sources.append("NOAA NCEI GOES XRS (1997–2016)")
    if donki:
        sources.append("NASA DONKI FLR (2017–present)")
    if ssn:
        sources.append("NOAA SWPC observed solar-cycle SSN")
    note_parts = [part for part in (donki_note, ssn_error and f"SSN fetch: {ssn_error}") if part]

    payload = {
        "mode": mode,
        "updated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "start_year": NCEI_START_YEAR,
        "end_year": now_year,
        "point_count": len(points),
        "source": " · ".join(sources) if sources else "unavailable",
        "note": " ".join(note_parts) if note_parts else "",
        "points": points,
    }
    with _CACHE_LOCK:
        _CACHE["payload"] = {
            "at": time.time(),
            "payload": payload,
            "ttl": _PARTIAL_CACHE_TTL_SECONDS if donki_note or ssn_error else _CACHE_TTL_SECONDS,
        }
    return payload


DAILY_SOLAR_URL = "https://services.swpc.noaa.gov/text/daily-solar-indices.txt"
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def _daily_number(token: str) -> float | None:
    text = (token or "").strip()
    if not text or text in {"*", "-999"}:
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    if value < 0:
        return None
    return value


def parse_daily_solar_data(text: str) -> list[dict[str, Any]]:
    """Last-30-days C/M/X flare counts and SESC sunspot number from NOAA DSD."""
    rows: list[dict[str, Any]] = []
    for line in (text or "").splitlines():
        stripped = line.strip()
        if not stripped or stripped[0] in "#:":
            continue
        parts = stripped.split()
        if len(parts) < 12:
            continue
        try:
            year = int(parts[0])
            month = int(parts[1])
            day = int(parts[2])
        except ValueError:
            continue
        if not 1 <= month <= 12 or not 1 <= day <= 31:
            continue
        ssn = _daily_number(parts[4])
        c_count = _daily_number(parts[9])
        m_count = _daily_number(parts[10])
        x_count = _daily_number(parts[11])
        rows.append(
            {
                "date": f"{year:04d}-{month:02d}-{day:02d}",
                "label": f"{day} {_MONTHS[month - 1]}",
                "c_count": None if c_count is None else int(c_count),
                "m_count": None if m_count is None else int(m_count),
                "x_count": None if x_count is None else int(x_count),
                "ssn": None if ssn is None else int(ssn),
            }
        )
    rows.sort(key=lambda row: row["date"])
    return rows


def build_flare_month(*, force_refresh: bool = False) -> dict[str, Any]:
    """Daily C/M/X flares and sunspot number for the past month."""
    with _CACHE_LOCK:
        cached = _CACHE.get("month")
        if (
            not force_refresh
            and isinstance(cached, dict)
            and time.time() - float(cached.get("at") or 0) < 30 * 60
        ):
            return dict(cached.get("payload") or {})

    days: list[dict[str, Any]] = []
    error: str | None = None
    try:
        days = parse_daily_solar_data(_fetch_text(DAILY_SOLAR_URL, timeout=30))
    except Exception as exc:  # noqa: BLE001 — the card says unavailable instead of inventing a month
        error = str(exc)
    payload = {
        "mode": "live" if days else "unavailable",
        "updated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "source": "NOAA SWPC Daily Solar Data",
        "note": "" if days else (error or "The NOAA daily solar file could not be read."),
        "days": days,
    }
    if days:
        with _CACHE_LOCK:
            _CACHE["month"] = {"at": time.time(), "payload": payload}
    return payload
