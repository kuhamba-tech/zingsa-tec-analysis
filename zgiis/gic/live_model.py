"""Legacy research model interface. No satellite-derived current substitutes."""
from __future__ import annotations

import time
from typing import Any

import requests

GOES_MAG_URL = "https://services.swpc.noaa.gov/json/goes/primary/magnetometers-1-day.json"

# Effective network response, A per (nT/min). First-order literature-scale
# value for long 330/400 kV lines; refine against measured GIC once field
# data accumulates.
NETWORK_COEFF_A_PER_NT_MIN = 0.8

_cache: dict[str, Any] = {"ts": 0.0, "payload": None}
_CACHE_TTL_S = 60.0


def _fetch_goes() -> list[dict[str, Any]]:
    resp = requests.get(GOES_MAG_URL, timeout=20)
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, list):
        raise ValueError("unexpected GOES payload")
    return data


def build_live_model(hours: float = 24.0) -> dict[str, Any]:
    """Keep the research endpoint without publishing unsupported field-current estimates."""
    return {
        "available": False,
        "reason": "GOES measures the magnetic field in geostationary orbit, not local ground field. A fixed GOES-to-GIC coefficient has not been validated for Dema or Alaska.",
        "source": GOES_MAG_URL,
        "model": "Legacy fixed-coefficient GOES research model; operational use disabled",
        "disclaimer": "Retained research model interface. Local magnetometry, earth conductivity, network parameters and measured GIC validation are required.",
        "points": [], "count": 0, "latest": None,
    }
