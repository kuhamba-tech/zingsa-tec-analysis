"""Swarm Langmuir probe passes over the geoBoundaries Zimbabwe ADM0 outline."""

import csv
import json
import math
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, time, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from statistics import median

import requests

HAPI = "https://vires.services/hapi/"
NOMINAL_DENSITY_FLAGS = {10, 19, 20, 21}


def _utc(stamp: datetime) -> str:
    return stamp.isoformat().replace("+00:00", "Z")


@lru_cache(maxsize=1)
def _boundary():
    # geoBoundaries gbOpen ZWE ADM0, release 9469f09, simplified CC BY 3.0 IGO geometry.
    source = Path(__file__).with_name("zimbabwe_adm0.geojson")
    return json.loads(source.read_text(encoding="utf-8"))["features"][0]["geometry"]["coordinates"][0]


@lru_cache(maxsize=8)
def _coverage(dataset, refresh_bucket):
    response = requests.get(HAPI + "info", params={"dataset": dataset}, timeout=(5, 12))
    response.raise_for_status()
    info = response.json()
    return datetime.fromisoformat(info["startDate"]), datetime.fromisoformat(info["stopDate"])


def _samples(spacecraft, start, end, refresh_bucket):
    for product in ("OPER", "FAST"):
        dataset = f"SW_{product}_EFI{spacecraft}_LP_1B"
        first, last = _coverage(dataset, refresh_bucket)
        # VirES rejects a stop time past the product's advertised coverage.
        stop = min(end, last)
        if stop <= max(start, first):
            continue
        response = requests.get(HAPI + "data", params={
            "dataset": dataset,
            "parameters": "Latitude,Longitude,N_elec,Flags_N_elec",
            "start": _utc(max(start, first)),
            "stop": _utc(stop),
            "format": "csv",
        }, timeout=(5, 30))
        response.raise_for_status()
        if "application/json" in response.headers.get("Content-Type", ""):
            status = response.json()["status"]
            if status["code"] != 1201:
                raise ValueError(f"Unexpected VirES data response: {status['code']}")
        else:
            response.encoding = "utf-8"
            for stamp, lat, lon, density, flag in csv.reader(response.text.splitlines()):
                yield datetime.fromisoformat(stamp), float(lat), float(lon), float(density), int(flag)
        start = stop
        if start >= end:
            break


def _inside(lon, lat, ring):
    result = False
    previous_lon, previous_lat = ring[-1]
    for current_lon, current_lat in ring:
        if (current_lat > lat) != (previous_lat > lat):
            intersection = current_lon + (previous_lon - current_lon) * (
                (lat - current_lat) / (previous_lat - current_lat)
            )
            if lon < intersection:
                result = not result
        previous_lon, previous_lat = current_lon, current_lat
    return result


def _crossing(rows, ring, bounds, spacecraft, start, end):
    west, south, east, north = bounds
    segments = []
    first = last = None
    previous_index = -2
    for index, (stamp, lat, lon, _, _) in enumerate(rows):
        if west <= lon <= east and south <= lat <= north and _inside(lon, lat, ring):
            first = first or stamp
            last = stamp
            if index != previous_index + 1:
                segments.append([])
            segments[-1].append([round(lon, 4), round(lat, 4)])
            previous_index = index
    if first is None or last < start or first >= end:
        return None

    density_bins = defaultdict(list)
    for _, lat, _, density, flag in rows:
        if flag in NOMINAL_DENSITY_FLAGS and math.isfinite(density) and density > 0:
            density_bins[round(lat)].append(density)
    stride = max(1, len(rows) // 240)
    track_rows = rows[:-1:stride] + [rows[-1]]
    return {
        "spacecraft": spacecraft,
        "entry": _utc(first),
        "exit": _utc(last),
        "track": [[round(lon, 4), round(lat, 4)] for _, lat, lon, _, _ in track_rows],
        "crossing": segments,
        "density": {lat: round(median(values)) for lat, values in density_bins.items()},
    }


def _spacecraft_passes(spacecraft, start, end, ring, bounds, refresh_bucket):
    passes = []
    last_sample = None
    rows = []

    def finish_pass():
        if rows:
            crossing = _crossing(rows, ring, bounds, spacecraft, start, end)
            if crossing is not None:
                passes.append(crossing)
            rows.clear()

    padding = timedelta(hours=1)
    for row in _samples(spacecraft, start - padding, end + padding, refresh_bucket):
        stamp, lat, lon, _, _ = row
        if start <= stamp < end:
            last_sample = stamp
        if not math.isfinite(lon) or not -60 <= lat <= 60:
            finish_pass()
            continue
        if rows and (stamp - rows[-1][0]).total_seconds() > 30:
            finish_pass()
        rows.append(row)
    finish_pass()
    return passes, _utc(last_sample) if last_sample else None


@lru_cache(maxsize=32)
def _daily_passes(day, refresh_bucket):
    start = datetime.combine(day, time.min, timezone.utc)
    end = start + timedelta(days=1)
    ring = _boundary()
    lons, lats = zip(*ring)
    bounds = min(lons), min(lats), max(lons), max(lats)
    with ThreadPoolExecutor(max_workers=2) as executor:
        requests_by_spacecraft = {
            spacecraft: executor.submit(_spacecraft_passes, spacecraft, start, end, ring, bounds, refresh_bucket)
            for spacecraft in ("A", "C")
        }
        results = {spacecraft: future.result() for spacecraft, future in requests_by_spacecraft.items()}
    return {
        "boundary": [[round(lon, 5), round(lat, 5)] for lon, lat in ring],
        "passes": sorted((crossing for passes, _ in results.values() for crossing in passes), key=lambda item: item["entry"]),
        "last_sample": {spacecraft: result[1] for spacecraft, result in results.items()},
    }


def zimbabwe_passes(day: date) -> dict:
    refresh_bucket = int(datetime.now(timezone.utc).timestamp()) // 900
    return _daily_passes(day, refresh_bucket)
