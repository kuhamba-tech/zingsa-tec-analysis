"""Fetch geomagnetic indices from GFZ Potsdam Kp index service.

Source: https://kp.gfz.de/en/data
JSON API: https://kp.gfz.de/app/json/?start=...&end=...&index=Kp

Kp and ap are published at 3-hour cadence; Ap and Cp are daily.
"""
from __future__ import annotations

from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from functools import lru_cache
from typing import Any

try:
    import requests

    _REQUESTS_OK = True
except ImportError:
    _REQUESTS_OK = False

GFZ_JSON = "https://kp.gfz.de/app/json/"


def _storm_class(kp: float | None, ap: float | None) -> str:
    if kp is not None and kp >= 9:
        return "G5 Extreme"
    if kp is not None and kp >= 8:
        return "G4 Severe"
    if kp is not None and kp >= 7:
        return "G3 Strong"
    if kp is not None and kp >= 6:
        return "G2 Moderate"
    if kp is not None and kp >= 5:
        return "G1 Minor"
    if ap is not None and ap >= 200:
        return "Intense Ap"
    if ap is not None and ap >= 100:
        return "Moderate Ap"
    if ap is not None and ap >= 50:
        return "Weak Ap"
    if kp is not None and kp >= 4:
        return "Active"
    return "Quiet"


def _is_storm_day(kp: float | None, ap: float | None) -> bool:
    if kp is not None and kp >= 5:
        return True
    if ap is not None and ap >= 50:
        return True
    return False


def _fetch_index(index: str, start: date, end: date, *, timeout: int = 60) -> dict[str, Any]:
    params = {
        "start": f"{start.isoformat()}T00:00:00Z",
        "end": f"{end.isoformat()}T23:59:59Z",
        "index": index,
    }
    resp = requests.get(GFZ_JSON, params=params, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def _series_by_day(payload: dict[str, Any], index: str) -> dict[str, list[float]]:
    times = payload.get("datetime") or []
    values = payload.get(index) or []
    by_day: dict[str, list[float]] = defaultdict(list)
    for i, t in enumerate(times):
        if i >= len(values):
            break
        v = values[i]
        if v is None:
            continue
        try:
            by_day[str(t)[:10]].append(float(v))
        except (TypeError, ValueError):
            continue
    return by_day


def fetch_gfz_daily(start: date, end: date, *, timeout: int = 60) -> list[dict[str, Any]]:
    """Return daily GFZ Kp/ap/Ap/Cp between start and end (inclusive)."""
    return list(_fetch_gfz_daily_cached(start, end, timeout))


@lru_cache(maxsize=32)
def _fetch_gfz_daily_cached(start: date, end: date, timeout: int) -> tuple[dict[str, Any], ...]:
    """Cached GFZ daily rows (immutable tuple for lru_cache)."""
    if not _REQUESTS_OK:
        return ()
    if end < start:
        start, end = end, start

    with ThreadPoolExecutor(max_workers=4) as pool:
        kp_payload, ap_payload, ap_daily_payload, cp_payload = pool.map(
            lambda index: _fetch_index(index, start, end, timeout=timeout),
            ("Kp", "ap", "Ap", "Cp"),
        )

    kp_by_day = _series_by_day(kp_payload, "Kp")
    ap3_by_day = _series_by_day(ap_payload, "ap")
    ap_daily = {d: vals[0] for d, vals in _series_by_day(ap_daily_payload, "Ap").items() if vals}
    cp_daily = {d: vals[0] for d, vals in _series_by_day(cp_payload, "Cp").items() if vals}

    all_days = sorted(set(kp_by_day) | set(ap3_by_day) | set(ap_daily) | set(cp_daily))
    rows: list[dict[str, Any]] = []
    for day in all_days:
        if day < start.isoformat() or day > end.isoformat():
            continue
        kp_vals = kp_by_day.get(day, [])
        ap3_vals = ap3_by_day.get(day, [])
        kp_max = round(max(kp_vals), 1) if kp_vals else None
        kp_mean = round(sum(kp_vals) / len(kp_vals), 1) if kp_vals else None
        ap_mean = round(sum(ap3_vals) / len(ap3_vals), 1) if ap3_vals else None
        ap_day = ap_daily.get(day)
        if ap_day is not None:
            ap_day = round(float(ap_day), 1)
        cp = cp_daily.get(day)
        if cp is not None:
            cp = round(float(cp), 2)

        storm_ap = ap_day if ap_day is not None else ap_mean
        rows.append(
            {
                "date": day,
                "kp": kp_max,
                "kp_mean": kp_mean,
                "ap": ap_mean,
                "ap_daily": ap_day,
                "cp": cp,
                "storm_flag": _is_storm_day(kp_max, storm_ap),
                "storm_class": _storm_class(kp_max, storm_ap),
            }
        )
    return tuple(rows)


def build_analysis(
    rows: list[dict[str, Any]],
    vtec_by_date: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Summarise GFZ daily rows and optional mean-VTEC correlation."""
    vtec_by_date = vtec_by_date or {}
    storm_days = [r for r in rows if r.get("storm_flag")]
    quiet_days = [r for r in rows if not r.get("storm_flag")]

    def _mean_vtec(days: list[dict[str, Any]]) -> float | None:
        vals = [vtec_by_date[d["date"]] for d in days if d["date"] in vtec_by_date]
        return round(sum(vals) / len(vals), 2) if vals else None

    merged = [{**r, "mean_vtec": vtec_by_date.get(r["date"])} for r in rows]

    kp_vals = [r["kp"] for r in rows if r.get("kp") is not None]
    ap_vals = [r["ap_daily"] for r in rows if r.get("ap_daily") is not None]
    if not ap_vals:
        ap_vals = [r["ap"] for r in rows if r.get("ap") is not None]
    cp_vals = [r["cp"] for r in rows if r.get("cp") is not None]

    return {
        "source": "GFZ Potsdam Kp index (https://kp.gfz.de/en/data)",
        "start_date": rows[0]["date"] if rows else None,
        "end_date": rows[-1]["date"] if rows else None,
        "days": len(rows),
        "storm_days": len(storm_days),
        "max_kp": max(kp_vals) if kp_vals else None,
        "max_ap": max(ap_vals) if ap_vals else None,
        "mean_cp": round(sum(cp_vals) / len(cp_vals), 2) if cp_vals else None,
        "mean_vtec_storm": _mean_vtec(storm_days),
        "mean_vtec_quiet": _mean_vtec(quiet_days),
        "series": merged,
        "storms": [
            {
                "date": r["date"],
                "kp": r.get("kp"),
                "ap": r.get("ap_daily") if r.get("ap_daily") is not None else r.get("ap"),
                "cp": r.get("cp"),
                "storm_class": r.get("storm_class"),
                "mean_vtec": vtec_by_date.get(r["date"]),
            }
            for r in storm_days
        ],
        "fetched_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    }
