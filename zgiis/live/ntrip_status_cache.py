"""TTL cache for live NTRIP mountpoint probes (real caster connections, no fabricated status)."""

from __future__ import annotations

import os
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


def ntrip_probe_enabled() -> bool:
    """Direct probes are opt-in because each mountpoint consumes a caster session."""
    raw = os.getenv("ENABLE_NTRIP_PROBE", "").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _disabled_payload(listen_sec: float) -> dict[str, Any]:
    return {
        "host": None,
        "port": int(os.getenv("NTRIP_PORT", "2101")),
        "listen_sec": listen_sec,
        "probed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "stations": [],
        "summary": {
            "total": 0,
            "msm_streaming": 0,
            "rtcm_no_msm": 0,
            "connected_no_data": 0,
            "offline": 0,
        },
        "error": (
            "Direct NTRIP probing is disabled to avoid consuming additional caster sessions. "
            "Use the persistent collector for live station status."
        ),
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
    allow_blocking_refresh: bool = True,
) -> dict[str, Any]:
    """Return the latest probe payload, refreshing from the caster when stale."""
    global _CACHE, _CACHE_TS
    if not ntrip_probe_enabled():
        return _disabled_payload(listen_sec)
    age = cache_age_sec()
    stale = _CACHE is None or age is None or age > ttl_sec
    if refresh or (stale and allow_blocking_refresh):
        max_workers = max(1, int(os.getenv("NTRIP_PROBE_MAX_WORKERS", "24")))
        _CACHE = probe_all_mountpoints(listen_sec=listen_sec, max_workers=max_workers)
        _CACHE_TS = time.monotonic()
    elif stale and not allow_blocking_refresh:
        if _CACHE is not None:
            return _CACHE
        import threading

        threading.Thread(
            target=get_cached_ntrip_probe,
            kwargs={"refresh": True, "listen_sec": listen_sec, "ttl_sec": ttl_sec},
            daemon=True,
            name="ntrip-probe-bg",
        ).start()
        return _disabled_payload(listen_sec)
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
