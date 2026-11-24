"""Daily planetary Ap and the running mean of completed GFZ ap intervals."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
import logging
import math

from .celestrak_client import fetch_celestrak_daily
from .gfz_kp_client import _fetch_index
from .wdc_kyoto_client import _fetch_gfz_def_index

log = logging.getLogger(__name__)


def _valid(value):
    return isinstance(value, (int, float)) and math.isfinite(value) and 0 <= value <= 400


def _daily_values(payload, start, end):
    return {
        stamp[:10]: value
        for stamp, value in zip(payload["datetime"], payload["Ap"])
        if start.isoformat() <= stamp[:10] <= end.isoformat() and _valid(value)
    }


def _completed_intervals(payload, now):
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    intervals = {}
    for stamp, value in zip(payload["datetime"], payload["ap"]):
        time = datetime.fromisoformat(stamp)
        if start <= time and time + timedelta(hours=3) <= now and _valid(value):
            intervals[time] = value
    return intervals


@lru_cache(maxsize=32)
def _snapshot(start: date, end: date, refresh_bucket: int):
    now = datetime.now(timezone.utc)
    today = now.date()
    timeout = 15
    sources = {
        "gfz": lambda: _daily_values(_fetch_index("Ap", start, end, timeout=timeout), start, end),
        "kyoto": lambda: _daily_values(_fetch_gfz_def_index("Ap", start, end, timeout=timeout), start, end),
        "celestrak": lambda: {
            row["date"]: row["ap"] for row in fetch_celestrak_daily(start, end, timeout=timeout)
            if row["date"] < today.isoformat() and not (row["data_type"] or "").startswith("PR") and _valid(row["ap"])
        },
    }
    if start <= today <= end:
        sources["gfz_live"] = lambda: _completed_intervals(_fetch_index("ap", today, today, timeout=timeout), now)

    unavailable = []
    data = {}
    with ThreadPoolExecutor(max_workers=len(sources)) as executor:
        pending = {name: executor.submit(fetch) for name, fetch in sources.items()}
        for name, future in pending.items():
            try:
                data[name] = future.result()
            except Exception as exc:
                log.warning("Planetary Ap source %s failed: %s", name, exc)
                unavailable.append(name)

    completed = data.pop("gfz_live", {})
    live = None
    if completed:
        live = {
            "date": today.isoformat(),
            "value": round(sum(completed.values()) / len(completed), 1),
            "intervals": len(completed),
        }
    return {"series": data, "live": live, "unavailable": unavailable}


def planetary_ap(start: date, end: date):
    return _snapshot(start, end, int(datetime.now(timezone.utc).timestamp()) // 120)
