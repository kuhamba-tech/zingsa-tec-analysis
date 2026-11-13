from __future__ import annotations

from datetime import date, datetime, timezone
from functools import lru_cache
from threading import Lock
import gzip
import io

import requests
from .source_cache import read_source, write_source

NASA_ARCHIVE = "https://spdf.gsfc.nasa.gov/pub/data/timed/guvi/levels_v10/level3/guvi_on2/data/NetCDF/"
_netcdf_lock = Lock()


SOURCE_URL = "http://guvitimed.jhuapl.edu/guvi-galleryl3on2"
MISSION_URL = "http://guvitimed.jhuapl.edu/"

REFERENCE_OVERPASSES = [
    {
        "date": "2021-11-03",
        "overpass_ut": "07:56",
        "region": "Africa",
        "ratio": None,
        "status": "metadata_only",
        "note": "TIMED/GUVI overpass metadata from Matamba and Danskin; import the Level-3 O/N2 grid to plot measured ratios.",
    },
    {
        "date": "2021-11-04",
        "overpass_ut": "07:46",
        "region": "Africa",
        "ratio": None,
        "status": "metadata_only",
        "note": "TIMED/GUVI overpass metadata from Matamba and Danskin; import the Level-3 O/N2 grid to plot measured ratios.",
    },
    {
        "date": "2021-11-05",
        "overpass_ut": "07:36",
        "region": "Africa",
        "ratio": None,
        "status": "metadata_only",
        "note": "TIMED/GUVI overpass metadata from Matamba and Danskin; import the Level-3 O/N2 grid to plot measured ratios.",
    },
]


def _parse_day(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        return None


def build_guvi_on2_payload(start: str | None = None, end: str | None = None) -> dict:
    """Return TIMED/GUVI O/N2 context for the time-series space segment.

    The repo currently has overpass metadata, not the downloaded Level-3 O/N2
    image grids. Ratio values remain null until a grid/csv importer is wired in.
    """

    start_d = _parse_day(start)
    end_d = _parse_day(end)
    rows = []
    for row in REFERENCE_OVERPASSES:
        row_d = date.fromisoformat(row["date"])
        if start_d and row_d < start_d:
            continue
        if end_d and row_d > end_d:
            continue
        rows.append(dict(row))

    return {
        "source": "TIMED/GUVI Level-3 O/N2 gallery",
        "source_url": SOURCE_URL,
        "mission_url": MISSION_URL,
        "instrument": "Thermosphere Ionosphere Mesosphere Energetics and Dynamics / Global Ultraviolet Imager",
        "altitude_range_km": [60, 180],
        "region": "Africa",
        "status": "metadata_only",
        "message": (
            "Historical TIMED/GUVI O/N2 overpass context is available. "
            "Measured O/N2 ratios require importing the downloaded Level-3 map grids."
        ),
        "series": rows,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def read_guvi_netcdf(raw: bytes, day: date) -> dict:
    """Median of valid orbit samples inside the stated Zimbabwe bounding box.

    Read the supplied geographic coordinates, never infer the coordinates of
    the provider's separate image grid. Honour each orbit's valid point count.
    """
    import numpy as np
    from netCDF4 import Dataset

    ratios, hours = [], []
    with _netcdf_lock, Dataset("guvi", memory=raw) as dataset:
        for orbit, count in enumerate(dataset.variables["points"][:]):
            n = int(count)
            lat = np.ma.filled(dataset.variables["lat"][orbit, :n], np.nan)
            lon = np.ma.filled(dataset.variables["lon"][orbit, :n], np.nan)
            lon = (lon + 180) % 360 - 180
            values = np.ma.filled(dataset.variables["on2"][orbit, :n], np.nan)
            ut = np.ma.filled(dataset.variables["ut"][orbit, :n], np.nan)
            selected = (np.isfinite(values) & (values > 0) & (lat >= -22.5) & (lat <= -15)
                        & (lon >= 25) & (lon <= 34))
            ratios.extend(values[selected].tolist())
            hours.extend(ut[selected & np.isfinite(ut) & (ut >= 0) & (ut < 24)].tolist())
    minutes = int(float(np.median(hours)) * 60) if hours else None
    return {
        "date": day.isoformat(),
        "overpass_ut": f"{minutes // 60:02d}:{minutes % 60:02d}" if minutes is not None else "",
        "region": "Zimbabwe bounding box (15–22.5°S, 25–34°E)",
        "ratio": round(float(np.median(ratios)), 4) if ratios else None,
        "status": "measured" if ratios else "no_regional_coverage",
        "note": f"{len(ratios)} valid orbit samples; median column O/N2. Not a nationwide map or altitude profile.",
    }


@lru_cache(maxsize=64)
def _fetch_nasa_day(day: date) -> dict:
    url = f"{NASA_ARCHIVE}{day.year}/ON2_{day.year}_{day.timetuple().tm_yday:03d}m.ncdf.gz"
    cached = read_source("guvi", url, max_age=86400 * 30)
    if cached is not None:
        try:
            return read_guvi_netcdf(cached, day)
        except Exception:
            pass  # Re-fetch a corrupt or incompatible cached product.
    with requests.get(url, timeout=(8, 45), stream=True) as response:
        response.raise_for_status()
        content = bytearray()
        for chunk in response.iter_content(65536):
            content.extend(chunk)
            if len(content) > 4_000_000:
                raise ValueError("GUVI compressed file exceeds the safe download limit")
    with gzip.GzipFile(fileobj=io.BytesIO(content)) as source:
        raw = source.read(16_000_001)
    if len(raw) > 16_000_000:
        raise ValueError("GUVI NetCDF file exceeds the safe extraction limit")
    row = read_guvi_netcdf(raw, day)
    write_source("guvi", url, raw)
    return row


def fetch_guvi_on2_payload(start: str | None, end: str | None) -> dict:
    payload = build_guvi_on2_payload(start, end)
    day = _parse_day(start)
    if day is None or day != _parse_day(end):
        raise ValueError("Choose one UTC day for GUVI O/N2")
    if not 2002 <= day.year <= 2007:
        payload["message"] = (
            "No measured ratios loaded for this date. The implemented NASA version-10 mirror covers 2002–2007 only. "
            "Later Level-3 products must be obtained from the GUVI provider; reference overpass metadata is not a measured grid."
        )
        return payload
    try:
        row = _fetch_nasa_day(day)
    except requests.HTTPError as exc:
        if exc.response is None or exc.response.status_code != 404:
            raise
        payload.update(series=[], status="no_data", message="NASA has no GUVI O/N2 file for the selected UTC day.")
        return payload
    payload.update(source="TIMED/GUVI Level-3 O/N2 — NASA SPDF version-10 archive",
                   source_url=NASA_ARCHIVE, series=[row], region=row["region"],
                   status=row["status"], altitude_range_km=[], message=row["note"])
    return payload
