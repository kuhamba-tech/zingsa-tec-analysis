"""Compare archived OMNIWeb and Kyoto daily Dst minima."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
import logging

from .omniweb_client import fetch_omni_dst_daily_minimum
from .wdc_kyoto_client import fetch_kyoto_dst_hourly

log = logging.getLogger(__name__)


def _kyoto_daily_minimum(start, end):
    minima = {}
    for row in fetch_kyoto_dst_hourly(start, end, timeout=8):
        day, value = row["time"][:10], row["dst"]
        minima[day] = min(minima.get(day, value), value)
    return minima


@lru_cache(maxsize=16)
def _snapshot(start, end, refresh_bucket):
    series = {}
    unavailable = []
    with ThreadPoolExecutor(max_workers=2) as executor:
        sources = {
            "omni": executor.submit(fetch_omni_dst_daily_minimum, start, end),
            "kyoto": executor.submit(_kyoto_daily_minimum, start, end),
        }
        for name, future in sources.items():
            try:
                series[name] = future.result()
            except Exception as exc:
                log.warning("Daily Dst comparison source %s failed: %s", name, exc)
                unavailable.append(name)
    return {"series": series, "unavailable": unavailable}


def dst_comparison(start: date, end: date):
    now = datetime.now(timezone.utc)
    completed_end = min(end, now.date() - timedelta(days=1))
    if completed_end < start:
        return {"series": {}, "unavailable": []}
    return _snapshot(start, completed_end, int(now.timestamp()) // 300)
