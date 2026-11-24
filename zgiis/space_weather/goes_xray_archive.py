"""Daily NOAA NCEI operational GOES XRS one-minute flux."""

import logging
import math
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from functools import lru_cache
import requests

from .solar1_archive import NETCDF_LOCK

_ROOT = "https://data.ngdc.noaa.gov/platforms/solar-space-observing-satellites/goes"
_LOG = logging.getLogger(__name__)


def _decode_day(content: bytes, day: date) -> list[dict]:
    from netCDF4 import Dataset, num2date

    def flux(value):
        value = float(value) if not getattr(value, "mask", False) else None
        return value if value is not None and math.isfinite(value) and value > 0 else None

    # libnetcdf calls must be serialized even when the downloads run in parallel.
    with NETCDF_LOCK, Dataset("xrs.nc", memory=content) as dataset:
        time = dataset["time"]
        stamps = num2date(time[:], time.units, getattr(time, "calendar", "standard"),
                          only_use_cftime_datetimes=False)
        rows = []
        for stamp, xrsb, xrsa in zip(stamps, dataset["xrsb_flux"][:], dataset["xrsa_flux"][:]):
            if not hasattr(stamp, "strftime") or stamp.strftime("%Y-%m-%d") != day.isoformat():
                continue
            long, short = flux(xrsb), flux(xrsa)
            if long is not None or short is not None:
                rows.append({"t": stamp.strftime("%Y-%m-%dT%H:%M:%SZ"), "long": long, "short": short})
    return rows


@lru_cache(maxsize=120)
def _read_day(url: str, day: date) -> list[dict]:
    response = requests.get(url, timeout=(4, 8))
    response.raise_for_status()
    return _decode_day(response.content, day)


def _directory(satellite: int, year: int, month: int) -> dict[str, str]:
    url = f"{_ROOT}/goes{satellite}/l2/data/xrsf-l2-avg1m/{year}/{month:02d}/"
    response = requests.get(url, timeout=(4, 8))
    response.raise_for_status()
    files = re.findall(rf'href="(dn_xrsf-l2-avg1m_g{satellite}_d(\d{{8}})_v([\d-]+)\.nc)"', response.text)
    ordered = sorted(files, key=lambda entry: tuple(map(int, entry[2].split("-"))))
    return {stamp: url + filename for filename, stamp, _ in ordered}


def get_xray_archive(start: date, end: date) -> list[dict]:
    return get_goes_archive(start, end, _directory, _read_day)


def get_goes_archive(start: date, end: date, directory, read_day) -> list[dict]:
    days = [start + timedelta(days=i) for i in range((end - start).days + 1)]
    # GOES-19 replaced GOES-16 as GOES-East on 7 April 2025.
    groups = {day: (19 if day >= date(2025, 4, 7) else 16, day.year, day.month) for day in days}
    with ThreadPoolExecutor(max_workers=6) as pool:
        listings = {group: pool.submit(directory, *group) for group in set(groups.values())}
        files = {}
        for group, listing in listings.items():
            try:
                files[group] = listing.result()
            except requests.RequestException as exc:
                _LOG.warning("GOES archive listing unavailable for %s: %s", group, exc)
        downloads = {}
        for day, group in groups.items():
            if url := files.get(group, {}).get(day.strftime("%Y%m%d")):
                downloads[day] = pool.submit(read_day, url, day)
        rows = []
        for day, download in downloads.items():
            try:
                rows.extend(download.result())
            except (requests.RequestException, OSError, RuntimeError, ValueError, IndexError, KeyError) as exc:
                _LOG.warning("GOES archive day unavailable for %s: %s", day, exc)
    return rows
