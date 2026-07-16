"""COSMIC-2 provisional space-weather archive availability.

UCAR publishes COSMIC-2 GNSS-RO provisional space-weather products in an
Apache-style directory tree:

  level2/YYYY/DDD/ionPrf_prov1_YYYY_DDD.tar.gz

This module checks the daily Level-2 ionPrf archives for a selected date range
and returns lightweight metadata for the time-series space-segment panel. It
does not download the tarballs.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import UTC, date, datetime, timedelta
from functools import lru_cache
from typing import Any

import requests


BASE_URL = "https://data.cosmic.ucar.edu/gnss-ro/cosmic2/provisional/spaceWeather"
LEVEL2_URL = f"{BASE_URL}/level2"
MISSION_URL = "https://www.cosmic.ucar.edu/what-we-do/cosmic-2/"
PRODUCT = "ionPrf provisional Level-2"
MAX_DAYS_PER_REQUEST = 370


def _daterange(start: date, end: date) -> list[date]:
    if end < start:
        start, end = end, start
    days = min((end - start).days + 1, MAX_DAYS_PER_REQUEST)
    return [start + timedelta(days=i) for i in range(days)]


def _file_url(day: date) -> tuple[str, str, int]:
    doy = day.timetuple().tm_yday
    doy_s = f"{doy:03d}"
    filename = f"ionPrf_prov1_{day.year}_{doy_s}.tar.gz"
    return f"{LEVEL2_URL}/{day.year}/{doy_s}/{filename}", filename, doy


def _parse_size(header_value: str | None) -> int | None:
    if not header_value:
        return None
    try:
        return int(header_value)
    except ValueError:
        return None


@lru_cache(maxsize=1024)
def _check_archive_cached(day_iso: str, timeout: int) -> dict[str, Any]:
    day = date.fromisoformat(day_iso)
    url, filename, doy = _file_url(day)
    row: dict[str, Any] = {
        "date": day.isoformat(),
        "year": day.year,
        "doy": doy,
        "file_name": filename,
        "file_url": url,
        "available": False,
        "size_bytes": None,
        "status": "missing",
        "note": "",
    }
    try:
        resp = requests.head(url, allow_redirects=True, timeout=timeout)
        if resp.status_code == 405:
            resp = requests.get(url, stream=True, timeout=timeout)
        row["available"] = resp.status_code == 200
        row["status"] = "available" if row["available"] else f"http_{resp.status_code}"
        row["size_bytes"] = _parse_size(resp.headers.get("content-length"))
        if not row["available"]:
            row["note"] = f"UCAR returned HTTP {resp.status_code}"
    except Exception as exc:
        row["status"] = "unreachable"
        row["note"] = str(exc)
    return row


def fetch_cosmic2_daily(start: date, end: date, *, timeout: int = 20) -> list[dict[str, Any]]:
    days = _daterange(start, end)
    if not days:
        return []
    workers = min(12, max(1, len(days)))
    rows: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {
            pool.submit(_check_archive_cached, day.isoformat(), timeout): day
            for day in days
        }
        for future in as_completed(futures):
            rows.append(future.result())
    return sorted(rows, key=lambda row: row["date"])


def build_analysis(rows: list[dict[str, Any]]) -> dict[str, Any]:
    available = [r for r in rows if r.get("available")]
    sizes = [r["size_bytes"] for r in available if isinstance(r.get("size_bytes"), int)]
    return {
        "source": "UCAR COSMIC-2 provisional space-weather archive",
        "source_url": BASE_URL + "/",
        "level2_url": LEVEL2_URL + "/",
        "mission_url": MISSION_URL,
        "product": PRODUCT,
        "start_date": rows[0]["date"] if rows else None,
        "end_date": rows[-1]["date"] if rows else None,
        "days": len(rows),
        "available_days": len(available),
        "missing_days": max(0, len(rows) - len(available)),
        "total_size_bytes": sum(sizes) if sizes else None,
        "status": "available" if available else "unavailable",
        "message": (
            f"{len(available)} of {len(rows)} selected day(s) have COSMIC-2 ionPrf archives."
            if rows
            else "No dates selected."
        ),
        "series": rows,
        "fetched_at": datetime.now(UTC).isoformat(),
    }
