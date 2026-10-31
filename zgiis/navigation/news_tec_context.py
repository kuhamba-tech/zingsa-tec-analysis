"""One short, shared station-history read for regional Navigation News."""
import logging
import threading
import time

log = logging.getLogger(__name__)
_lock = threading.Lock()
_cached = None
_checked_at = 0.0


def live_tec_context():
    global _cached, _checked_at
    with _lock:
        if _checked_at and time.monotonic() - _checked_at < 120:
            return _cached or []
        try:
            from backend.routers.live import _build_live_vtec_by_station

            _cached = _build_live_vtec_by_station(hours=1, resample_minutes=5)
        except Exception:
            log.warning("Local TEC is unavailable for Navigation News", exc_info=True)
        _checked_at = time.monotonic()
        # Consumers independently check the measurement times, including on failure.
        return _cached or []
