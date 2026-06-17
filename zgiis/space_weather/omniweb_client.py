"""Fetch daily space-weather indices from NASA OMNIWeb (OMNI2).

Uses the OMNIWeb Plus CGI endpoint documented at:
https://omniweb.gsfc.nasa.gov/html/command_line_sample.html

Variable IDs (OMNI2, res=day):
  39 — Sunspot number (R)
  38 — Kp index (stored as tenths, e.g. 33 → 3.3)
  40 — Dst index (nT)
  50 — F10.7 solar flux (SFU)
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any

try:
    import requests

    _REQUESTS_OK = True
except ImportError:
    _REQUESTS_OK = False

OMNI_CGI = "https://omniweb.gsfc.nasa.gov/cgi/nx1.cgi"
_OMNI_VARS = ("39", "38", "40", "50")  # SSN, Kp, Dst, F10.7
_FILL = 999.0


def _yymmdd(d: date) -> str:
    return d.strftime("%Y%m%d")


def _parse_float(raw: str) -> float | None:
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    if val >= _FILL:
        return None
    return val


def _doy_to_date(year: int, doy: int) -> date:
    return date(year, 1, 1) + timedelta(days=doy - 1)


def _kp_scale(raw: float | None) -> float | None:
    if raw is None:
        return None
    return round(raw / 10.0, 1)


def _storm_class(kp: float | None, dst: float | None) -> str:
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
    if kp is not None and kp >= 4:
        return "Active"
    return "Quiet"


def _is_storm_day(kp: float | None, dst: float | None) -> bool:
    if kp is not None and kp >= 5:
        return True
    if dst is not None and dst <= -50:
        return True
    return False


def _parse_omni_html(text: str) -> list[dict[str, Any]]:
    """Parse OMNIWeb HTML listing into hourly rows."""
    in_data = False
    n_cols = 0
    rows: list[dict[str, Any]] = []

    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("<"):
            continue
        if line.startswith("YEAR"):
            parts = line.split()
            n_cols = max(1, len(parts) - 3)
            in_data = True
            continue
        if not in_data:
            continue
        parts = line.split()
        if len(parts) < 3 + n_cols:
            continue
        try:
            year = int(parts[0])
            doy = int(parts[1])
        except ValueError:
            continue
        day = _doy_to_date(year, doy)
        vals = [_parse_float(p) for p in parts[3 : 3 + n_cols]]
        if len(vals) < 4:
            continue
        ssn, kp_raw, dst, f107 = vals[0], vals[1], vals[2], vals[3]
        rows.append(
            {
                "date": day.isoformat(),
                "hour": int(parts[2]) if parts[2].isdigit() else 0,
                "ssn": ssn,
                "kp_raw": kp_raw,
                "kp": _kp_scale(kp_raw),
                "dst": dst,
                "f107": f107,
            }
        )
    return rows


def _aggregate_daily(hourly: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_day: dict[str, list[dict[str, Any]]] = {}
    for row in hourly:
        by_day.setdefault(row["date"], []).append(row)

    daily: list[dict[str, Any]] = []
    for day in sorted(by_day):
        chunk = by_day[day]
        ssns = [r["ssn"] for r in chunk if r["ssn"] is not None]
        kps = [r["kp"] for r in chunk if r["kp"] is not None]
        dsts = [r["dst"] for r in chunk if r["dst"] is not None]
        f107s = [r["f107"] for r in chunk if r["f107"] is not None]

        kp_max = max(kps) if kps else None
        dst_min = min(dsts) if dsts else None
        daily.append(
            {
                "date": day,
                "ssn": round(sum(ssns) / len(ssns), 1) if ssns else None,
                "kp": kp_max,
                "kp_mean": round(sum(kps) / len(kps), 1) if kps else None,
                "dst": dst_min,
                "f107": round(sum(f107s) / len(f107s), 1) if f107s else None,
                "storm_flag": _is_storm_day(kp_max, dst_min),
                "storm_class": _storm_class(kp_max, dst_min),
            }
        )
    return daily


def fetch_omni_daily(start: date, end: date, *, timeout: int = 90) -> list[dict[str, Any]]:
    """Return daily OMNI2 indices between start and end (inclusive)."""
    if not _REQUESTS_OK:
        return []
    if end < start:
        start, end = end, start
    span = (end - start).days
    if span > 366 * 3:
        raise ValueError("Date range too large (max ~3 years per request)")

    payload = {
        "activity": "retrieve",
        "res": "day",
        "spacecraft": "omni2",
        "start_date": _yymmdd(start),
        "end_date": _yymmdd(end),
        "vars": list(_OMNI_VARS),
        "scale": "Linear",
        "view": "0",
        "table": "0",
    }
    resp = requests.post(OMNI_CGI, data=payload, timeout=timeout)
    resp.raise_for_status()
    if "Error" in resp.text[:400]:
        raise RuntimeError("OMNIWeb returned an error for the requested variables or dates")
    hourly = _parse_omni_html(resp.text)
    return _aggregate_daily(hourly)


def build_analysis(
    omni_rows: list[dict[str, Any]],
    vtec_by_date: dict[str, float] | None = None,
) -> dict[str, Any]:
    """Summarise OMNI daily rows and optional mean-VTEC correlation."""
    vtec_by_date = vtec_by_date or {}
    storm_days = [r for r in omni_rows if r.get("storm_flag")]
    quiet_days = [r for r in omni_rows if not r.get("storm_flag")]

    def _mean_vtec(days: list[dict[str, Any]]) -> float | None:
        vals = [vtec_by_date[d["date"]] for d in days if d["date"] in vtec_by_date]
        return round(sum(vals) / len(vals), 2) if vals else None

    merged = []
    for row in omni_rows:
        merged.append(
            {
                **row,
                "mean_vtec": vtec_by_date.get(row["date"]),
            }
        )

    kp_vals = [r["kp"] for r in omni_rows if r.get("kp") is not None]
    dst_vals = [r["dst"] for r in omni_rows if r.get("dst") is not None]
    f107_vals = [r["f107"] for r in omni_rows if r.get("f107") is not None]

    return {
        "source": "NASA OMNIWeb OMNI2 (https://omniweb.gsfc.nasa.gov/form/dx1.html)",
        "start_date": omni_rows[0]["date"] if omni_rows else None,
        "end_date": omni_rows[-1]["date"] if omni_rows else None,
        "days": len(omni_rows),
        "storm_days": len(storm_days),
        "max_kp": max(kp_vals) if kp_vals else None,
        "min_dst": min(dst_vals) if dst_vals else None,
        "mean_f107": round(sum(f107_vals) / len(f107_vals), 1) if f107_vals else None,
        "mean_vtec_storm": _mean_vtec(storm_days),
        "mean_vtec_quiet": _mean_vtec(quiet_days),
        "series": merged,
        "storms": [
            {
                "date": r["date"],
                "kp": r.get("kp"),
                "dst": r.get("dst"),
                "f107": r.get("f107"),
                "ssn": r.get("ssn"),
                "storm_class": r.get("storm_class"),
                "mean_vtec": vtec_by_date.get(r["date"]),
            }
            for r in storm_days
        ],
        "fetched_at": datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
    }
