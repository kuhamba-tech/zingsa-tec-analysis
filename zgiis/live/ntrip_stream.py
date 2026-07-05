"""
Continuous NTRIP streaming for all 24 ZINGSA CORS stations.

Each station gets its own daemon thread that connects to the NTRIP caster,
streams RTCM bytes, decodes MSM4/MSM7 messages via pyrtcm, and emits raw
observation records for the STEC/VTEC pipeline.
"""
from __future__ import annotations

import base64
import io
import logging
import random
import socket
import ssl
import threading
import time
from collections import defaultdict, deque
from datetime import datetime, timezone
from typing import Callable, Optional

log = logging.getLogger(__name__)

try:
    from pyrtcm import RTCMReader
    _PYRTCM_OK = True
except ImportError:
    _PYRTCM_OK = False
    log.warning("pyrtcm not installed — install with: pip install pyrtcm")

_C_LIGHT = 2.99792458e8  # m/s

# RTCM MSM4/MSM7 message types per constellation
_MSM_TYPES: dict[str, set[int]] = {
    "GPS":     {1074, 1075, 1076, 1077},
    "GLONASS": {1084, 1085, 1086, 1087},
    "Galileo": {1094, 1095, 1096, 1097},
    "BeiDou":  {1124, 1125, 1126, 1127},
}
_ALL_MSM: set[int] = {t for s in _MSM_TYPES.values() for t in s}

# L1/L2 frequencies per constellation (Hz)
_FREQ1 = {
    "GPS":     1575.42e6,
    "Galileo": 1575.42e6,
    "BeiDou":  1561.098e6,
    "GLONASS": 1602.0e6,   # base (k=0); actual = base + k×0.5625 MHz
}
_FREQ2 = {
    "GPS":     1227.60e6,
    "Galileo": 1176.45e6,
    "BeiDou":  1207.14e6,
    "GLONASS": 1246.0e6,   # base; actual = base + k×0.4375 MHz
}


def _constellation_for(msg_type: int) -> str:
    for name, types in _MSM_TYPES.items():
        if msg_type in types:
            return name
    return "Unknown"


# Per-cell DF field names: MSM4/5 use the "plain resolution" set, MSM6/7 use
# the "extended resolution" set (and add a phase-range-rate field, unused here).
# See pyrtcm rtcmtypes_get_msm.py MSM_SIG_4..7 / rtcmtypes_core.py DF400-DF408.
def _msm_field_set(msg_type: int) -> tuple[str, str, str]:
    sub = msg_type % 10
    if sub in (6, 7):
        return ("DF405", "DF406", "DF408")  # pseudorange, phaserange, CNR (extended)
    return ("DF400", "DF401", "DF403")      # pseudorange, phaserange, CNR (MSM4/5)


def _band_from_sigcode(sigcode) -> int:
    """Map a pyrtcm CELLSIG value (e.g. '1C', '2W', 'L1', 'L2') to 1 or 2."""
    s = str(sigcode)
    if s.startswith(("1", "L1", "G1", "E1")):
        return 1
    if s.startswith(("2", "L2", "G2", "E2")):
        return 2
    return 0  # L5/E6/etc — unsupported by the dual-frequency STEC equations here


