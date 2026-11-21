"""Measured NOAA SOLAR-1 SWiPS plasma backfill for the rolling chart window."""
from __future__ import annotations

from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
import gzip
import logging
import math
from statistics import mean
import threading
from xml.etree import ElementTree

_BASE = "https://archive.data.noaa.gov/satellite-spaceweather/"
_EPOCH = datetime(1958, 1, 1, tzinfo=timezone.utc)
_NETCDF_LOCK = threading.Lock()
_FIELDS = {
    "solar_wind_speed": "speed_proton",
    "solar_wind_density": "n_proton",
    "solar_wind_temperature": "T_proton",
}
_PRESSURE_METRIC = "solar_wind_pressure"
_PROTON_DYNAMIC_PRESSURE_FACTOR = 1.6726e-6
log = logging.getLogger(__name__)


def _aggregate_daily_bins(day: date, times, values) -> dict[str, list[tuple[datetime, float]]]:
    grouped = {metric: defaultdict(list) for metric in _FIELDS}
    grouped[_PRESSURE_METRIC] = defaultdict(list)
    speed_values = values["solar_wind_speed"]
    density_values = values["solar_wind_density"]

    for index, clock in enumerate(times):
        if clock is None or not math.isfinite(clock) or clock < 0:
            continue
        try:
            stamp = _EPOCH + timedelta(microseconds=clock)
        except OverflowError:
            continue
        if stamp.date() != day:
            continue
        bucket = stamp.replace(minute=stamp.minute // 15 * 15, second=0, microsecond=0)

        speed = speed_values[index]
        density = density_values[index]
        if (speed is not None and density is not None
            and math.isfinite(speed) and speed > 0
            and math.isfinite(density) and density >= 0):
            grouped["solar_wind_speed"][bucket].append(speed)
            grouped["solar_wind_density"][bucket].append(density)
            grouped[_PRESSURE_METRIC][bucket].append(
                _PROTON_DYNAMIC_PRESSURE_FACTOR * density * speed**2
            )

        for metric, series in values.items():
            if metric in {"solar_wind_speed", "solar_wind_density"}:
                continue
            value = series[index]
            if value is not None and math.isfinite(value) and value > 0:
                grouped[metric][bucket].append(value)

    return {
        metric: [(bucket, mean(samples)) for bucket, samples in bins.items()]
        for metric, bins in grouped.items()
    }


@lru_cache(maxsize=32)
def _daily_bins(day: date, cache_hour: int) -> dict[str, list[tuple[datetime, float]]]:
    import requests
    from netCDF4 import Dataset

    prefix = f"SWFO/SOLAR-1/SWIPS/swips-l3/{day:%Y/%m}/oe_swips-l3_solar1_s{day:%Y%m%d}T"
    response = requests.get(_BASE, params={"list-type": "2", "prefix": prefix}, timeout=(3, 6))
    response.raise_for_status()
    keys = [
        node.text for node in ElementTree.fromstring(response.content).findall(".//{*}Key")
        if node.text and node.text.startswith(prefix) and node.text.endswith("_pub.nc.gz")
    ]
    if not keys:
        return {}
    response = requests.get(_BASE + max(keys), timeout=(3, 6))
    response.raise_for_status()
    with _NETCDF_LOCK, Dataset("swips", memory=gzip.decompress(response.content)) as dataset:
        times = dataset["time_utc"][:].tolist()
        values = {metric: dataset[field][:].tolist() for metric, field in _FIELDS.items()}

    return _aggregate_daily_bins(day, times, values)


def fill_plasma_history(stored, *, start: datetime, stop: datetime, now: datetime) -> None:
    """Fill older quarter-hours only. Existing archive and live samples take precedence."""
    if stop <= start:
        return
    metrics = (*_FIELDS, _PRESSURE_METRIC)
    existing = {metric: dict(stored.get(metric, [])) for metric in metrics}
    days = [start.date() + timedelta(days=i) for i in range((stop.date() - start.date()).days + 1)]
    hour = int(now.timestamp() // 3600)

    def load(day):
        try:
            return _daily_bins(day, hour)
        except Exception as exc:
            log.warning("SOLAR-1 plasma backfill unavailable for %s: %s", day, exc)
            return {}

    with ThreadPoolExecutor(max_workers=5) as pool:
        for day_bins in pool.map(load, days):
            for metric, points in day_bins.items():
                for stamp, value in points:
                    if start <= stamp < stop:
                        existing[metric].setdefault(stamp, value)
    for metric, points in existing.items():
        if points:
            stored[metric] = sorted(points.items())
