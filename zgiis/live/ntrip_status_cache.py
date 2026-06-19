"""TTL cache for live NTRIP mountpoint probes (real caster connections, no fabricated status)."""

from __future__ import annotations

import time
from typing import Any

from zgiis.live.ntrip_probe import probe_all_mountpoints

_CACHE: dict[str, Any] | None = None
_CACHE_TS: float = 0.0
DEFAULT_TTL_SEC = 120.0

VERDICT_TO_STATUS: dict[str, str] = {
    "msm_streaming": "online",
    "rtcm_no_msm": "degraded",
    "connected_no_data": "degraded",
    "offline": "offline",
}


def verdict_map_status(verdict: str | None) -> str:
    return VERDICT_TO_STATUS.get((verdict or "").lower(), "offline")


def verdict_site_label(verdict: str | None) -> str:
    v = (verdict or "").lower()
    if v == "msm_streaming":
        return "NTRIP live — MSM observations"
    if v == "rtcm_no_msm":
        return "NTRIP connected — no MSM (RTCM only)"
    if v == "connected_no_data":
        return "NTRIP connected — no RTCM in probe window"
    if v == "offline":
        return "NTRIP offline"
    return "NTRIP status unknown"


def cache_age_sec() -> float | None:
    if _CACHE is None:
        return None
    return time.monotonic() - _CACHE_TS


def get_cached_ntrip_probe(
    *,
    refresh: bool = False,
    listen_sec: float = 4.0,
    ttl_sec: float = DEFAULT_TTL_SEC,
) -> dict[str, Any]:
    """Return the latest probe payload, refreshing from the caster when stale."""
    global _CACHE, _CACHE_TS
    age = cache_age_sec()
    stale = _CACHE is None or age is None or age > ttl_sec
    if refresh or stale:
        _CACHE = probe_all_mountpoints(listen_sec=listen_sec)
        _CACHE_TS = time.monotonic()
    return _CACHE  # type: ignore[return-value]


def probe_rows_by_station(probe_payload: dict[str, Any] | None) -> dict[str, dict[str, Any]]:
    if not probe_payload:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for row in probe_payload.get("stations") or []:
        code = str(row.get("station", "")).lower()
        if code:
            out[code] = row
    return out
