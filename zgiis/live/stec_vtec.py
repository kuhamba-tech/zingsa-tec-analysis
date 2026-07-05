"""
Real-time STEC → VTEC pipeline.

Pairs L1/L2 carrier-phase observations (from RTCM MSM) per satellite per
station and applies the same equations from Gopi (tec_core.py):
  - STEC = K × (L1_m − L2_m)          Book Eq 4.12
  - S(E) = 1/sqrt(1 − (Re cosE / (Re+H))²)   Book Eq 4.17
  - VTEC = STEC / S(E)
"""
from __future__ import annotations

import math
import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

log = logging.getLogger(__name__)

_C_LIGHT    = 2.99792458e8   # m/s
_RE_KM      = 6378.0         # Earth radius (Gopi p.76)
_IPP_KM     = 350.0          # Ionospheric Pierce Point height (default)
_ELEV_MASK  = 25.0           # Elevation mask (degrees)

# Pair timeout: if we don't see a second signal within this many seconds,
# discard the buffered first signal to avoid stale pairings.
_PAIR_TIMEOUT_S = 2.0


def _k_factor(f1: float, f2: float) -> float:
    """TEC conversion constant K — Gopi Book Eq 4.7. Matches tec_core.py's
    `_K`; the electrons/m² → TECU scaling (/1e16) is applied separately at
    the point of use, not baked in here (see stec_from_phase)."""
    return (f1 ** 2 * f2 ** 2) / (40.3 * (f1 ** 2 - f2 ** 2))


def mapping_function(elevation_deg: float, ipp_height_km: float = _IPP_KM) -> float:
    """
    Obliquity mapping function S(E) — Gopi Book Eq 4.17.
    Re = 6378 km, H_ipp = 350–400 km.
    VTEC = STEC / S(E)
    """
    elev_rad = math.radians(max(elevation_deg, 0.1))
    arg = 1.0 - ((_RE_KM * math.cos(elev_rad)) / (_RE_KM + ipp_height_km)) ** 2
    return 1.0 / math.sqrt(max(arg, 1e-9))


def stec_from_phase(
    l1_cycles: float,
    l2_cycles: float,
    freq1_hz: float,
    freq2_hz: float,
) -> float:
    """
    STEC from L1/L2 carrier phase (Gopi Book Eq 4.12).
    L_m = L_cycles × c / f    (convert cycles to metres)
    STEC = K × (L1_m − L2_m)
    Returns STEC in TECU.
    """
    l1_m = l1_cycles * _C_LIGHT / freq1_hz
    l2_m = l2_cycles * _C_LIGHT / freq2_hz
    k = _k_factor(freq1_hz, freq2_hz)
    return k * (l1_m - l2_m) / 1e16


def vtec_from_stec(
    stec: float,
    elevation_deg: float,
    ipp_height_km: float = _IPP_KM,
) -> float:
    """VTEC = STEC / S(elevation)."""
    return stec / mapping_function(elevation_deg, ipp_height_km)


