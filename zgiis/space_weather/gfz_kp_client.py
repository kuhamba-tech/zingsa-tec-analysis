"""Fetch geomagnetic indices from GFZ Potsdam Kp index service.

Primary sources (Matzka et al. 2021, CC BY 4.0 except SN):
  https://kp.gfz.de/app/files/Kp_ap_Ap_SN_F107_since_1932.txt
  https://kp.gfz.de/app/files/Kp_ap_Ap_SN_F107_nowcast.txt

JSON API kept as fallback: https://kp.gfz.de/app/json/?start=...&end=...&index=Kp
"""
from __future__ import annotations

import logging
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from typing import Any

try:
    import requests

    _REQUESTS_OK = True
except ImportError:
    _REQUESTS_OK = False

log = logging.getLogger(__name__)

GFZ_JSON = "https://kp.gfz.de/app/json/"
GFZ_TXT_SINCE_1932 = "https://kp.gfz.de/app/files/Kp_ap_Ap_SN_F107_since_1932.txt"
GFZ_TXT_NOWCAST = "https://kp.gfz.de/app/files/Kp_ap_Ap_SN_F107_nowcast.txt"

# Refresh TXT caches periodically — historical file is ~5 MB.
_TXT_CACHE_TTL_S = 6 * 3600.0
_txt_lock = threading.Lock()
_txt_cache: dict[str, tuple[float, dict[str, dict[str, Any]]]] = {}


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


def _valid_kp(v: float) -> bool:
    return v > -0.5  # file uses -1.000 for missing


def _valid_int_index(v: float) -> bool:
    return v >= 0  # -1 missing for ap / SN


def _valid_f107(v: float) -> bool:
    return v > 0  # -1.0 missing


def parse_gfz_kp_txt(text: str) -> dict[str, dict[str, Any]]:
    """Parse GFZ Kp_ap_Ap_SN_F107 ASCII into {YYYY-MM-DD: row}.

    Header lines start with #. Data columns (blank-separated):
    YYYY MM DD days days_m Bsr dB Kp1..Kp8 ap1..ap8 Ap SN F10.7obs F10.7adj D
    """
    out: dict[str, dict[str, Any]] = {}
    for raw in text.splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        parts = line.split()
        if len(parts) < 28:
            continue
        try:
            yyyy, mm, dd = int(parts[0]), int(parts[1]), int(parts[2])
            day = date(yyyy, mm, dd).isoformat()
            kps = [float(parts[7 + i]) for i in range(8)]
            aps = [float(parts[15 + i]) for i in range(8)]
            ap_day = float(parts[23])
            sn = float(parts[24])
            f107_obs = float(parts[25])
            f107_adj = float(parts[26])
            definitive = int(float(parts[27]))
        except (TypeError, ValueError):
            continue

        kp_ok = [k for k in kps if _valid_kp(k)]
        ap_ok = [a for a in aps if _valid_int_index(a)]
        kp_max = round(max(kp_ok), 1) if kp_ok else None
        kp_mean = round(sum(kp_ok) / len(kp_ok), 1) if kp_ok else None
        ap_mean = round(sum(ap_ok) / len(ap_ok), 1) if ap_ok else None
        ap_daily = round(ap_day, 1) if _valid_int_index(ap_day) else None
        sn_i = int(sn) if _valid_int_index(sn) else None
        f_obs = round(f107_obs, 1) if _valid_f107(f107_obs) else None
        f_adj = round(f107_adj, 1) if _valid_f107(f107_adj) else None
        storm_ap = ap_daily if ap_daily is not None else ap_mean

        out[day] = {
            "date": day,
            "kp": kp_max,
            "kp_mean": kp_mean,
            "kp_3h": [round(k, 3) if _valid_kp(k) else None for k in kps],
            "ap": ap_mean,
            "ap_daily": ap_daily,
            "cp": None,  # not in TXT product; JSON fallback may fill
            "sn": sn_i,
            "f107": f_obs,
            "f107_adj": f_adj,
            "definitive": definitive,
            "storm_flag": _is_storm_day(kp_max, storm_ap),
            "storm_class": _storm_class(kp_max, storm_ap),
        }
    return out


def _download_txt(url: str, *, timeout: int = 90) -> str:
    if not _REQUESTS_OK:
        raise RuntimeError("requests is not installed")
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.text


def _cached_txt_rows(url: str, *, timeout: int = 90) -> dict[str, dict[str, Any]]:
    now = time.time()
    with _txt_lock:
        hit = _txt_cache.get(url)
        if hit and (now - hit[0]) < _TXT_CACHE_TTL_S:
            return hit[1]
    text = _download_txt(url, timeout=timeout)
    rows = parse_gfz_kp_txt(text)
    with _txt_lock:
        _txt_cache[url] = (time.time(), rows)
    return rows


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


