"""NTRIP mountpoint configuration shared by FastAPI and the production collector."""

from __future__ import annotations

import os
from typing import Dict


def default_station_mountpoints() -> Dict[str, str]:
    from zgiis.cors.site_details import site_meta
    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

    return {
        station.code.lower().rstrip("_"): site_meta(station.code)["mountpoint"]
        for station in ZIMBABWE_CORS_STATIONS
    }


def parse_mountpoints(*, station_filter: set[str] | None = None) -> dict[str, str]:
    """
    Resolve station → mountpoint map from environment variables.

    Expands ZINGSA_HQ / ALL to all 24 CORS sites (same as live_manager).
    Optional station_filter limits to a subset (used by the collector script).
    """
    raw = os.getenv("NTRIP_MOUNTPOINTS", "").strip()
    if raw:
        out: dict[str, str] = {}
        for pair in raw.split(","):
            pair = pair.strip()
            if not pair or ":" not in pair:
                continue
            station, mp = pair.split(":", 1)
            out[station.strip().lower()] = mp.strip()
        if out:
            if station_filter:
                return {st: mp for st, mp in out.items() if st in station_filter}
            return out

    mountpoint = os.getenv("NTRIP_MOUNTPOINT", "").strip()
    station = os.getenv("NTRIP_STATION_CODE", "zinh").strip().lower()
    if mountpoint:
        normalized = mountpoint.lower().rstrip("_")
        if normalized in {"zingsa_hq", "zinhq", "all", "network"}:
            mapping = default_station_mountpoints()
        else:
            mapping = {station: mountpoint}
    else:
        mapping = default_station_mountpoints()

    if station_filter:
        return {st: mp for st, mp in mapping.items() if st in station_filter}
    return mapping


def order_mountpoints(
    mountpoints: dict[str, str],
    priority_codes: list[str] | None = None,
) -> dict[str, str]:
    """Return mountpoints with priority station codes first (for ingest slot ordering)."""
    if not priority_codes:
        return mountpoints
    pri = [code.lower().strip() for code in priority_codes if code.lower().strip() in mountpoints]
    rest = [code for code in mountpoints if code not in pri]
    return {code: mountpoints[code] for code in pri + rest}
