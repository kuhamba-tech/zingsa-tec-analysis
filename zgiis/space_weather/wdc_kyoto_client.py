"""Fetch geomagnetic indices from WDC for Geomagnetism, Kyoto (Japan).

Sources:
- Dst — hourly equatorial Dst derived at Kyoto University (final / provisional / realtime)
  https://wdc.kugi.kyoto-u.ac.jp/dstdir/
- Kp, ap, Ap — definitive planetary indices distributed via WDC Kyoto since 1997
  (derived by GFZ Potsdam; fetched from the GFZ JSON service with status=def)

Non-commercial use only per WDC Kyoto data policy.
"""
from __future__ import annotations

import re
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime
from typing import Any

try:
    import requests

    _REQUESTS_OK = True
except ImportError:
    _REQUESTS_OK = False

KYOTO_BASE = "https://wdc.kugi.kyoto-u.ac.jp"
GFZ_JSON = "https://kp.gfz.de/app/json/"
_HEADERS = {"User-Agent": "ZGIIS/1.0 (Zimbabwe space-weather archive; WDC Kyoto client)"}


def _storm_class(kp: float | None, dst: float | None, ap: float | None = None) -> str:
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
    if dst is not None and dst <= -200:
        return "Intense Dst"
    if dst is not None and dst <= -100:
        return "Moderate Dst"
    if dst is not None and dst <= -50:
        return "Weak Dst"
    if ap is not None and ap >= 50:
        return "Weak Ap"
    if kp is not None and kp >= 4:
        return "Active"
    return "Quiet"


def _is_storm_day(kp: float | None, dst: float | None, ap: float | None = None) -> bool:
    if kp is not None and kp >= 5:
        return True
    if dst is not None and dst <= -50:
        return True
    if ap is not None and ap >= 50:
        return True
    return False


def _months_in_range(start: date, end: date) -> list[tuple[int, int]]:
    if end < start:
        start, end = end, start
    months: list[tuple[int, int]] = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        months.append((y, m))
        m += 1
        if m > 12:
            m = 1
            y += 1
    return months


def _parse_dst_pre_block(text: str, year: int, month: int) -> dict[str, float]:
    """Parse Kyoto monthly Dst HTML <pre> table → daily minimum Dst (nT)."""
    match = re.search(r"<pre[^>]*>(.*?)</pre>", text, re.DOTALL | re.IGNORECASE)
    if not match:
        return {}
    block = match.group(1)
    daily_min: dict[str, float] = {}
    for line in block.splitlines():
        line = line.strip()
        if not line or line == "DAY" or line.startswith("unit=") or "WDC for" in line:
            continue
        if line[0].isalpha():
            continue
        parts = line.split()
        if len(parts) < 25:
            continue
        try:
            day = int(parts[0])
        except ValueError:
            continue
        vals: list[float] = []
        for token in parts[1:25]:
            try:
                vals.append(float(token))
            except ValueError:
                continue
        if not vals:
            continue
        key = date(year, month, day).isoformat()
        daily_min[key] = round(min(vals), 1)
    return daily_min


def _fetch_kyoto_dst_month(year: int, month: int, *, timeout: int = 45) -> dict[str, float]:
    yyyymm = f"{year:04d}{month:02d}"
    for dtype in ("dst_final", "dst_provisional", "dst_realtime"):
        url = f"{KYOTO_BASE}/{dtype}/{yyyymm}/index.html"
        try:
            resp = requests.get(url, timeout=timeout, headers=_HEADERS)
            if resp.status_code != 200:
                continue
            parsed = _parse_dst_pre_block(resp.text, year, month)
            if parsed:
                return parsed
        except Exception:
            continue
    return {}


def _fetch_gfz_def_index(index: str, start: date, end: date, *, timeout: int = 60) -> dict[str, Any]:
    params = {
        "start": f"{start.isoformat()}T00:00:00Z",
        "end": f"{end.isoformat()}T23:59:59Z",
        "index": index,
        "status": "def",
    }
    resp = requests.get(GFZ_JSON, params=params, timeout=timeout, headers=_HEADERS)
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


