"""Visible solar disk from SDO, with NOAA active-region numbers.

The continuum image is the NASA SDO/HMI quick-look. Region numbers, the
active-region count, and the sunspot number come from the NOAA SWPC Solar
Region Summary. A region whose central-meridian distance is 90° or more is
on the far side and is not counted or drawn.
"""

from __future__ import annotations

import math
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Any

SRS_URL = "https://services.swpc.noaa.gov/text/srs.txt"
BROWSE_ROOT = "https://sdo.gsfc.nasa.gov/assets/img/browse"
# Fallback only. The stable "latest" name lags the browse frames and browsers cache it.
DISK_IMAGE_URL = "https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIIF.jpg"
_FRAME = re.compile(r"(\d{8})_(\d{6})_1024_HMIIF\.jpg")
# Measured on the 1024×1024 SDO/HMI quick-look continuum: the orange disk
# runs from about x=32 to x=990 and y=33 to y=990.
_IMAGE_PX = 1024.0
_CENTER_PX = 511.5
_RADIUS_PX = 479.0
# Short enough that a new 15-minute SDO frame is picked up on the next refresh.
_CACHE_S = 2 * 60

_REGION = re.compile(
    r"^(?P<number>\d{4})\s+"
    r"(?P<ns>[NS])(?P<lat>\d{2})(?P<ew>[EW])(?P<cmd>\d{2})\s+"
    r"(?P<lo>\d+)\s+(?P<area>\d+)\s+(?P<zurich>\S+)\s+"
    r"(?P<extent>\d+)\s+(?P<spots>\d+)\s+(?P<mag>\S+)"
)
_ISSUED = re.compile(r":Issued:\s*(.+)", re.IGNORECASE)

_LOCK = threading.Lock()
_CACHE: dict[str, Any] = {"ts": 0.0, "payload": None}


def build_solar_disk(*, force_refresh: bool = False) -> dict[str, Any]:
    now = time.monotonic()
    with _LOCK:
        cached = _CACHE["payload"]
        if cached and not force_refresh and (now - float(_CACHE["ts"])) < _CACHE_S:
            return cached
    payload = _load()
    # Keep a miss out of the cache so the next open tries the newest frame again.
    if payload.get("image_time"):
        with _LOCK:
            _CACHE["ts"] = time.monotonic()
            _CACHE["payload"] = payload
    return payload


def parse_solar_region_summary(text: str) -> dict[str, Any]:
    """Parse the spotted-region table from an SWPC SRS bulletin."""
    issued = None
    found = _ISSUED.search(text or "")
    if found:
        issued = found.group(1).strip()
    regions: list[dict[str, Any]] = []
    in_spots = False
    for raw in (text or "").splitlines():
        line = raw.strip()
        if line.startswith("I."):
            in_spots = True
            continue
        if line.startswith("IA.") or line.startswith("II."):
            in_spots = False
            continue
        if not in_spots:
            continue
        match = _REGION.match(line)
        if not match:
            continue
        lat = float(match.group("lat"))
        if match.group("ns") == "S":
            lat = -lat
        cmd = float(match.group("cmd"))
        if match.group("ew") == "E":
            cmd = -cmd
        spots = int(match.group("spots"))
        placed = _place(lat, cmd)
        regions.append(
            {
                "number": int(match.group("number")),
                "location": f"{match.group('ns')}{match.group('lat')}{match.group('ew')}{match.group('cmd')}",
                "latitude_deg": lat,
                "central_meridian_deg": cmd,
                "area_millionths": int(match.group("area")),
                "spot_count": spots,
                "magnetic_class": match.group("mag"),
                "on_disk": placed is not None,
                "x": None if placed is None else placed[0],
                "y": None if placed is None else placed[1],
                "label_x": None if placed is None else placed[2],
                "label_y": None if placed is None else placed[3],
            }
        )
    visible = [row for row in regions if row["on_disk"]]
    spots = sum(int(row["spot_count"]) for row in visible)
    groups = len(visible)
    return {
        "issued": issued,
        "regions": regions,
        "active_region_count": groups,
        "sunspot_number": 10 * groups + spots,
    }


