"""Read archived vertical TEC from NASA JPL's daily JPLD products."""

import gzip
import re
from datetime import date, datetime, timedelta, timezone
from functools import lru_cache
from threading import Lock

import numpy as np
import requests

ARCHIVE = "https://sideshow.jpl.nasa.gov/pub/iono_daily/gim_for_research/jpld/"
_NETCDF_LOCK = Lock()


@lru_cache(maxsize=4)
def latest_day(today: date) -> date:
    for year in (today.year, today.year - 1):
        response = requests.get(f"{ARCHIVE}{year}/", timeout=(5, 15))
        if response.status_code == 404:
            continue
        response.raise_for_status()
        days = re.findall(rf'href="jpld(\d{{3}})0\.{year % 100:02d}i\.nc\.gz"', response.text)
        if days:
            return date(year, 1, 1) + timedelta(days=int(max(days)) - 1)
    raise FileNotFoundError("No recent maps found in the JPLD archive.")


@lru_cache(maxsize=2)
def _daily_file(day: date) -> bytes:
    name = f"jpld{day.timetuple().tm_yday:03d}0.{day.year % 100:02d}i.nc.gz"
    response = requests.get(f"{ARCHIVE}{day.year}/{name}", timeout=(5, 25))
    if response.status_code == 404:
        raise FileNotFoundError(f"JPLD has no map for {day.isoformat()}.")
    response.raise_for_status()
    return gzip.decompress(response.content)


def read_grid(contents: bytes, utc_time: str | None) -> dict:
    from netCDF4 import Dataset

    with _NETCDF_LOCK, Dataset("jpld.nc", memory=contents) as dataset:
        epochs = [
            datetime.strptime(str(value), "%Y/%m/%d_%H:%M:%S")
            for value in dataset["varepochs"][:]
        ]
        times = [epoch.strftime("%H:%M") for epoch in epochs]
        if utc_time is not None and utc_time not in times:
            raise FileNotFoundError("JPLD has no map for the selected UTC time.")
        index = times.index(utc_time) if utc_time is not None else len(times) - 1
        lat = dataset["lat"][:]
        lon = dataset["lon"][:]
        tec = np.ma.asarray(dataset["tecmap"][index], dtype=float)
        flags = np.ma.asarray(dataset["tecflag"][index])
        values = np.where((flags == 0).filled(False), tec.filled(np.nan), np.nan)
        # Keep raster rows north to south and columns west to east.
        values = values[np.argsort(lat)[::-1]][:, np.argsort(lon)]
        height, width = values.shape
    return {
        "observed_utc": epochs[index].isoformat() + "Z",
        "times": times,
        "width": width,
        "height": height,
        "values": [round(float(value), 2) if np.isfinite(value) else None for value in values.flat],
    }


def global_grid(day: date | None, utc_time: str | None) -> dict:
    day = day or latest_day(datetime.now(timezone.utc).date())
    return read_grid(_daily_file(day), utc_time)
