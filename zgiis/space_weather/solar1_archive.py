"""Index and cache public NOAA SOLAR-1 daily products."""

from datetime import date
from functools import lru_cache
import re
from threading import Lock
from xml.etree import ElementTree

import requests

from .source_cache import read_source, write_source

BASE = "https://archive.data.noaa.gov/satellite-spaceweather/"
NETCDF_LOCK = Lock()


@lru_cache(maxsize=16)
def daily_keys(product: str, cache_hour: int) -> dict[date, str]:
    prefix = f"SWFO/SOLAR-1/{product}/"
    params = {"list-type": "2", "prefix": prefix}
    keys = {}
    while True:
        response = requests.get(BASE, params=params, timeout=(3, 10))
        response.raise_for_status()
        listing = ElementTree.fromstring(response.content)
        for node in listing.findall(".//{*}Key"):
            key = node.text or ""
            match = re.search(r"_s(\d{4})(\d{2})(\d{2})T\d{6}Z_", key)
            if key.startswith(prefix) and key.endswith("_pub.nc.gz") and match:
                day = date(*map(int, match.groups()))
                keys[day] = max(keys.get(day, ""), key)
        token = listing.findtext("{*}NextContinuationToken")
        if not token:
            return keys
        params["continuation-token"] = token


def product_file(key: str) -> bytes:
    cached = read_source("solar1", key, max_age=30 * 86400)
    if cached is not None:
        return cached
    try:
        response = requests.get(BASE + key, timeout=(3, 10))
    except (requests.ConnectionError, requests.Timeout):
        response = requests.get(BASE + key, timeout=(3, 10))
    response.raise_for_status()
    return response.content


def cache_product_file(key: str, content: bytes) -> None:
    write_source("solar1", key, content)
