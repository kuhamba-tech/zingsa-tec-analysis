"""Fetch geomagnetic observatory data from INTERMAGNET (BGS GIN web service).

Source: https://imag-data.bgs.ac.uk/GIN_V1/GINForms2
Service: https://imag-data.bgs.ac.uk/GIN_V1/GINServices (JSON, column-oriented:
keys datetime, X, Y, Z, S at 1-minute cadence).

Southern-African observatories nearest Zimbabwe are offered; minute values
are aggregated into daily statistics: mean horizontal field H = sqrt(X²+Y²),
daily H range, and the daily maximum |dH/dt| (nT/min) — the physical driver
of geomagnetically induced currents. A first-order modelled peak GIC
(K x max dH/dt, same coefficient as the GIC Monitor) is included so ground
magnetometer activity can be read in grid-impact terms.

Storm-day classification is based on dH/dt and daily range, since local
ground data has no Kp/Dst.
"""
from __future__ import annotations

import math
import threading
import time
from datetime import date, datetime, timedelta, timezone
from typing import Any

import requests

GIN_URL = "https://imag-data.bgs.ac.uk/GIN_V1/GINServices"

OBSERVATORIES: dict[str, dict[str, Any]] = {
    "HER": {"code": "HER", "name": "Hermanus, South Africa", "lat": -34.43, "lon": 19.23},
    "HBK": {"code": "HBK", "name": "Hartebeesthoek, South Africa", "lat": -25.88, "lon": 27.71},
    "TSU": {"code": "TSU", "name": "Tsumeb, Namibia", "lat": -19.20, "lon": 17.58},
    "KMH": {"code": "KMH", "name": "Keetmanshoop, Namibia", "lat": -26.54, "lon": 18.11},
}

# Same effective network response used by the GIC Monitor live model.
NETWORK_COEFF_A_PER_NT_MIN = 0.8

# South African INTERMAGNET observatories. Both sit south of the Zimbabwe map frame.
SOUTH_AFRICA_CODES = ("HER", "HBK")
# A sample this fresh is near-real-time. Older public minutes are still shown, with their age.
NEAR_REAL_TIME_MINUTES = 180
_LOOKBACK_DAYS = 21
_CACHE_SECONDS = 600
_MISSING_ABS = 99999.0

_CHUNK_DAYS = 31
_MAX_DAYS = 400
_latest_lock = threading.Lock()
_latest_cache: dict[str, Any] = {"at": 0.0, "payload": None}


def _storm_class(max_dbdt: float | None, range_h: float | None) -> str:
    d = max_dbdt or 0.0
    r = range_h or 0.0
    if d >= 60:
        return "Extreme dB/dt"
    if d >= 30:
        return "Strong storm"
    if d >= 10 or r >= 150:
        return "Minor storm"
    if d >= 5 or r >= 80:
        return "Active"
    return "Quiet"


def _is_storm_day(max_dbdt: float | None, range_h: float | None) -> bool:
    return (max_dbdt or 0.0) >= 10 or (range_h or 0.0) >= 150


