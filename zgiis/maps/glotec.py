"""Sample NOAA SWPC's operational GloTEC grid at Zimbabwe CORS sites."""

import math
from datetime import datetime, timedelta, timezone
from functools import lru_cache

import requests

from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
from zgiis.maps.dlr_global_tec import sample_bilinear

ORIGIN = "https://services.swpc.noaa.gov"
PRODUCT = "/products/glotec/geojson_2d_urt"
MAX_AGE = timedelta(minutes=90)


def _get_json(path):
    response = requests.get(ORIGIN + path, timeout=(5, 12))
    response.raise_for_status()
    return response.json()


@lru_cache(maxsize=2)
def _latest_snapshot(refresh_minute):
    now = datetime.now(timezone.utc)
    entries = _get_json(PRODUCT + ".json")
    # NOAA's index contains a rolling month of maps in chronological order.
    latest = next(
        (entry for entry in reversed(entries) if datetime.fromisoformat(entry["time_tag"]) <= now),
        None,
    )
    if latest is None or now - datetime.fromisoformat(latest["time_tag"]) > MAX_AGE:
        raise ValueError("NOAA has no recent GloTEC grid.")
    epoch = datetime.fromisoformat(latest["time_tag"])
    path = f"{PRODUCT}/glotec_icao_{epoch.strftime('%Y%m%dT%H%M%SZ')}.geojson"
    grid = _get_json(path)
    if datetime.fromisoformat(grid["time_tag"]) != epoch:
        raise ValueError("Unexpected NOAA GloTEC epoch.")
    values = {}
    for feature in grid["features"]:
        lon, lat = feature["geometry"]["coordinates"]
        tec = feature["properties"]["tec"]
        if isinstance(tec, (int, float)) and math.isfinite(tec) and tec >= 0:
            values[lat, lon] = tec
    if not values:
        raise ValueError("NOAA GloTEC grid contains no usable VTEC.")
    lats = sorted({lat for lat, _ in values})
    lons = sorted({lon for _, lon in values})
    stations = []
    for site in ZIMBABWE_CORS_STATIONS:
        tec = sample_bilinear(site.lat, site.lon, values, lats, lons)
        if tec is not None:
            stations.append({"station": site.code, "vtec_tecu": round(tec, 2)})
    return {"epoch": latest["time_tag"], "stations": stations}


def latest_glotec_by_station():
    return _latest_snapshot(int(datetime.now(timezone.utc).timestamp()) // 60)