class LiveVtecAccumulator:
    """
    Buffers raw MSM observation records per (station, PRN) and emits a VTEC
    record whenever a complete L1 + L2 pair arrives.

    Each record from ntrip_stream has:
        station, prn, constellation, sig_idx (1=L1, 2=L2),
        carrier_phase_cycles, freq1_hz, freq2_hz, epoch, cnr_dbhz
    """

    def __init__(
        self,
        ipp_height_km: float = _IPP_KM,
        elevation_mask_deg: float = _ELEV_MASK,
    ):
        self.ipp_height_km = ipp_height_km
        self.elevation_mask = elevation_mask_deg
        # buf[(station, prn)] = {sig_idx: obs_record}
        self._buf: dict[tuple, dict[int, dict]] = defaultdict(dict)

    def ingest(self, obs: dict) -> Optional[dict]:
        """
        Accept one raw observation.
        Returns a VTEC dict if the L1+L2 pair for this PRN is now complete,
        otherwise returns None.
        """
        key     = (obs["station"], obs["prn"])
        sig_idx = int(obs.get("sig_idx", 0))
        epoch   = obs.get("epoch") or datetime.now(tz=timezone.utc)

        # Expire stale buffer entries
        existing = self._buf.get(key, {})
        for si, prev in list(existing.items()):
            age = (epoch - prev["epoch"]).total_seconds()
            if age > _PAIR_TIMEOUT_S:
                del self._buf[key][si]

        self._buf[key][sig_idx] = obs

        paired = self._buf[key]
        if len(paired) < 2:
            return None

        sigs = sorted(paired.keys())
        obs1 = paired[sigs[0]]   # lower sig_idx → L1
        obs2 = paired[sigs[1]]   # higher sig_idx → L2

        cp1 = obs1.get("carrier_phase_cycles") or 0.0
        cp2 = obs2.get("carrier_phase_cycles") or 0.0
        if not cp1 or not cp2:
            return None

        freq1 = obs1.get("freq1_hz") or obs.get("freq1_hz", 1575.42e6)
        freq2 = obs2.get("freq2_hz") or obs.get("freq2_hz", 1227.60e6)

        # Elevation must come from nav-derived geometry (RTCM 1019 + station coords).
        elevation = obs.get("elevation_deg")
        if elevation is None:
            return None
        if elevation < self.elevation_mask:
            self._buf[key].clear()
            return None

        stec = stec_from_phase(cp1, cp2, freq1, freq2)
        vtec = vtec_from_stec(stec, elevation, self.ipp_height_km)

        # Sanity-check (ionospheric VTEC is 0–150 TECU under normal conditions)
        if not (0.0 < vtec < 200.0):
            self._buf[key].clear()
            return None

        self._buf[key].clear()

        return {
            "epoch":         epoch,
            "station":       obs["station"],
            "constellation": obs.get("constellation", "GPS"),
            "prn":           obs["prn"],
            "stec_tecu":     round(stec, 4),
            "vtec_tecu":     round(vtec, 4),
            "elevation_deg": round(elevation, 2),
            "cnr_dbhz":      obs1.get("cnr_dbhz"),
        }

    def flush(self) -> None:
        """Clear all buffers (e.g. on reconnect)."""
        self._buf.clear()


class LiveVtecPipeline:
    """
    End-to-end live pipeline:
      RTCM obs → LiveVtecAccumulator → optional DB insert → on_vtec callback.

    Usage:
        pipeline = LiveVtecPipeline(db=tec_db, on_vtec=my_callback)
        # feed raw obs records from LiveNtripManager:
        pipeline.ingest(obs_record)
    """

    def __init__(
        self,
        db=None,
        on_vtec=None,
        nav_cache=None,
        ipp_height_km: float = _IPP_KM,
        elevation_mask_deg: float = _ELEV_MASK,
        db_flush_n: int = 50,
    ):
        self._acc = LiveVtecAccumulator(ipp_height_km, elevation_mask_deg)
        self._db = db
        self._on_vtec = on_vtec
        self._nav_cache = nav_cache
        self._pending: list[dict] = []
        self._flush_n = db_flush_n

    def ingest(self, obs: dict) -> None:
        if self._nav_cache is not None and obs.get("elevation_deg") is None:
            elev = self._nav_cache.elevation_deg(
                obs.get("station", ""),
                obs.get("prn", ""),
                obs.get("epoch"),
            )
            if elev is not None:
                obs = {**obs, "elevation_deg": elev}

        vtec = self._acc.ingest(obs)
        if vtec is None:
            return

        if self._on_vtec:
            try:
                self._on_vtec(vtec)
            except Exception as exc:
                log.debug("on_vtec callback error: %s", exc)

        if self._db is not None:
            self._pending.append(vtec)
            if len(self._pending) >= self._flush_n:
                try:
                    self._db.insert_vtec(self._pending)
                    self._pending.clear()
                except Exception as exc:
                    log.warning("DB flush error: %s", exc)

    def flush_db(self) -> None:
        """Force-flush any remaining records to the database."""
        if self._db and self._pending:
            try:
                self._db.insert_vtec(self._pending)
                self._pending.clear()
            except Exception as exc:
                log.warning("DB flush error: %s", exc)
