"""Station ROTI from carrier-phase STEC using Carmo et al. (2021), Method 4."""
from __future__ import annotations

import math
from collections import defaultdict, deque
from datetime import datetime, timedelta
from statistics import median, pstdev

import pandas as pd

from zgiis.cors.stations import zingsa_cors_stations

PAPER_URL = "https://doi.org/10.1029/2020RS007140"
CADENCE_S = 30
WINDOW_S = 300
FRESH_MINUTES = 15
MAX_PHASE_JUMP_TECU = 20


def _latest_satellite_roti(samples: list[tuple[datetime, float]]) -> tuple[datetime, float] | None:
    """Calculate population SD of ROT on a continuous, roughly 30-second arc."""
    rates: deque[tuple[datetime, datetime, float]] = deque()
    previous = None
    latest = None
    for stamp, phase in samples:
        if previous is not None:
            old_stamp, old_phase = previous
            elapsed = (stamp - old_stamp).total_seconds()
            change = phase - old_phase
            if not 15 <= elapsed <= 45 or abs(change) > MAX_PHASE_JUMP_TECU:
                rates.clear()
            else:
                rates.append((old_stamp, stamp, change * 60 / elapsed))
                while rates and (stamp - rates[0][0]).total_seconds() > WINDOW_S:
                    rates.popleft()
                if len(rates) >= 8 and (stamp - rates[0][0]).total_seconds() >= 225:
                    latest = (stamp, pstdev(rate for _, _, rate in rates))
        previous = (stamp, phase)
    return latest


def summarize_station_roti(rows: pd.DataFrame, now: datetime) -> list[dict]:
    """Return a station median of recent per-satellite ROTI windows."""
    if rows.empty:
        return []
    registry = {site.code.lower().rstrip("_"): site for site in zingsa_cors_stations()}
    arcs: dict[tuple[str, str], dict[int, tuple[datetime, float]]] = defaultdict(dict)
    for row in rows.itertuples(index=False):
        code = row.station.lower().rstrip("_")
        if code not in registry or not row.prn or pd.isna(row.time) or pd.isna(row.tecp_tecu) or not math.isfinite(row.tecp_tecu):
            continue
        stamp = row.time
        slot = round(stamp.timestamp() / CADENCE_S)
        arc = arcs[(code, row.prn)]
        existing = arc.get(slot)
        if existing is None or abs(stamp.timestamp() - slot * CADENCE_S) < abs(existing[0].timestamp() - slot * CADENCE_S):
            arc[slot] = (stamp, row.tecp_tecu)

    by_station = defaultdict(list)
    cutoff = now - timedelta(minutes=FRESH_MINUTES)
    for (code, _prn), arc in arcs.items():
        result = _latest_satellite_roti([arc[slot] for slot in sorted(arc)])
        if result and cutoff <= result[0] <= now:
            by_station[code].append(result)

    return [
        {
            "code": code,
            "lat": registry[code].lat,
            "lon": registry[code].lon,
            "roti": round(median(value for _, value in readings), 3),
            "satellites": len(readings),
            "observed_at": max(stamp for stamp, _ in readings).isoformat(),
        }
        for code, readings in sorted(by_station.items())
    ]
