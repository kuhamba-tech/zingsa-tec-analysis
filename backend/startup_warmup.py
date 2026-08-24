"""Background cache warmup so the first HTTP requests stay fast after uvicorn starts."""
from __future__ import annotations

import logging
import os
import threading
import time

log = logging.getLogger(__name__)

_WARMUP_STARTED = False
_WARMUP_LOCK = threading.Lock()


def _live_start_delay_sec() -> float:
    raw = os.getenv("ZGIIS_LIVE_START_DELAY_SEC", "10").strip()
    try:
        return max(0.0, float(raw))
    except ValueError:
        return 10.0


def _warm_space_weather() -> None:
    try:
        from zgiis.space_weather.fetch_indices import warm_space_weather_cache

        warm_space_weather_cache()
        log.info("Space weather cache warmed")
    except Exception:
        log.exception("Space weather warmup failed")


def _warm_spider_status() -> None:
    try:
        from zgiis.live.spider_site_status import get_cached_spider_site_statuses, spider_status_enabled

        if not spider_status_enabled():
            return
        payload = get_cached_spider_site_statuses(refresh=True)
        count = len(payload.get("by_station") or {})
        if count:
            log.info("Spider site status warmed (%d stations)", count)
        elif payload.get("error"):
            log.warning("Spider warmup: %s", payload.get("error"))
    except Exception:
        log.exception("Spider status warmup failed")


def _delayed_live_start() -> None:
    delay = _live_start_delay_sec()
    if delay > 0:
        log.info("Deferring live NTRIP ingest for %.0fs so API routes stay responsive", delay)
        time.sleep(delay)
    try:
        from backend import live_manager

        live_manager.start()
    except Exception:
        log.exception("Live pipeline start failed")


def start_background_warmup(*, include_live_ingest: bool = True) -> None:
    """Start cache warmup (and optionally delayed live ingest) exactly once."""
    global _WARMUP_STARTED
    with _WARMUP_LOCK:
        if _WARMUP_STARTED:
            return
        _WARMUP_STARTED = True

    threading.Thread(
        target=_warm_space_weather,
        daemon=True,
        name="zgiis-warm-space-weather",
    ).start()
    threading.Thread(
        target=_warm_spider_status,
        daemon=True,
        name="zgiis-warm-spider",
    ).start()
    if include_live_ingest:
        threading.Thread(
            target=_delayed_live_start,
            daemon=True,
            name="zgiis-live-pipeline-start",
        ).start()