def _fetch_chunk(observatory: str, start: date, days: int, timeout: int) -> dict[str, Any]:
    params = {
        "Request": "GetData",
        "format": "json",
        "testObsys": "0",
        "observatoryIagaCode": observatory,
        "samplesPerDay": "1440",
        "publicationState": "best-avail",
        "dataStartDate": start.isoformat(),
        "dataDuration": str(days),
    }
    resp = requests.get(GIN_URL, params=params, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def fetch_intermagnet_daily(
    observatory: str,
    start: date,
    end: date,
    *,
    timeout: int = 90,
) -> list[dict[str, Any]]:
    """Return daily aggregates of INTERMAGNET minute data between start and end."""
    observatory = observatory.upper()
    if observatory not in OBSERVATORIES:
        raise ValueError(f"Unknown observatory '{observatory}'. Choose from {', '.join(OBSERVATORIES)}.")
    if end < start:
        start, end = end, start
    if (end - start).days > _MAX_DAYS:
        raise ValueError(f"Date range too large — maximum {_MAX_DAYS} days per request.")

    # Accumulate per-day stats across monthly chunks.
    by_day: dict[str, dict[str, Any]] = {}
    cursor = start
    while cursor <= end:
        days = min(_CHUNK_DAYS, (end - cursor).days + 1)
        payload = _fetch_chunk(observatory, cursor, days, timeout)
        times = payload.get("datetime") or []
        xs = payload.get("X") or []
        ys = payload.get("Y") or []

        prev_h: float | None = None
        prev_day: str | None = None
        for i, t in enumerate(times):
            x = xs[i] if i < len(xs) else None
            y = ys[i] if i < len(ys) else None
            if x is None or y is None:
                prev_h = None
                continue
            h = math.hypot(float(x), float(y))
            day = str(t)[:10]
            d = by_day.setdefault(
                day,
                {"sum": 0.0, "n": 0, "min": h, "max": h, "max_dbdt": 0.0},
            )
            d["sum"] += h
            d["n"] += 1
            d["min"] = min(d["min"], h)
            d["max"] = max(d["max"], h)
            if prev_h is not None and prev_day == day:
                d["max_dbdt"] = max(d["max_dbdt"], abs(h - prev_h))
            prev_h = h
            prev_day = day
        cursor += timedelta(days=days)

    rows: list[dict[str, Any]] = []
    for day in sorted(by_day):
        d = by_day[day]
        if d["n"] == 0:
            continue
        mean_h = d["sum"] / d["n"]
        range_h = d["max"] - d["min"]
        max_dbdt = d["max_dbdt"]
        rows.append({
            "date": day,
            "mean_h": round(mean_h, 1),
            "range_h": round(range_h, 1),
            "max_dbdt": round(max_dbdt, 2),
            "gic_est_a": round(NETWORK_COEFF_A_PER_NT_MIN * max_dbdt, 2),
            "samples": int(d["n"]),
            "storm_flag": _is_storm_day(max_dbdt, range_h),
            "storm_class": _storm_class(max_dbdt, range_h),
        })
    return rows


def build_analysis(
    rows: list[dict[str, Any]],
    vtec_by_date: dict[str, float] | None = None,
    *,
    observatory: str = "",
) -> dict[str, Any]:
    """Summarise daily INTERMAGNET rows and optional mean-VTEC correlation."""
    vtec_by_date = vtec_by_date or {}
    storm_days = [r for r in rows if r.get("storm_flag")]
    quiet_days = [r for r in rows if not r.get("storm_flag")]

    def _mean_vtec(days: list[dict[str, Any]]) -> float | None:
        vals = [vtec_by_date[d["date"]] for d in days if d["date"] in vtec_by_date]
        return round(sum(vals) / len(vals), 2) if vals else None

    merged = [{**r, "mean_vtec": vtec_by_date.get(r["date"])} for r in rows]

    dbdt_vals = [r["max_dbdt"] for r in rows if r.get("max_dbdt") is not None]
    range_vals = [r["range_h"] for r in rows if r.get("range_h") is not None]

    obs_meta = OBSERVATORIES.get(observatory.upper(), {})
    return {
        "source": (
            f"INTERMAGNET / BGS GIN — {obs_meta.get('name', observatory)} "
            "(https://imag-data.bgs.ac.uk/GIN_V1/GINForms2)"
        ),
        "observatory": observatory.upper(),
        "observatory_name": obs_meta.get("name"),
        "start_date": rows[0]["date"] if rows else None,
        "end_date": rows[-1]["date"] if rows else None,
        "days": len(rows),
        "storm_days": len(storm_days),
        "max_dbdt": max(dbdt_vals) if dbdt_vals else None,
        "max_range_h": max(range_vals) if range_vals else None,
        "max_gic_est_a": round(NETWORK_COEFF_A_PER_NT_MIN * max(dbdt_vals), 2) if dbdt_vals else None,
        "mean_vtec_storm": _mean_vtec(storm_days),
        "mean_vtec_quiet": _mean_vtec(quiet_days),
        "series": merged,
        "storms": [
            {
                "date": r["date"],
                "max_dbdt": r.get("max_dbdt"),
                "range_h": r.get("range_h"),
                "gic_est_a": r.get("gic_est_a"),
                "storm_class": r.get("storm_class", "Quiet"),
                "mean_vtec": vtec_by_date.get(r["date"]),
            }
            for r in storm_days
        ],
        "fetched_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
    }


def _gin_get(params: dict[str, str], timeout: int = 45) -> dict[str, Any]:
    resp = requests.get(GIN_URL, params=params, timeout=timeout)
    resp.raise_for_status()
    payload = resp.json()
    if not isinstance(payload, dict):
        raise ValueError("INTERMAGNET response was not a JSON object")
    return payload


def parse_directory_date(text: str) -> date:
    """GIN directory dates are DD-MM-YYYY."""
    day_s, month_s, year_s = str(text).split("-")
    return date(int(year_s), int(month_s), int(day_s))


def _finite_component(value: Any) -> float | None:
    if value is None:
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if not math.isfinite(number) or abs(number) >= _MISSING_ABS:
        return None
    return number


def newest_recorded_day(days: list[dict[str, Any]]) -> date | None:
    """Newest directory day that actually contains samples."""
    found: date | None = None
    for row in days:
        try:
            recorded = int(row.get("samples_recorded") or 0)
        except (TypeError, ValueError):
            recorded = 0
        if recorded <= 0:
            continue
        try:
            day = parse_directory_date(str(row.get("date")))
        except (TypeError, ValueError):
            continue
        if found is None or day > found:
            found = day
    return found


def summarise_iaga2002(text: str, *, now: datetime) -> dict[str, Any] | None:
    """Parse an IAGA-2002 minute file.

    The GIN JSON product currently returns null components for days whose
    directory lists recorded samples. The IAGA-2002 file for the same day
    carries the values. Missing samples are 99999.
    """
    times: list[str] = []
    xs: list[float | None] = []
    ys: list[float | None] = []
    zs: list[float | None] = []
    fs: list[float | None] = []
    for line in text.splitlines():
        if not line or not line[0].isdigit():
            continue
        parts = line.split()
        if len(parts) < 7:
            continue
        times.append(f"{parts[0]}T{parts[1]}Z")
        xs.append(_finite_component(parts[3]))
        ys.append(_finite_component(parts[4]))
        zs.append(_finite_component(parts[5]))
        fs.append(_finite_component(parts[6]))
    return summarise_minute_day(
        {"datetime": times, "X": xs, "Y": ys, "Z": zs, "F": fs},
        now=now,
    )


def summarise_minute_day(
    payload: dict[str, Any],
    *,
    now: datetime,
) -> dict[str, Any] | None:
    """Last finite XYZF minute and the one-minute dH/dt ending on that sample."""
    times = payload.get("datetime") or []
    xs = payload.get("X") or []
    ys = payload.get("Y") or []
    zs = payload.get("Z") or []
    fs = payload.get("F") or payload.get("S") or []
    samples: list[dict[str, Any]] = []
    for i, raw_time in enumerate(times):
        x = _finite_component(xs[i] if i < len(xs) else None)
        y = _finite_component(ys[i] if i < len(ys) else None)
        if x is None or y is None:
            continue
        stamp = _parse_stamp(str(raw_time))
        if stamp is None:
            continue
        z = _finite_component(zs[i] if i < len(zs) else None)
        f = _finite_component(fs[i] if i < len(fs) else None)
        samples.append({
            "time": stamp,
            "x": x,
            "y": y,
            "z": z,
            "f": f,
            "h": math.hypot(x, y),
        })
    if not samples:
        return None
    latest = samples[-1]
    previous = samples[-2] if len(samples) >= 2 else None
    dhdt = None
    if previous is not None:
        step_s = (latest["time"] - previous["time"]).total_seconds()
        if 50 <= step_s <= 70:
            dhdt = (latest["h"] - previous["h"]) / (step_s / 60.0)
    window = samples[-61:]
    rates: list[float] = []
    for left, right in zip(window, window[1:]):
        step_s = (right["time"] - left["time"]).total_seconds()
        if 50 <= step_s <= 70:
            rates.append(abs((right["h"] - left["h"]) / (step_s / 60.0)))
    age_minutes = (now - latest["time"]).total_seconds() / 60.0
    status = "near-real-time" if age_minutes <= NEAR_REAL_TIME_MINUTES else "delayed"
    return {
        "status": status,
        "time": latest["time"].replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "age_minutes": round(age_minutes, 1),
        "x_nt": round(latest["x"], 2),
        "y_nt": round(latest["y"], 2),
        "z_nt": None if latest["z"] is None else round(latest["z"], 2),
        "f_nt": None if latest["f"] is None else round(latest["f"], 2),
        "h_nt": round(latest["h"], 2),
        "dhdt_nt_per_min": None if dhdt is None else round(dhdt, 3),
        "max_abs_dhdt_1h": None if not rates else round(max(rates), 3),
        "samples": len(samples),
    }


def _parse_stamp(text: str) -> datetime | None:
    cleaned = text.replace("Z", "+00:00")
    try:
        stamp = datetime.fromisoformat(cleaned)
    except ValueError:
        return None
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    return stamp.astimezone(timezone.utc)


def _directory(codes: tuple[str, ...], start: date, days: int) -> dict[str, list[dict[str, Any]]]:
    payload = _gin_get({
        "Request": "GetDataDirectory",
        "format": "json",
        "testObsys": "0",
        "observatoryIagaCodeList": ",".join(codes),
        "samplesPerDay": "Minute",
        "publicationState": "best-avail",
        "dataStartDate": start.isoformat(),
        "dataDuration": str(days),
    })
    found: dict[str, list[dict[str, Any]]] = {}
    for row in payload.get("data") or []:
        code = str(row.get("iaga_code") or "").upper()
        if code:
            found[code] = list(row.get("days") or [])
    return found


def _fetch_day_text(code: str, day: date) -> str:
    resp = requests.get(
        GIN_URL,
        params={
            "Request": "GetData",
            "format": "IAGA2002",
            "testObsys": "0",
            "observatoryIagaCode": code,
            "samplesPerDay": "1440",
            "publicationState": "best-avail",
            "dataStartDate": day.isoformat(),
            "dataDuration": "1",
        },
        timeout=60,
    )
    resp.raise_for_status()
    return resp.text


def _unavailable(code: str) -> dict[str, Any]:
    meta = OBSERVATORIES[code]
    return {
        "code": code,
        "name": meta["name"],
        "lat": meta["lat"],
        "lon": meta["lon"],
        "status": "unavailable",
        "time": None,
        "age_minutes": None,
        "x_nt": None,
        "y_nt": None,
        "z_nt": None,
        "f_nt": None,
        "h_nt": None,
        "dhdt_nt_per_min": None,
        "max_abs_dhdt_1h": None,
        "samples": 0,
    }


def _note(rows: list[dict[str, Any]], *, today: date) -> str:
    times = [str(row["time"])[:10] for row in rows if row.get("time")]
    places = "Hermanus and Hartebeesthoek sit south of this Zimbabwe view, so their values are read out on the map."
    if not times:
        return (
            "The public INTERMAGNET feed has no finite minute for Hermanus or Hartebeesthoek "
            f"in the last {_LOOKBACK_DAYS} days. {places}"
        )
    latest = max(times)
    if latest < today.isoformat():
        return (
            f"Latest finite public minute is {latest}. Later files at the BGS GIN have no samples yet. {places}"
        )
    return f"Public INTERMAGNET minute values. {places}"


def fetch_south_africa_latest(*, now: datetime | None = None) -> dict[str, Any]:
    """Latest public minute from Hermanus (HER) and Hartebeesthoek (HBK).

    The GIN often publishes a full day of empty slots before the observatory
    file arrives. Only a finite X/Y sample is returned. Results are cached
    for ten minutes so the map does not download the same day on every poll.
    """
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    with _latest_lock:
        cached = _latest_cache.get("payload")
        age = time.monotonic() - float(_latest_cache.get("at") or 0.0)
        if cached is not None and age < _CACHE_SECONDS:
            return cached
    try:
        start = moment.date() - timedelta(days=_LOOKBACK_DAYS - 1)
        directory = _directory(SOUTH_AFRICA_CODES, start, _LOOKBACK_DAYS)
        rows: list[dict[str, Any]] = []
        for code in SOUTH_AFRICA_CODES:
            day = newest_recorded_day(directory.get(code) or [])
            if day is None:
                rows.append(_unavailable(code))
                continue
            summary = summarise_iaga2002(_fetch_day_text(code, day), now=moment)
            meta = OBSERVATORIES[code]
            if summary is None:
                rows.append(_unavailable(code))
                continue
            rows.append({
                "code": code,
                "name": meta["name"],
                "lat": meta["lat"],
                "lon": meta["lon"],
                **summary,
            })
        payload = {
            "source": "INTERMAGNET / BGS GIN",
            "source_url": "https://imag-data.bgs.ac.uk/GIN_V1/GINServices",
            "fetched_at": moment.replace(microsecond=0).isoformat().replace("+00:00", "Z"),
            "note": _note(rows, today=moment.date()),
            "observatories": rows,
            "error": None,
        }
    except Exception:
        with _latest_lock:
            cached = _latest_cache.get("payload")
            if cached is not None:
                return cached
        raise
    with _latest_lock:
        _latest_cache["at"] = time.monotonic()
        _latest_cache["payload"] = payload
    return payload


def empty_south_africa_latest(error: str) -> dict[str, Any]:
    """Map-safe payload when the GIN cannot be reached. No magnetic values are invented."""
    moment = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    return {
        "source": "INTERMAGNET / BGS GIN",
        "source_url": "https://imag-data.bgs.ac.uk/GIN_V1/GINServices",
        "fetched_at": moment,
        "note": "South African INTERMAGNET minutes could not be read from the public GIN.",
        "observatories": [_unavailable(code) for code in SOUTH_AFRICA_CODES],
        "error": error,
    }
