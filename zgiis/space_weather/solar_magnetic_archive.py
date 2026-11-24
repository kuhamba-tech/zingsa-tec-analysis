"""Measured NOAA SOLAR-1 MAG backfill for the rolling IMF chart window."""
from __future__ import annotations

from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
import gzip
import logging
import math
from statistics import mean

from .solar1_archive import NETCDF_LOCK, cache_product_file, daily_keys, product_file

_EPOCH = datetime(1958, 1, 1, tzinfo=timezone.utc)
_FIELDS = ("imf_bt", "imf_by", "imf_bz")
log = logging.getLogger(__name__)


def _daily_bins(day: date, cache_hour: int) -> dict[str, list[tuple[datetime, float]]]:
    key = daily_keys("MAG/mag-l3", cache_hour).get(day)
    return _read_bins(day, key) if key else {}


@lru_cache(maxsize=768)
def _read_bins(day: date, key: str) -> dict[str, list[tuple[datetime, float]]]:
    from netCDF4 import Dataset

    content = product_file(key)
    with NETCDF_LOCK, Dataset("mag", memory=gzip.decompress(content)) as dataset:
        times = dataset["time_min"][:].tolist()
        vectors = dataset["b_gsm_min"][:].tolist()
    cache_product_file(key, content)

    grouped = {metric: defaultdict(list) for metric in _FIELDS}
    for clock, vector in zip(times, vectors):
        if clock is None or not math.isfinite(clock) or clock < 0 or len(vector) < 3:
            continue
        try:
            stamp = _EPOCH + timedelta(microseconds=clock)
            bx, by, bz = (float(component) for component in vector[:3])
        except (OverflowError, TypeError, ValueError):
            continue
        if stamp.date() != day or not all(math.isfinite(value) and value != -9999 for value in (bx, by, bz)):
            continue
        bucket = stamp.replace(minute=stamp.minute // 15 * 15, second=0, microsecond=0)
        grouped["imf_bt"][bucket].append(math.sqrt(bx * bx + by * by + bz * bz))
        grouped["imf_by"][bucket].append(by)
        grouped["imf_bz"][bucket].append(bz)
    return {
        metric: [(bucket, mean(samples)) for bucket, samples in bins.items()]
        for metric, bins in grouped.items()
    }


def _expected_buckets(day: date, start: datetime, stop: datetime) -> list[datetime]:
    day_start = datetime.combine(day, datetime.min.time(), tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)
    first = max(start, day_start).replace(second=0, microsecond=0)
    first -= timedelta(minutes=first.minute % 15)
    end = min(stop, day_end)
    buckets = []
    while first < end:
        if first >= start:
            buckets.append(first)
        first += timedelta(minutes=15)
    return buckets


def fill_imf_history(
    stored: dict[str, list[tuple[datetime, float]]],
    *,
    start: datetime,
    stop: datetime,
    now: datetime,
) -> None:
    """Fill missing older quarter-hours, preserving database and live samples."""
    if stop <= start:
        return
    existing = {metric: dict(stored.get(metric, [])) for metric in _FIELDS}
    days = [start.date() + timedelta(days=i) for i in range((stop.date() - start.date()).days + 1)]
    missing_days = []
    for day in days:
        buckets = _expected_buckets(day, start, stop)
        if not buckets:
            continue
        if any(sum(bucket in existing[metric] for bucket in buckets) < len(buckets) * 0.8 for metric in _FIELDS):
            missing_days.append(day)
    hour = int(now.timestamp() // 3600)

    def load(day: date) -> dict[str, list[tuple[datetime, float]]]:
        try:
            return _daily_bins(day, hour)
        except Exception as exc:
            log.warning("SOLAR-1 magnetic backfill unavailable for %s: %s", day, exc)
            return {}

    with ThreadPoolExecutor(max_workers=5) as pool:
        for day_bins in pool.map(load, missing_days):
            for metric, points in day_bins.items():
                for stamp, value in points:
                    if start <= stamp < stop:
                        existing[metric].setdefault(stamp, value)
    for metric, points in existing.items():
        if points:
            stored[metric] = sorted(points.items())