def _place(lat_deg: float, cmd_deg: float) -> tuple[float, float, float, float] | None:
    """Image fractions for a region. East is left and north is up."""
    lat = math.radians(lat_deg)
    cmd = math.radians(cmd_deg)
    # cos(latitude) × cos(central-meridian distance) is positive only on the
    # Earth-facing hemisphere. Past 90° the sine folds back onto the disk.
    if math.cos(lat) * math.cos(cmd) <= 0:
        return None
    east_west = math.cos(lat) * math.sin(cmd)
    north = math.sin(lat)
    center = _CENTER_PX / _IMAGE_PX
    radius = _RADIUS_PX / _IMAGE_PX
    x = center + east_west * radius
    y = center - north * radius
    reach = math.hypot(east_west, north)
    if reach > 0.62:
        push = min(1.16 / max(reach, 0.05), 1.35)
        label_x = center + east_west * radius * push
        label_y = center - north * radius * push
    else:
        label_x = x
        label_y = y - 0.045
    return (
        round(x, 4),
        round(y, 4),
        round(min(0.97, max(0.03, label_x)), 4),
        round(min(0.97, max(0.03, label_y)), 4),
    )


def newest_continuum_frame(listing: str) -> tuple[str, str] | None:
    """Newest 1024 continuum name in an SDO browse listing, plus its UTC label."""
    found = _FRAME.findall(listing or "")
    if not found:
        return None
    day, clock = max(found)
    name = f"{day}_{clock}_1024_HMIIF.jpg"
    label = f"{day[:4]}-{day[4:6]}-{day[6:8]} {clock[:2]}:{clock[2:4]} UTC"
    return name, label


def _frame_url(moment: datetime) -> str:
    stamp = moment.strftime("%Y%m%d_%H%M")
    return f"{BROWSE_ROOT}/{moment.strftime('%Y/%m/%d')}/{stamp}00_1024_HMIIF.jpg"


def _latest_image(head) -> tuple[str, str | None]:
    """Newest published 15-minute continuum. The stable latest file lags this.

    A slow reply is not treated as a missing frame. Those slots are retried
    before an older image is accepted.
    """
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    start = now.replace(minute=(now.minute // 15) * 15)
    slots = [start - timedelta(minutes=15 * step) for step in range(8)]

    def probe(moment: datetime) -> tuple[datetime, str, int]:
        url = _frame_url(moment)
        try:
            response = head(url)
            return moment, url, int(getattr(response, "status_code", 0) or 0)
        except Exception:
            return moment, url, 0

    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=len(slots)) as pool:
        results = list(pool.map(probe, slots))
    found = [row for row in results if row[2] == 200]
    best = max(found, key=lambda row: row[0]) if found else None
    pending = [row for row in results if row[2] == 0 and (best is None or row[0] > best[0])]
    for moment, url, _status in sorted(pending, key=lambda row: row[0], reverse=True):
        _moment, retried, code = probe(moment)
        if code == 200:
            return retried, moment.strftime("%Y-%m-%d %H:%M UTC")
    if best:
        return best[1], best[0].strftime("%Y-%m-%d %H:%M UTC")
    return DISK_IMAGE_URL, None


def _load() -> dict[str, Any]:
    empty = {
        "mode": "unavailable",
        "image_url": DISK_IMAGE_URL,
        "image_time": None,
        "issued": None,
        "active_region_count": None,
        "sunspot_number": None,
        "regions": [],
        "source": "NOAA SWPC Solar Region Summary and SDO/HMI continuum",
        "updated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "error": None,
    }
    try:
        import requests
    except ImportError:
        empty["error"] = "The solar-disk reader is unavailable."
        return empty
    image_url, image_time = _latest_image(
        lambda url: requests.head(url, timeout=(3.0, 8.0), allow_redirects=True)
    )
    empty["image_url"] = image_url
    empty["image_time"] = image_time
    try:
        response = requests.get(SRS_URL, timeout=(3.0, 8.0))
        response.raise_for_status()
        parsed = parse_solar_region_summary(response.text)
    except Exception:
        empty["error"] = "The NOAA solar region summary could not be read."
        return empty
    return {
        "mode": "live",
        "image_url": image_url,
        "image_time": image_time,
        "issued": parsed["issued"],
        "active_region_count": parsed["active_region_count"],
        "sunspot_number": parsed["sunspot_number"],
        "regions": [row for row in parsed["regions"] if row["on_disk"]],
        "source": "NOAA SWPC Solar Region Summary and SDO/HMI continuum",
        "updated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "error": None,
    }