def _extract_msm(msg, msg_type: int, constellation: str, station: str, epoch: datetime) -> list[dict]:
    """
    Pull per-signal L1/L2 observations from a pyrtcm MSM4-7 message.
    Returns a list of raw observation dicts.

    NB: pyrtcm exposes group-count attributes as "NSat"/"NSig"/"NCell"
    (mixed case — NOT "NSAT"/"NSIG"), and cells are indexed 1..NCell per
    the GNSS cell mask (DF396), not a dense NSat*NSig grid — many
    satellite/signal combinations are absent. Use CELLPRN_nn/CELLSIG_nn
    (which pyrtcm derives from the cell mask) to identify each cell.
    """
    records: list[dict] = []
    try:
        nsat = getattr(msg, "NSat", 0) or 0
        ncell = getattr(msg, "NCell", 0) or 0
        if nsat == 0 or ncell == 0:
            return records

        pr_field, cp_field, cnr_field = _msm_field_set(msg_type)
        lock_field = "DF407" if pr_field == "DF405" else "DF402"
        freq1 = _FREQ1.get(constellation, _FREQ1["GPS"])
        freq2 = _FREQ2.get(constellation, _FREQ2["GPS"])

        # Rough range per satellite, in milliseconds, keyed by PRN string
        # (DF397 = integer ms, DF398 = fractional ms modulo 1ms — NOT DF399,
        # which is a Doppler/phase-range-rate term unrelated to range).
        rough_ranges_ms: dict[str, float] = {}
        for i in range(1, nsat + 1):
            prn_i = getattr(msg, f"PRN_{i:02d}", None)
            if prn_i is None:
                continue
            int_ms = getattr(msg, f"DF397_{i:02d}", 0) or 0
            mod_ms = getattr(msg, f"DF398_{i:02d}", 0.0) or 0.0
            rough_ranges_ms[str(prn_i)] = float(int_ms) + float(mod_ms)

        for cell in range(1, ncell + 1):
            fine_pr_ms = getattr(msg, f"{pr_field}_{cell:02d}", None)
            fine_cp_ms = getattr(msg, f"{cp_field}_{cell:02d}", None)
            if fine_pr_ms is None or fine_cp_ms is None:
                continue

            cell_prn = getattr(msg, f"CELLPRN_{cell:02d}", None)
            cell_sig = getattr(msg, f"CELLSIG_{cell:02d}", None)
            if cell_prn is None:
                continue

            sig_idx = _band_from_sigcode(cell_sig)
            if sig_idx == 0:
                continue  # not L1/L2 — can't use it for dual-frequency STEC

            cnr = getattr(msg, f"{cnr_field}_{cell:02d}", None)
            lock_time = getattr(msg, f"{lock_field}_{cell:02d}", None)

            rough_ms = rough_ranges_ms.get(str(cell_prn), 0.0)
            sat_idx = int(cell_prn)
            prn = f"{constellation[0]}{sat_idx:02d}"

            pseudorange_m = (rough_ms + fine_pr_ms) * 1e-3 * _C_LIGHT
            phaserange_m = (rough_ms + fine_cp_ms) * 1e-3 * _C_LIGHT
            freq_hz = freq1 if sig_idx == 1 else freq2
            carrier_phase_cycles = phaserange_m * freq_hz / _C_LIGHT

            records.append({
                "epoch":              epoch,
                "station":            station,
                "constellation":      constellation,
                "prn":                prn,
                "sat_idx":            sat_idx,
                "sig_idx":            sig_idx,
                "pseudorange_m":      pseudorange_m,
                "carrier_phase_cycles": carrier_phase_cycles,
                "cnr_dbhz":           cnr,
                "lock_time":          lock_time,
                "freq1_hz":           freq1,
                "freq2_hz":           freq2,
            })
    except Exception as exc:
        log.debug("MSM parse error [%s]: %s", station, exc)
    return records


class StationStream(threading.Thread):
    """
    Daemon thread that maintains a live RTCM connection for one CORS mountpoint.
    Reconnects automatically on failure. Calls `on_record` for each decoded obs.
    """

    def __init__(
        self,
        station: str,
        mountpoint: str,
        host: str,
        port: int,
        username: str,
        password: str,
        on_record: Callable[[dict], None],
        *,
        use_tls: bool = False,
        reconnect_delay: float = 5.0,
        max_reconnect_delay: float = 120.0,
        connection_slots: Optional[threading.Semaphore] = None,
        start_delay: float = 0.0,
        nav_cache=None,
    ):
        super().__init__(name=f"ntrip-{station}", daemon=True)
        self.station = station
        self._mp = mountpoint.lstrip("/")
        self._host = host
        self._port = port
        self._user = username
        self._pass = password
        self._on_record = on_record
        self._tls = use_tls
        self._reconnect_delay = reconnect_delay
        self._max_reconnect_delay = max_reconnect_delay
        # Caps how many StationStreams hold an open caster connection at once —
        # the caster enforces a per-account concurrent-connection limit, and
        # connecting all 24 mountpoints at once under one account exceeds it,
        # so most get rejected with "too many concurrent connections".
        self._slots = connection_slots
        self._start_delay = start_delay
        self._nav_cache = nav_cache
        self._consecutive_failures = 0

        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._connected = False
        self._last_seen: Optional[datetime] = None
        self._msg_count = 0
        self._latencies: deque[float] = deque(maxlen=120)

    # ── Public status accessors ──────────────────────────────────────────────

    @property
    def connected(self) -> bool:
        with self._lock:
            return self._connected

    @property
    def last_seen(self) -> Optional[datetime]:
        with self._lock:
            return self._last_seen

    @property
    def msg_count(self) -> int:
        with self._lock:
            return self._msg_count

    def mean_latency_ms(self) -> Optional[float]:
        with self._lock:
            return (sum(self._latencies) / len(self._latencies)) if self._latencies else None

    def stop(self):
        self._stop.set()

    # ── Thread body ──────────────────────────────────────────────────────────

    def run(self):
        if self._start_delay > 0:
            self._stop.wait(self._start_delay)
        while not self._stop.is_set():
            acquired = self._slots is None or self._slots.acquire(timeout=30)
            if not acquired:
                # Every slot is busy with another station — back off and retry
                # rather than piling up alongside the threads already waiting.
                time.sleep(self._backoff_delay(rejected=False))
                continue
            try:
                sock = self._connect()
                with self._lock:
                    self._connected = True
                self._consecutive_failures = 0
                log.info("[%s] Connected to %s/%s", self.station, self._host, self._mp)
                self._stream(sock)
            except Exception as exc:
                rejected = "too many concurrent" in str(exc).lower() or "rejected" in str(exc).lower()
                self._consecutive_failures += 1
                log.warning("[%s] %s", self.station, exc)
            else:
                rejected = False
            finally:
                with self._lock:
                    self._connected = False
                if self._slots is not None:
                    self._slots.release()
            if not self._stop.is_set():
                time.sleep(self._backoff_delay(rejected=rejected))

    def _backoff_delay(self, *, rejected: bool) -> float:
        # Account-level rejections (auth/concurrency limits) need a longer
        # cooldown than an ordinary transient network hiccup, or this thread
        # just keeps re-triggering the same rejection every few seconds.
        base = self._reconnect_delay * 4 if rejected else self._reconnect_delay
        delay = min(base * (2 ** min(self._consecutive_failures, 5)), self._max_reconnect_delay)
        return delay * (0.75 + random.random() * 0.5)

    def _connect(self) -> socket.socket:
        raw = socket.create_connection((self._host, self._port), timeout=10)
        sock = ssl.wrap_socket(raw) if self._tls else raw
        token = base64.b64encode(f"{self._user}:{self._pass}".encode()).decode()
        request = (
            f"GET /{self._mp} HTTP/1.1\r\n"
            f"Host: {self._host}:{self._port}\r\n"
            f"Ntrip-Version: Ntrip/2.0\r\n"
            f"User-Agent: ZGIIS-Live/1.0\r\n"
            f"Authorization: Basic {token}\r\n\r\n"
        )
        sock.sendall(request.encode())
        header = b""
        while b"\r\n\r\n" not in header:
            chunk = sock.recv(1024)
            if not chunk:
                raise ConnectionError("Empty response from caster")
            header += chunk
        if b"200" not in header and b"ICY 200" not in header:
            raise ConnectionError(f"Caster rejected: {header[:120]}")
        return sock

    def _stream(self, sock: socket.socket):
        if not _PYRTCM_OK:
            raise RuntimeError("pyrtcm is required — pip install pyrtcm")
        sock.settimeout(30)
        try:
            for _, msg in RTCMReader(sock):
                if self._stop.is_set():
                    break
                t_recv = datetime.now(tz=timezone.utc)
                try:
                    msg_type = int(msg.identity)
                except (AttributeError, ValueError):
                    continue

                if msg_type == 1019 and self._nav_cache is not None:
                    try:
                        self._nav_cache.update_gps_ephemeris(msg)
                    except Exception:
                        pass
                    continue

                if msg_type not in _ALL_MSM:
                    continue

                constellation = _constellation_for(msg_type)
                records = _extract_msm(msg, msg_type, constellation, self.station, t_recv)

                with self._lock:
                    self._last_seen = t_recv
                    self._msg_count += 1

                for rec in records:
                    self._on_record(rec)
        finally:
            try:
                sock.close()
            except Exception:
                pass


