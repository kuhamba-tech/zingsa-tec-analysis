"""Monthly F10.7 and SSN full-record series for solar-cycle charts.

SSN comes from NOAA SWPC observed solar-cycle indices. F10.7 in that product
is only populated from 2004-10 onward; earlier months are filled from LISIRD
daily NOAA radio-flux observations aggregated to calendar-month means.

No synthetic values are invented — missing source months stay null.
"""
from __future__ import annotations

import csv
import io
import threading
import time
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

try:
    import requests

    _REQUESTS_OK = True
except ImportError:
    _REQUESTS_OK = False

NOAA_OBSERVED_URL = (
    "https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json"
)
LISIRD_DAILY_CSV_URL = (
    "https://lasp.colorado.edu/lisird/latis/dap/noaa_radio_flux.csv"
)

_CACHE_TTL_SECONDS = 12 * 3600
_CACHE: dict[str, Any] = {}
_CACHE_LOCK = threading.Lock()
_HEADERS = {"User-Agent": "ZGIIS/1.0 (Zimbabwe space-weather dashboard)"}


def _valid_index(value: Any) -> float | None:
    """NOAA uses -1.0 as a missing sentinel in the monthly JSON."""
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number < 0:
        return None
    return number


def _year_month_to_frac(year: int, month: int) -> float:
    return year + (month - 1) / 12.0


def parse_noaa_monthly(rows: list[dict[str, Any]], *, start_year: int) -> dict[str, dict[str, Any]]:
    """Parse NOAA monthly rows into ``YYYY-MM`` keyed dicts."""
    out: dict[str, dict[str, Any]] = {}
    for row in rows:
        if not isinstance(row, dict):
            continue
        tag = str(row.get("time-tag") or "").strip()
        if len(tag) < 7 or tag[4] != "-":
            continue
        try:
            year = int(tag[:4])
            month = int(tag[5:7])
        except ValueError:
            continue
        if year < start_year or month < 1 or month > 12:
            continue
        key = f"{year:04d}-{month:02d}"
        out[key] = {
            "time_tag": key,
            "year_month": key,
            "year_frac": round(_year_month_to_frac(year, month), 6),
            "ssn": _valid_index(row.get("ssn")),
            "f107": _valid_index(row.get("f10.7")),
            "f107_source": "noaa" if _valid_index(row.get("f10.7")) is not None else None,
            "ssn_source": "noaa" if _valid_index(row.get("ssn")) is not None else None,
        }
    return out


def aggregate_lisird_daily_to_monthly(csv_text: str, *, start_year: int) -> dict[str, float]:
    """Aggregate LISIRD daily F10.7 CSV into monthly means (observed, else adjusted)."""
    reader = csv.DictReader(io.StringIO(csv_text))
    buckets: dict[str, list[float]] = defaultdict(list)
    for row in reader:
        # Column names vary slightly; match by substring.
        time_raw = ""
        observed = None
        adjusted = None
        for key, value in row.items():
            if key is None:
                continue
            lower = key.lower()
            if "time" in lower and not time_raw:
                time_raw = (value or "").strip()
            elif "f107_observed" in lower or "f107 observed" in lower:
                observed = _valid_index(value)
            elif "f107_adjusted" in lower or "f107 adjusted" in lower:
                adjusted = _valid_index(value)

        if len(time_raw) < 6:
            continue
        digits = "".join(ch for ch in time_raw if ch.isdigit())
        if len(digits) < 6:
            continue
        try:
            year = int(digits[:4])
            month = int(digits[4:6])
        except ValueError:
            continue
        if year < start_year or month < 1 or month > 12:
            continue
        flux = observed if observed is not None else adjusted
        if flux is None:
            continue
        buckets[f"{year:04d}-{month:02d}"].append(flux)

    return {
        key: round(sum(vals) / len(vals), 2)
        for key, vals in buckets.items()
        if vals
    }


def merge_solar_cycle_series(
    noaa_by_month: dict[str, dict[str, Any]],
    lisird_f107: dict[str, float],
    *,
    start_year: int,
) -> list[dict[str, Any]]:
    """Prefer NOAA F10.7; fill gaps from LISIRD monthly means. Keep NOAA SSN."""
    keys = sorted(set(noaa_by_month) | set(lisird_f107))
    points: list[dict[str, Any]] = []
    for key in keys:
        year = int(key[:4])
        month = int(key[5:7])
        if year < start_year:
            continue
        base = noaa_by_month.get(key) or {
            "time_tag": key,
            "year_month": key,
            "year_frac": round(_year_month_to_frac(year, month), 6),
            "ssn": None,
            "f107": None,
            "f107_source": None,
            "ssn_source": None,
        }
        point = dict(base)
        if point.get("f107") is None and key in lisird_f107:
            point["f107"] = lisird_f107[key]
            point["f107_source"] = "lisird"
        if point.get("ssn") is None and point.get("f107") is None:
            continue
        points.append(
            {
                "time_tag": point["time_tag"],
                "year_month": point["year_month"],
                "year_frac": point["year_frac"],
                "f107": point.get("f107"),
                "ssn": point.get("ssn"),
                "f107_source": point.get("f107_source"),
                "ssn_source": point.get("ssn_source"),
            }
        )
    return points


