"""TTL cache for the NTRIP caster sourcetable diagnostic (one lightweight
discovery request, not a per-mountpoint streaming session — safe to refresh
far more often than the mountpoint probes in ntrip_status_cache.py, but still
cached so the dashboard doesn't hit the caster on every poll)."""
from __future__ import annotations

import time
from typing import Any

DEFAULT_TTL_SEC = 600.0

_CACHE: dict[str, Any] | None = None
_CACHE_TS: float = 0.0


def get_cached_sourcetable_diagnostics(
    mountpoints: dict[str, str],
    *,
    refresh: bool = False,
    ttl_sec: float = DEFAULT_TTL_SEC,
) -> dict[str, Any]:
    global _CACHE, _CACHE_TS
    now = time.monotonic()
    stale = _CACHE is None or (now - _CACHE_TS) > ttl_sec
    if refresh or stale:
        from zgiis.live.ntrip_sourcetable import fetch_sourcetable_diagnostics

        result = fetch_sourcetable_diagnostics(mountpoints)
        if result.get("by_station") or _CACHE is None:
            _CACHE = result
            _CACHE_TS = now
    return _CACHE or {"fetched_at": None, "by_station": {}, "error": "not fetched yet"}
