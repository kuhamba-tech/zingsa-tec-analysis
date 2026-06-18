"""Fetch daily space-weather indices from CelesTrak (CSSI Space Weather Data).

Source: https://celestrak.org/SpaceData/
Format reference: https://celestrak.org/SpaceData/SpaceWx-format.php

Relevant CSV columns:
  DATE              - YYYY-MM-DD
  KP1..KP8          - eight 3-hourly Kp values, scaled x10 (e.g. 33 -> 3.3)
  AP1..AP8 / AP_AVG - eight 3-hourly Ap values and the daily mean
  ISN               - international sunspot number (SSN)
  F10.7_OBS         - observed F10.7 solar flux (SFU); falls back to F10.7_ADJ
  F10.7_DATA_TYPE   - OBS (observed), INT (interpolated), PRD/PRM (predicted)

CelesTrak does not publish Dst, so storm severity here is judged from Kp/Ap
instead (the same thresholds NOAA SWPC uses for its G-scale).
"""
from __future__ import annotations

import csv
import io
from datetime import date, datetime, timedelta
from typing import Any

try:
    import requests

    _REQUESTS_OK = True
except ImportError:
    _REQUESTS_OK = False

CELESTRAK_ALL_CSV = "https://celestrak.org/SpaceData/SW-All.csv"
CELESTRAK_LAST5Y_CSV = "https://celestrak.org/SpaceData/SW-Last5Years.csv"


def _parse_float(raw: str | None) -> float | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    try:
        return float(raw)
    except ValueError:
        return None


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


def _parse_csv(text: str, start: date, end: date) -> list[dict[str, Any]]:
    reader = csv.DictReader(io.StringIO(text))
    rows: list[dict[str, Any]] = []
    for r in reader:
        try:
            day = date.fromisoformat((r.get("DATE") or "")[:10])
        except ValueError:
            continue
        if day < start or day > end:
            continue

        kp_vals = [v / 10.0 for v in (_parse_float(r.get(f"KP{i}")) for i in range(1, 9)) if v is not None]
        kp_max = round(max(kp_vals), 1) if kp_vals else None
        kp_mean = round(sum(kp_vals) / len(kp_vals), 1) if kp_vals else None
        ap_avg = _parse_float(r.get("AP_AVG"))
        ssn = _parse_float(r.get("ISN"))
        f107 = _parse_float(r.get("F10.7_OBS"))
        if f107 is None:
            f107 = _parse_float(r.get("F10.7_ADJ"))
        data_type = (r.get("F10.7_DATA_TYPE") or "").strip()

        rows.append(
            {
                "date": day.isoformat(),
                "ssn": ssn,
                "kp": kp_max,
                "kp_mean": kp_mean,
                "ap": ap_avg,
                "f107": f107,
                "data_type": data_type or None,
                "storm_flag": _is_storm_day(kp_max, ap_avg),
                "storm_class": _storm_class(kp_max, ap_avg),
            }
        )
    rows.sort(key=lambda r: r["date"])
    return rows


def fetch_celestrak_daily(start: date, end: date, *, timeout: int = 60) -> list[dict[str, Any]]:
    """Return daily CelesTrak space-weather indices between start and end (inclusive)."""
    if not _REQUESTS_OK:
        return []
    if end < start:
        start, end = end, start

    five_years_ago = date.today() - timedelta(days=365 * 5)
    url = CELESTRAK_LAST5Y_CSV if start >= five_years_ago else CELESTRAK_ALL_CSV

    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    rows = _parse_csv(resp.text, start, end)

    if not rows and url == CELESTRAK_LAST5Y_CSV:
        # Requested range fell outside the rolling 5-year file; fall back to the full archive.
        resp = requests.get(CELESTRAK_ALL_CSV, timeout=timeout)
        resp.raise_for_status()
        rows = _parse_csv(resp.text, start, end)

    return rows


def build_analysis(
    rows: list[dict[str, Any]],
    vtec_by_date: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Summarise CelesTrak daily rows and optional mean-VTEC correlation."""
    vtec_by_date = vtec_by_date or {}
    storm_days = [r for r in rows if r.get("storm_flag")]
    quiet_days = [r for r in rows if not r.get("storm_flag")]

    def _mean_vtec(days: list[dict[str, Any]]) -> float | None:
        vals = [vtec_by_date[d["date"]] for d in days if d["date"] in vtec_by_date]
        return round(sum(vals) / len(vals), 2) if vals else None

    merged = [{**r, "mean_vtec": vtec_by_date.get(r["date"])} for r in rows]

    kp_vals = [r["kp"] for r in rows if r.get("kp") is not None]
    ap_vals = [r["ap"] for r in rows if r.get("ap") is not None]
    f107_vals = [r["f107"] for r in rows if r.get("f107") is not None]

    return {
        "source": "CelesTrak Space Weather Data (https://celestrak.org/SpaceData/)",
        "start_date": rows[0]["date"] if rows else None,
        "end_date": rows[-1]["date"] if rows else None,
        "days": len(rows),
        "storm_days": len(storm_days),
        "max_kp": max(kp_vals) if kp_vals else None,
        "max_ap": max(ap_vals) if ap_vals else None,
        "mean_f107": round(sum(f107_vals) / len(f107_vals), 1) if f107_vals else None,
        "mean_vtec_storm": _mean_vtec(storm_days),
        "mean_vtec_quiet": _mean_vtec(quiet_days),
        "series": merged,
        "storms": [
            {
                "date": r["date"],
                "kp": r.get("kp"),
                "ap": r.get("ap"),
                "f107": r.get("f107"),
                "ssn": r.get("ssn"),
                "storm_class": r.get("storm_class"),
                "mean_vtec": vtec_by_date.get(r["date"]),
            }
            for r in storm_days
        ],
        "fetched_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    }
