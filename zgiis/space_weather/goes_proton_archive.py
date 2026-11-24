"""NOAA NCEI SGPS five-minute integral >500 MeV proton measurements."""

import math
import re
from datetime import date
from functools import lru_cache

import requests

from .goes_xray_archive import _ROOT, get_goes_archive
from .solar1_archive import NETCDF_LOCK
from .source_cache import read_source, write_source


def _directory(satellite: int, year: int, month: int) -> dict[str, str]:
    url = f"{_ROOT}/goes{satellite}/l2/data/sgps-l2-avg5m/{year}/{month:02d}/"
    response = requests.get(url, timeout=(4, 8))
    response.raise_for_status()
    files = re.findall(rf'href="(sci_sgps-l2-avg5m_g{satellite}_d(\d{{8}})_v([\d-]+)\.nc)"', response.text)
    ordered = sorted(files, key=lambda entry: tuple(map(int, entry[2].split("-"))))
    return {stamp: url + filename for filename, stamp, _ in ordered}


@lru_cache(maxsize=200)
def _read_day(url: str, day: date) -> list[dict]:
    from netCDF4 import Dataset, num2date

    content = read_source("goes-sgps", url, max_age=30 * 86400)
    if content is None:
        response = requests.get(url, timeout=(4, 10))
        response.raise_for_status()
        content = response.content
    rows = []
    with NETCDF_LOCK, Dataset("sgps.nc", memory=content) as dataset:
        time = dataset["time"]
        stamps = num2date(time[:], time.units, only_use_cftime_datetimes=False)
        # NCEI publishes two telescope views. Keep +X as a consistent,
        # separately labelled series across the requested window.
        fluxes = dataset["AvgIntProtonFlux"][:, 1].tolist()
        for stamp, flux in zip(stamps, fluxes):
            if (hasattr(stamp, "strftime") and stamp.strftime("%Y-%m-%d") == day.isoformat()
                    and flux is not None and math.isfinite(flux) and flux >= 0):
                rows.append({"t": stamp.strftime("%Y-%m-%dT%H:%M:%SZ"), "flux": flux})
    write_source("goes-sgps", url, content)
    return rows


def get_proton_archive(start: date, end: date) -> list[dict]:
    return get_goes_archive(start, end, _directory, _read_day)