def _fetch_noaa_monthly(*, timeout: int = 45) -> list[dict[str, Any]]:
    if not _REQUESTS_OK:
        return []
    resp = requests.get(NOAA_OBSERVED_URL, timeout=timeout, headers=_HEADERS)
    resp.raise_for_status()
    data = resp.json()
    return data if isinstance(data, list) else []


def _fetch_lisird_monthly_f107(*, start_year: int, end_exclusive: str, timeout: int = 90) -> dict[str, float]:
    """Fetch daily LISIRD F10.7 and aggregate to monthly means.

    ``end_exclusive`` is an ISO date string (YYYY-MM-DD) used as an exclusive
    upper bound for the LaTiS ``time<`` constraint.
    """
    if not _REQUESTS_OK:
        return {}
    url = (
        f"{LISIRD_DAILY_CSV_URL}"
        f"?time%3E={start_year}-01-01"
        f"&time%3C{end_exclusive}"
    )
    resp = requests.get(url, timeout=timeout, headers=_HEADERS)
    resp.raise_for_status()
    return aggregate_lisird_daily_to_monthly(resp.text, start_year=start_year)


def _coverage(points: list[dict[str, Any]]) -> dict[str, str | None]:
    f107_tags = [p["time_tag"] for p in points if p.get("f107") is not None]
    ssn_tags = [p["time_tag"] for p in points if p.get("ssn") is not None]
    return {
        "f107_from": f107_tags[0] if f107_tags else None,
        "f107_to": f107_tags[-1] if f107_tags else None,
        "ssn_from": ssn_tags[0] if ssn_tags else None,
        "ssn_to": ssn_tags[-1] if ssn_tags else None,
    }


def build_solar_cycle_indices(*, start_year: int = 1965, force_refresh: bool = False) -> dict[str, Any]:
    """Return merged monthly F10.7 + SSN series from start_year to present."""
    if start_year < 1749:
        start_year = 1749
    cache_key = f"solar_cycle_indices_{start_year}"
    now = time.time()
    with _CACHE_LOCK:
        cached = _CACHE.get(cache_key)
        if (
            not force_refresh
            and cached
            and now - cached["ts"] < _CACHE_TTL_SECONDS
            and isinstance(cached.get("data"), dict)
        ):
            return cached["data"]

    noaa_rows = _fetch_noaa_monthly()
    noaa_by_month = parse_noaa_monthly(noaa_rows, start_year=start_year)

    lisird_f107: dict[str, float] = {}
    lisird_error: str | None = None
    first_noaa_f107 = next(
        (key for key in sorted(noaa_by_month) if noaa_by_month[key].get("f107") is not None),
        None,
    )
    need_lisird = first_noaa_f107 is None or any(
        key < first_noaa_f107 and point.get("f107") is None
        for key, point in noaa_by_month.items()
    )
    if need_lisird:
        if first_noaa_f107:
            y, m = int(first_noaa_f107[:4]), int(first_noaa_f107[5:7])
            end_exclusive = f"{y + 1}-01-01" if m == 12 else f"{y}-{m + 1:02d}-01"
        else:
            today = datetime.now(timezone.utc).date()
            end_exclusive = today.fromordinal(today.toordinal() + 1).isoformat()
        try:
            lisird_f107 = _fetch_lisird_monthly_f107(
                start_year=start_year,
                end_exclusive=end_exclusive,
            )
        except Exception as exc:  # noqa: BLE001 — keep NOAA rows if LISIRD fails
            lisird_error = str(exc)

    points = merge_solar_cycle_series(noaa_by_month, lisird_f107, start_year=start_year)
    coverage = _coverage(points)
    sources = ["NOAA SWPC observed-solar-cycle-indices"]
    if any(p.get("f107_source") == "lisird" for p in points):
        sources.append("LISIRD noaa_radio_flux (monthly mean of daily F10.7)")

    payload = {
        "mode": "live" if points else "unavailable",
        "source": " · ".join(sources),
        "updated_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "start_year": start_year,
        "point_count": len(points),
        "f107_from": coverage["f107_from"],
        "f107_to": coverage["f107_to"],
        "ssn_from": coverage["ssn_from"],
        "ssn_to": coverage["ssn_to"],
        "lisird_error": lisird_error,
        "points": points,
    }

    with _CACHE_LOCK:
        _CACHE[cache_key] = {"ts": now, "data": payload}
    return payload


def clear_solar_cycle_indices_cache() -> None:
    with _CACHE_LOCK:
        _CACHE.clear()