class LiveNtripManager:
    """
    Manages one StationStream per CORS mountpoint.
    Aggregates raw observations and forwards them to a callback.
    """

    def __init__(
        self,
        ntrip_cfg: dict,
        on_observation: Optional[Callable[[dict], None]] = None,
        *,
        max_concurrent: Optional[int] = None,
        nav_cache=None,
    ):
        self._cfg = ntrip_cfg
        self._on_obs = on_observation or (lambda _: None)
        self._nav_cache = nav_cache
        self._streams: dict[str, StationStream] = {}
        # One shared account opening 24 mountpoints at once exceeds the
        # caster's per-account concurrent-connection limit (see
        # NTRIP_LIVE_MAX_CONCURRENT) — cap how many stations hold an open
        # session simultaneously; the rest queue and rotate in.
        self._slots = threading.Semaphore(max_concurrent) if max_concurrent else None

    def start(self, mountpoints: dict[str, str], *, stagger_sec: float = 1.5) -> None:
        """
        Start a stream for each station.
        mountpoints: {station_id: mountpoint_name}
        """
        host = self._cfg.get("host", "")
        port = int(self._cfg.get("port", 2101))
        user = self._cfg.get("username", "")
        pw   = self._cfg.get("password", "")
        tls  = str(self._cfg.get("connection", "TCP")).upper() == "TLS"

        for i, (station, mp) in enumerate(mountpoints.items()):
            if station in self._streams:
                continue
            s = StationStream(
                station=station,
                mountpoint=mp,
                host=host,
                port=port,
                username=user,
                password=pw,
                on_record=self._on_obs,
                use_tls=tls,
                connection_slots=self._slots,
                start_delay=i * stagger_sec,
                nav_cache=self._nav_cache,
            )
            self._streams[station] = s
            s.start()
            log.info("Started stream for %s → %s", station, mp)

    def stop(self) -> None:
        for s in self._streams.values():
            s.stop()
        self._streams.clear()

    def status(self) -> dict[str, dict]:
        return {
            sid: {
                "mountpoint": s._mp,
                "connected":    s.connected,
                "last_seen":    s.last_seen,
                "msg_count":    s.msg_count,
                "latency_ms":   s.mean_latency_ms(),
            }
            for sid, s in self._streams.items()
        }

    @property
    def active_count(self) -> int:
        return sum(1 for s in self._streams.values() if s.connected)
