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

from .solar1_archive import NETCDF_LOCK, cache_product_file, daily_keys, product_file

_EPOCH = datetime(1958, 1, 1, tzinfo=timezone.utc)
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


@lru_cache(maxsize=768)
def _read_bins(day: date, key: str, level: int) -> dict[str, list[tuple[datetime, float]]]:
    import numpy as np
    from netCDF4 import Dataset

    content = product_file(key)
    with NETCDF_LOCK, Dataset("swips", memory=gzip.decompress(content)) as dataset:
        if level == 3:
            times = dataset["time_utc"][:].tolist()
            values = {metric: dataset[field][:].tolist() for metric, field in _FIELDS.items()}
        else:
            # Use valid proton moments from the same sweep. L2 may only report
            # uncorrected moments during gaps in the L3 product.
            times = dataset["sweep_mid_time"][:].tolist()
            # Early operational files predate the optional quality flag.
            good = np.ma.filled(dataset["flags"][:] == 0, False) if "flags" in dataset.variables else True
            values = {}
            for metric, field in zip(_FIELDS, ("proton_v_{kind}_gse", "proton_n_{kind}", "proton_t_{kind}")):
                corrected = np.ma.filled(dataset[field.format(kind="corr")][:], np.nan)
                uncorrected = np.ma.filled(dataset[field.format(kind="uncorr")][:], np.nan)
                if metric == "solar_wind_speed":
                    corrected = np.linalg.norm(corrected, axis=1)
                    uncorrected = np.linalg.norm(uncorrected, axis=1)
                values[metric] = np.where(good, np.where(np.isfinite(corrected), corrected, uncorrected), np.nan).tolist()

    bins = _aggregate_daily_bins(day, times, values)
    cache_product_file(key, content)
    return bins


def _daily_bins(day: date, cache_hour: int) -> dict[str, list[tuple[datetime, float]]]:
    for level in (3, 2):
        try:
            key = daily_keys(f"SWIPS/swips-l{level}", cache_hour).get(day)
            if key and any((bins := _read_bins(day, key, level)).values()):
                return bins
        except Exception as exc:
            log.warning("SOLAR-1 Level %d plasma unavailable for %s: %s", level, day, exc)
    return {}


def fill_plasma_history(stored, *, start: datetime, stop: datetime, now: datetime) -> None:
    """Fill older quarter-hours only. Existing archive and live samples take precedence."""
    if stop <= start:
        return
    metrics = (*_FIELDS, _PRESSURE_METRIC)
    existing = {metric: dict(stored.get(metric, [])) for metric in metrics}
    saved_pressure = existing[_PRESSURE_METRIC].copy()
    step = timedelta(minutes=15)
    days = [start.date() + timedelta(days=i) for i in range((stop.date() - start.date()).days + 1)]
    hour = int(now.timestamp() // 3600)

    def load(day):
        try:
            return _daily_bins(day, hour)
        except Exception as exc:
            log.warning("SOLAR-1 plasma backfill unavailable for %s: %s", day, exc)
            return {}

    with ThreadPoolExecutor(max_workers=10) as pool:
        for day_bins in pool.map(load, days):
            for metric, points in day_bins.items():
                for stamp, value in points:
                    if start <= stamp < stop:
                        if metric == _PRESSURE_METRIC and stamp in saved_pressure:
                            before = saved_pressure.get(stamp - step)
                            after = saved_pressure.get(stamp + step)
                            if before is not None and after is not None:
                                low, high = min(before, value, after), max(before, value, after)
                                if low > 0 and high <= 1.5 * low and saved_pressure[stamp] > 3 * high:
                                    existing[metric][stamp] = value
                        existing[metric].setdefault(stamp, value)
    for metric, points in existing.items():
        if points:
            stored[metric] = sorted(points.items())
