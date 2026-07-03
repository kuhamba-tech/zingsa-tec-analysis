"""Live modelled GIC estimate from real geomagnetic measurements.

Until the transformer-neutral field sensors stream continuously, the
dashboard's live graph is driven by a first-order plane-wave estimate:

    GIC_est(t) = K * dB/dt

where dB/dt (nT/min) is computed from the live NOAA GOES primary
magnetometer feed (1-minute cadence) and K is an effective network
response coefficient (A per nT/min) of the order found for southern
African 330/400 kV networks in the GIC modelling literature (Ngwira et
al., 2008/2009; Matandirotya et al., 2016).

This is a *model output computed from genuine observed data* — the same
category as the EKF overlay. It is clearly labelled as modelled in the
API payload and UI, and it is never stored in the measurement log. If
the upstream feed is unreachable the endpoint reports available=False
rather than inventing a series (no-demo-data policy).
"""
from __future__ import annotations

import time
from typing import Any

import requests

GOES_MAG_URL = "https://services.swpc.noaa.gov/json/goes/primary/magnetometers-1-day.json"

# Effective network response, A per (nT/min). First-order literature-scale
# value for long 330/400 kV lines; refine against measured GIC once field
# data accumulates.
NETWORK_COEFF_A_PER_NT_MIN = 0.8

_cache: dict[str, Any] = {"ts": 0.0, "payload": None}
_CACHE_TTL_S = 60.0


def _fetch_goes() -> list[dict[str, Any]]:
    resp = requests.get(GOES_MAG_URL, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, list):
        raise ValueError("unexpected GOES payload")
    return data


def build_live_model(hours: float = 24.0) -> dict[str, Any]:
    """Return the modelled GIC series (cached for 60 s)."""
    now = time.time()
    if _cache["payload"] is not None and now - _cache["ts"] < _CACHE_TTL_S:
        payload = _cache["payload"]
    else:
        try:
            raw = _fetch_goes()
        except Exception as exc:
            return {
                "available": False,
                "reason": f"GOES magnetometer feed unreachable: {exc}",
                "points": [],
            }
        payload = raw
        _cache["ts"] = now
        _cache["payload"] = raw

    # total field magnitude per minute
    series: list[tuple[str, float]] = []
    for row in payload:
        t = row.get("time_tag")
        v = row.get("total")
        if t is None or v is None:
            continue
        try:
            series.append((str(t), float(v)))
        except (TypeError, ValueError):
            continue

    if len(series) < 3:
        return {"available": False, "reason": "insufficient GOES samples", "points": []}

    series.sort(key=lambda p: p[0])
    max_points = int(hours * 60)
    series = series[-max_points:]

    points: list[dict[str, Any]] = []
    prev_t, prev_v = series[0]
    points.append({"t": prev_t, "b_total": round(prev_v, 2), "dbdt": None, "gic_est_a": None})
    for t, v in series[1:]:
        dbdt = v - prev_v  # nT per minute (1-min cadence)
        points.append({
            "t": t,
            "b_total": round(v, 2),
            "dbdt": round(dbdt, 3),
            "gic_est_a": round(NETWORK_COEFF_A_PER_NT_MIN * dbdt, 3),
        })
        prev_t, prev_v = t, v

    # 3-point centred smoothing of the estimate to suppress single-sample noise
    est = [p["gic_est_a"] for p in points]
    for i in range(1, len(points) - 1):
        vals = [v for v in (est[i - 1], est[i], est[i + 1]) if v is not None]
        if vals and est[i] is not None:
            points[i]["gic_est_a"] = round(sum(vals) / len(vals), 3)

    latest = next((p for p in reversed(points) if p["gic_est_a"] is not None), None)
    return {
        "available": True,
        "model": "GIC_est = K x dB/dt (plane-wave first-order)",
        "coefficient_a_per_nt_min": NETWORK_COEFF_A_PER_NT_MIN,
        "source": "NOAA SWPC — GOES primary magnetometer (1-min, live)",
        "disclaimer": (
            "Modelled estimate computed from live GOES magnetometer variations; "
            "replaced by measured transformer-neutral values once field sensors report."
        ),
        "latest": latest,
        "count": len(points),
        "points": points,
    }
