"""
RTK stream quality monitor.
Tracks latency, message rate, and correction quality per CORS station/mountpoint.
"""
from __future__ import annotations

import statistics
from collections import defaultdict, deque
from datetime import datetime, timezone, timedelta
from typing import Optional


class RTKMonitor:
    """
    Tracks RTK correction quality metrics for each CORS station.
    Thread-safe: all mutations go through a deque with maxlen.
    """

    def __init__(self, window: int = 120):
        self._window = window
        # latency_ms samples per station
        self._lat: dict[str, deque[float]]    = defaultdict(lambda: deque(maxlen=window))
        # epoch timestamps per station (for rate calculation)
        self._times: dict[str, deque[datetime]] = defaultdict(lambda: deque(maxlen=window))
        # cumulative counts
        self._total: dict[str, int] = defaultdict(int)
        self._last: dict[str, datetime] = {}

    def record(self, station: str, latency_ms: float) -> None:
        now = datetime.now(tz=timezone.utc)
        self._lat[station].append(latency_ms)
        self._times[station].append(now)
        self._total[station] += 1
        self._last[station] = now

    def latency(self, station: str) -> dict:
        buf = list(self._lat[station])
        if not buf:
            return {"mean_ms": None, "max_ms": None, "p95_ms": None}
        sorted_buf = sorted(buf)
        p95 = sorted_buf[max(0, int(len(sorted_buf) * 0.95) - 1)]
        return {
            "mean_ms": round(statistics.mean(buf), 1),
            "max_ms":  round(max(buf), 1),
            "p95_ms":  round(p95, 1),
        }

    def msg_rate(self, station: str) -> float:
        """Messages per second over the recorded window."""
        times = list(self._times[station])
        if len(times) < 2:
            return 0.0
        span = (times[-1] - times[0]).total_seconds()
        return round(len(times) / max(span, 1.0), 2)

    def is_stale(self, station: str, stale_after_s: float = 60.0) -> bool:
        last = self._last.get(station)
        if last is None:
            return True
        return (datetime.now(tz=timezone.utc) - last).total_seconds() > stale_after_s

    def quality_label(self, station: str) -> str:
        if self.is_stale(station):
            return "Offline"
        rate = self.msg_rate(station)
        if rate >= 0.8:
            return "Good"
        if rate >= 0.3:
            return "Degraded"
        return "Poor"

    def summary(self) -> dict[str, dict]:
        stations = sorted(set(self._lat) | set(self._times))
        return {
            s: {
                **self.latency(s),
                "msg_rate_hz":        self.msg_rate(s),
                "total_corrections":  self._total[s],
                "quality":            self.quality_label(s),
                "last_update":        self._last.get(s),
            }
            for s in stations
        }

    def overall_quality(self) -> str:
        """Aggregate quality across all stations."""
        if not self._lat:
            return "No data"
        labels = [self.quality_label(s) for s in self._lat]
        if all(l == "Good" for l in labels):
            return "Good"
        if any(l == "Good" for l in labels):
            return "Degraded"
        return "Poor"
