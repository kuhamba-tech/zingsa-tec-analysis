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
from datetime import date, datetime, timedelta
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

_CHUNK_DAYS = 31
_MAX_DAYS = 400


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
        "fetched_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    }
