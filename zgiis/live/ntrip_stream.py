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


def _extract_msm(msg, constellation: str, station: str, epoch: datetime) -> list[dict]:
    """
    Pull per-signal L1/L2 observations from a pyrtcm MSM4/MSM7 message.
    Returns a list of raw observation dicts.
    """
    records: list[dict] = []
    try:
        nsat = getattr(msg, "NSAT", 0) or 0
        nsig = getattr(msg, "NSIG", 0) or 0
        if nsat == 0 or nsig == 0:
            return records

        # Build rough range per satellite (ms → metres, speed of light = 299792.458 km/s)
        rough_ranges: list[float] = []
        for i in range(1, nsat + 1):
            int_ms  = getattr(msg, f"DF397_{i:02d}", 0) or 0
            mod_ms  = getattr(msg, f"DF399_{i:02d}", 0.0) or 0.0
            rough_ranges.append((int_ms + mod_ms) * 0.001 * 299_792_458.0)

        # Iterate over cell (satellite × signal) grid
        for cell in range(1, nsat * nsig + 1):
            sat_idx = ((cell - 1) // nsig) + 1
            sig_idx = ((cell - 1) % nsig) + 1

            fine_pr = getattr(msg, f"DF403_{cell:02d}", None)
            fine_cp = getattr(msg, f"DF404_{cell:02d}", None)
            if fine_pr is None or fine_cp is None:
                continue

            cnr = getattr(msg, f"DF420_{cell:02d}", None) or getattr(msg, f"DF402_{cell:02d}", None)
            lock_time = getattr(msg, f"DF402_{cell:02d}", None)

            rough = rough_ranges[sat_idx - 1] if sat_idx <= len(rough_ranges) else 0.0
            prn = f"{constellation[0]}{sat_idx:02d}"

            records.append({
                "epoch":              epoch,
                "station":            station,
                "constellation":      constellation,
                "prn":                prn,
                "sat_idx":            sat_idx,
                "sig_idx":            sig_idx,
                "pseudorange_m":      rough + (fine_pr or 0.0),
                "carrier_phase_cycles": fine_cp,
                "cnr_dbhz":           cnr,
                "lock_time":          lock_time,
                "freq1_hz":           _FREQ1.get(constellation, _FREQ1["GPS"]),
                "freq2_hz":           _FREQ2.get(constellation, _FREQ2["GPS"]),
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
        while not self._stop.is_set():
            try:
                sock = self._connect()
                with self._lock:
                    self._connected = True
                log.info("[%s] Connected to %s/%s", self.station, self._host, self._mp)
                self._stream(sock)
            except Exception as exc:
                log.warning("[%s] %s", self.station, exc)
            finally:
                with self._lock:
                    self._connected = False
            if not self._stop.is_set():
                time.sleep(self._reconnect_delay)

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
                if msg_type not in _ALL_MSM:
                    continue

                constellation = _constellation_for(msg_type)
                records = _extract_msm(msg, constellation, self.station, t_recv)

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
    ):
        self._cfg = ntrip_cfg
        self._on_obs = on_observation or (lambda _: None)
        self._streams: dict[str, StationStream] = {}

    def start(self, mountpoints: dict[str, str]) -> None:
        """
        Start a stream for each station.
        mountpoints: {station_id: mountpoint_name}
        """
        host = self._cfg.get("host", "")
        port = int(self._cfg.get("port", 2101))
        user = self._cfg.get("username", "")
        pw   = self._cfg.get("password", "")
        tls  = str(self._cfg.get("connection", "TCP")).upper() == "TLS"

        for station, mp in mountpoints.items():
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
