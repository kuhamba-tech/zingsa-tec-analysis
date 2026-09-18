"""TTL cache for the CORS_Program ionosphere/status endpoint (S4, TEC daily change).

Mirrors zgiis/live/ntrip_status_cache.py's non-blocking pattern: a page-load
read never blocks on the external HTTP call. It returns the last cached
payload (or None before the first successful fetch) immediately, and
refreshes in the background on a daemon thread when the cache goes stale.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Optional

_CACHE: dict[str, Any] | None = None
_CACHE_TS: float = 0.0
_REFRESHING = False
_LOCK = threading.Lock()
DEFAULT_TTL_SEC = 300.0


def cache_age_sec() -> Optional[float]:
    if _CACHE is None:
        return None
    return time.monotonic() - _CACHE_TS


def _refresh(station: str) -> None:
    global _CACHE, _CACHE_TS, _REFRESHING
    from zgiis.api.cors_client import fetch_ionosphere_status

    try:
        result = fetch_ionosphere_status(station=station)
        if result is not None:
            _CACHE = result
            _CACHE_TS = time.monotonic()
    finally:
        with _LOCK:
            _REFRESHING = False


def get_cached_ionosphere_status(
    *,
    station: str = "HARA",
    ttl_sec: float = DEFAULT_TTL_SEC,
) -> Optional[dict[str, Any]]:
    """Return the latest cached ionosphere/status payload, refreshing in the
    background when stale. Never blocks the calling request thread."""
    global _REFRESHING

    age = cache_age_sec()
    stale = _CACHE is None or age is None or age > ttl_sec
    if stale:
        with _LOCK:
            already_refreshing = _REFRESHING
            _REFRESHING = True
        if not already_refreshing:
            threading.Thread(
                target=_refresh,
                args=(station,),
                daemon=True,
                name="iono-status-bg",
            ).start()

    return _CACHE