def _fetch_gfz_daily_json(start: date, end: date, *, timeout: int = 60) -> list[dict[str, Any]]:
    """Legacy JSON API path (Kp/ap/Ap/Cp only)."""
    if not _REQUESTS_OK:
        return []
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
                "sn": None,
                "f107": None,
                "f107_adj": None,
                "definitive": None,
                "storm_flag": _is_storm_day(kp_max, storm_ap),
                "storm_class": _storm_class(kp_max, storm_ap),
            }
        )
    return rows


def _fetch_gfz_daily_txt(start: date, end: date, *, timeout: int = 90) -> list[dict[str, Any]]:
    """Load since-1932 + nowcast TXT files and slice to [start, end]."""
    if end < start:
        start, end = end, start

    # Recent windows: nowcast alone (~30 days) is enough and much cheaper.
    today = datetime.now(timezone.utc).date()
    nowcast_only = start >= (today - timedelta(days=40))

    merged: dict[str, dict[str, Any]] = {}
    if not nowcast_only:
        try:
            merged.update(_cached_txt_rows(GFZ_TXT_SINCE_1932, timeout=timeout))
        except Exception as exc:
            log.warning("GFZ since-1932 TXT fetch failed: %s", exc)
    try:
        # Nowcast overrides overlapping days (preliminary / latest values).
        merged.update(_cached_txt_rows(GFZ_TXT_NOWCAST, timeout=min(60, timeout)))
    except Exception as exc:
        log.warning("GFZ nowcast TXT fetch failed: %s", exc)
        if not merged:
            raise

    start_s, end_s = start.isoformat(), end.isoformat()
    return [merged[d] for d in sorted(merged) if start_s <= d <= end_s]


def fetch_gfz_daily(start: date, end: date, *, timeout: int = 90) -> list[dict[str, Any]]:
    """Return daily GFZ Kp/ap/Ap (+ SN, F10.7 from TXT) between start and end."""
    return list(_fetch_gfz_daily_cached(start, end, timeout))


@lru_cache(maxsize=32)
def _fetch_gfz_daily_cached(start: date, end: date, timeout: int) -> tuple[dict[str, Any], ...]:
    """Cached GFZ daily rows (immutable tuple for lru_cache)."""
    if not _REQUESTS_OK:
        return ()
    try:
        rows = _fetch_gfz_daily_txt(start, end, timeout=timeout)
        if rows:
            return tuple(rows)
    except Exception as exc:
        log.warning("GFZ TXT path failed, falling back to JSON API: %s", exc)
    return tuple(_fetch_gfz_daily_json(start, end, timeout=min(60, timeout)))


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
    sn_vals = [r["sn"] for r in rows if r.get("sn") is not None]
    f107_vals = [r["f107"] for r in rows if r.get("f107") is not None]
    used_txt = any(r.get("sn") is not None or r.get("f107") is not None for r in rows)

    return {
        "source": (
            "GFZ Potsdam Kp_ap_Ap_SN_F107 TXT "
            f"({GFZ_TXT_SINCE_1932} · {GFZ_TXT_NOWCAST})"
            if used_txt
            else "GFZ Potsdam Kp index JSON API (https://kp.gfz.de/en/data)"
        ),
        "files": (
            [GFZ_TXT_SINCE_1932, GFZ_TXT_NOWCAST]
            if used_txt
            else [GFZ_JSON]
        ),
        "start_date": rows[0]["date"] if rows else None,
        "end_date": rows[-1]["date"] if rows else None,
        "days": len(rows),
        "storm_days": len(storm_days),
        "max_kp": max(kp_vals) if kp_vals else None,
        "max_ap": max(ap_vals) if ap_vals else None,
        "mean_cp": round(sum(cp_vals) / len(cp_vals), 2) if cp_vals else None,
        "max_sn": max(sn_vals) if sn_vals else None,
        "max_f107": max(f107_vals) if f107_vals else None,
        "mean_vtec_storm": _mean_vtec(storm_days),
        "mean_vtec_quiet": _mean_vtec(quiet_days),
        "series": merged,
        "storms": [
            {
                "date": r["date"],
                "kp": r.get("kp"),
                "ap": r.get("ap_daily") if r.get("ap_daily") is not None else r.get("ap"),
                "cp": r.get("cp"),
                "sn": r.get("sn"),
                "f107": r.get("f107"),
                "storm_class": r.get("storm_class"),
                "mean_vtec": vtec_by_date.get(r["date"]),
            }
            for r in storm_days
        ],
        "fetched_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    }
