"""Public DIDBase/IonoWeb helpers for ionosonde station metadata."""
from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen
import json

DIDBASE_BASE_URL = "https://lgdc.uml.edu/ionoweb"
MADIMBO_URSI = "MU12K"
MADIMBO_FALLBACK = {
    "code": MADIMBO_URSI,
    "name": "MADIMBO",
    "lat": -22.39,
    "lon": 30.88,
    "country": "South Africa",
}


def _get_json(url: str, timeout: float = 4.0) -> dict[str, Any]:
    with urlopen(url, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


@lru_cache(maxsize=1)
def fetch_didbase_locations() -> list[dict[str, Any]]:
    payload = _get_json(f"{DIDBASE_BASE_URL}/locations")
    return list(payload.get("LocationList_Brief") or [])


@lru_cache(maxsize=16)
def fetch_didbase_years(ursi_code: str) -> list[int]:
    payload = _get_json(f"{DIDBASE_BASE_URL}/years4loc?ursiCode={ursi_code.upper()}")
    return [int(year) for year in payload.get("YearList") or []]


def get_madimbo_metadata() -> dict[str, Any]:
    """Return Madimbo station metadata and public DIDBase availability.

    The public IonoWeb endpoint exposes station coordinates and ionogram
    availability years. Numerical ionosonde TEC still requires a separate
    autoscaled parameter feed or manual value.
    """
    station = dict(MADIMBO_FALLBACK)
    status = "fallback"
    error = None
    try:
        for row in fetch_didbase_locations():
            if str(row.get("U", "")).upper() == MADIMBO_URSI:
                station.update(
                    {
                        "code": str(row.get("U") or MADIMBO_URSI),
                        "name": str(row.get("N") or "MADIMBO"),
                        "lat": float(row.get("Lat")),
                        "lon": float(row.get("Lon")),
                    }
                )
                status = "didbase_metadata"
                break
    except (URLError, TimeoutError, ValueError, json.JSONDecodeError, OSError) as exc:
        error = str(exc)

    years: list[int] = []
    try:
        years = fetch_didbase_years(MADIMBO_URSI)
        if status == "fallback":
            status = "didbase_years_only"
    except (URLError, TimeoutError, ValueError, json.JSONDecodeError, OSError) as exc:
        error = str(exc)

    return {
        **station,
        "source": "DIDBase/IonoWeb",
        "source_url": "https://giro.uml.edu/didbase/",
        "public_endpoint": DIDBASE_BASE_URL,
        "availability_years": years,
        "latest_available_year": max(years) if years else None,
        "has_near_realtime_public_tec": False,
        "status": status,
        "error": error,
        "checked_utc": datetime.now(timezone.utc).isoformat(),
        "note": (
            "Public IonoWeb exposes station metadata and ionogram availability. "
            "Numerical TEC comparison needs MADIMBO_IONOSONDE_TEC or a DIDBase/LGDC data-account feed."
        ),
    }