def fetch_kyoto_daily(start: date, end: date, *, timeout: int = 60) -> list[dict[str, Any]]:
    """Return daily WDC Kyoto indices between start and end (inclusive)."""
    if not _REQUESTS_OK:
        return []
    if end < start:
        start, end = end, start

    dst_by_day: dict[str, float] = {}
    months = _months_in_range(start, end)
    with ThreadPoolExecutor(max_workers=min(4, len(months) or 1)) as pool:
        for partial in pool.map(lambda ym: _fetch_kyoto_dst_month(ym[0], ym[1], timeout=timeout), months):
            dst_by_day.update(partial)

    with ThreadPoolExecutor(max_workers=4) as pool:
        kp_payload, ap_payload, ap_daily_payload = pool.map(
            lambda idx: _fetch_gfz_def_index(idx, start, end, timeout=timeout),
            ("Kp", "ap", "Ap"),
        )

    kp_by_day = _series_by_day(kp_payload, "Kp")
    ap3_by_day = _series_by_day(ap_payload, "ap")
    ap_daily = {
        d: vals[0]
        for d, vals in _series_by_day(ap_daily_payload, "Ap").items()
        if vals
    }

    all_days = sorted(
        set(dst_by_day)
        | set(kp_by_day)
        | set(ap3_by_day)
        | set(ap_daily)
    )
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
        dst_min = dst_by_day.get(day)
        storm_ap = ap_day if ap_day is not None else ap_mean
        rows.append(
            {
                "date": day,
                "kp": kp_max,
                "kp_mean": kp_mean,
                "ap": ap_mean,
                "ap_daily": ap_day,
                "dst": dst_min,
                "storm_flag": _is_storm_day(kp_max, dst_min, storm_ap),
                "storm_class": _storm_class(kp_max, dst_min, storm_ap),
            }
        )
    return rows


def build_analysis(
    rows: list[dict[str, Any]],
    vtec_by_date: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Summarise WDC Kyoto daily rows and optional mean-VTEC correlation."""
    vtec_by_date = vtec_by_date or {}
    storm_days = [r for r in rows if r.get("storm_flag")]
    quiet_days = [r for r in rows if not r.get("storm_flag")]

    def _mean_vtec(days: list[dict[str, Any]]) -> float | None:
        vals = [vtec_by_date[d["date"]] for d in days if d["date"] in vtec_by_date]
        return round(sum(vals) / len(vals), 2) if vals else None

    merged = [{**r, "mean_vtec": vtec_by_date.get(r["date"])} for r in rows]

    kp_vals = [r["kp"] for r in rows if r.get("kp") is not None]
    dst_vals = [r["dst"] for r in rows if r.get("dst") is not None]
    ap_vals = [r["ap_daily"] for r in rows if r.get("ap_daily") is not None]
    if not ap_vals:
        ap_vals = [r["ap"] for r in rows if r.get("ap") is not None]

    return {
        "source": (
            "WDC for Geomagnetism, Kyoto (https://wdc.kugi.kyoto-u.ac.jp/) — "
            "Dst from Kyoto; definitive Kp/ap/Ap via GFZ distribution"
        ),
        "start_date": rows[0]["date"] if rows else None,
        "end_date": rows[-1]["date"] if rows else None,
        "days": len(rows),
        "storm_days": len(storm_days),
        "max_kp": max(kp_vals) if kp_vals else None,
        "min_dst": min(dst_vals) if dst_vals else None,
        "max_ap": max(ap_vals) if ap_vals else None,
        "mean_vtec_storm": _mean_vtec(storm_days),
        "mean_vtec_quiet": _mean_vtec(quiet_days),
        "series": merged,
        "storms": [
            {
                "date": r["date"],
                "kp": r.get("kp"),
                "dst": r.get("dst"),
                "ap": r.get("ap_daily") if r.get("ap_daily") is not None else r.get("ap"),
                "storm_class": r.get("storm_class"),
                "mean_vtec": vtec_by_date.get(r["date"]),
            }
            for r in storm_days
        ],
        "fetched_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    }
