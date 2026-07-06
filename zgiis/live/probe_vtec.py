"""Sample live VTEC from a short NTRIP probe window (real MSM decode, no placeholders)."""

from __future__ import annotations

import statistics
from datetime import datetime, timezone
from typing import Any


class ProbeVtecSampler:
    """Feed RTCM MSM messages through the live STEC/VTEC pipeline during a probe."""

    def __init__(self, station_code: str) -> None:
        from zgiis.live.satellite_geometry import LiveNavCache
        from zgiis.live.stec_vtec import LiveVtecPipeline

        self._station = station_code.lower().rstrip("_")
        self._nav = LiveNavCache()
        self._samples: list[float] = []

        def _on_vtec(vtec: dict) -> None:
            value = float(vtec.get("vtec_tecu") or 0.0)
            if value > 0:
                self._samples.append(value)

        self._pipeline = LiveVtecPipeline(nav_cache=self._nav, on_vtec=_on_vtec)

    def ingest_msg(self, msg: Any, msg_type: int, epoch: datetime | None = None) -> None:
        from zgiis.live.ntrip_stream import _ALL_MSM, _constellation_for, _extract_msm

        t_recv = epoch or datetime.now(tz=timezone.utc)

        if msg_type == 1019:
            try:
                self._nav.update_gps_ephemeris(msg)
            except Exception:
                pass
            return

        if msg_type not in _ALL_MSM:
            return

        constellation = _constellation_for(msg_type)
        try:
            records = _extract_msm(msg, msg_type, constellation, self._station, t_recv)
        except Exception:
            return
        for rec in records:
            self._pipeline.ingest(rec)

    def summary(self) -> dict[str, float | int]:
        if not self._samples:
            return {}
        return {
            "mean_vtec_tecu": round(statistics.mean(self._samples), 2),
            "max_vtec_tecu": round(max(self._samples), 2),
            "vtec_sample_count": len(self._samples),
        }
