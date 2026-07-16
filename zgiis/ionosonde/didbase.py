"""Public DIDBase/IonoWeb helpers for ionosonde station metadata."""
from __future__ import annotations

from datetime import datetime, timezone
from functools import lru_cache
from typing import Any
from urllib.error import URLError
from urllib.request import urlopen
import json

DIDBASE_BASE_URL = "https://lgdc.uml.edu/ionoweb"

HERMANUS_URSI = "HE13N"
MADIMBO_URSI = "MU12K"

STATION_FALLBACKS: dict[str, dict[str, Any]] = {
    HERMANUS_URSI: {
        "code": HERMANUS_URSI,
        "name": "HERMANUS",
        "lat": -34.43,
        "lon": 19.23,
        "country": "South Africa",
    },
    MADIMBO_URSI: {
        "code": MADIMBO_URSI,
        "name": "MADIMBO",
        "lat": -22.39,
        "lon": 30.88,
        "country": "South Africa",
    },
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


def get_ionosonde_metadata(ursi_code: str) -> dict[str, Any]:
    """Return station metadata and public DIDBase ionogram availability for
    the given URSI station code (e.g. HE13N/Hermanus, MU12K/Madimbo).

    The public IonoWeb endpoint exposes station coordinates and ionogram
    availability years only. Numerical ionosonde parameters (foF2, hmF2,
    spread-F) still require a separate DIDBase/SAOExplorer data-account feed.
    """
    ursi_code = ursi_code.upper()
    fallback = STATION_FALLBACKS.get(ursi_code, {
        "code": ursi_code,
        "name": ursi_code,
        "lat": None,
        "lon": None,
        "country": "South Africa",
    })
    station = dict(fallback)
    status = "fallback"
    error = None
    try:
        for row in fetch_didbase_locations():
            if str(row.get("U", "")).upper() == ursi_code:
                station.update(
                    {
                        "code": str(row.get("U") or ursi_code),
                        "name": str(row.get("N") or fallback["name"]),
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
        years = fetch_didbase_years(ursi_code)
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
            "Numerical foF2/hmF2/spread-F comparison needs a DIDBase/SAOExplorer data-account feed."
        ),
    }
