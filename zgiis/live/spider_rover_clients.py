"""Live NTRIP client counts from Leica Spider rover status.

Spider Site Status does not include who is connected. The Rover Status page
publishes that list on its realtime channel. This module reads that channel
and counts the connections Spider sends. It does not fill in a number when
the channel cannot be read.
"""
from __future__ import annotations

import base64
import logging
import os
import socket
import ssl
import struct
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import requests

from zgiis.live.rover_clients import RoverClientsSnapshot, parse_rover_clients_payload
from zgiis.live.spider_site_status import (
    _extract_antiforgery,
    _spider_base_url,
    _spider_credentials,
)

log = logging.getLogger(__name__)

_AUTH_REQUEST = 0
_AUTH_RESPONSE = 1
_BATCH = 2
_QOS = 3
_ROVER_CACHE = 4
_CONNECTION_END = 5
_CONNECTION_START = 6
_ROVER_REMOVE = 7
_ROVER_TEXT = 8
_ROVER_UPDATE = 9
_TIME_REQUEST = 10
_TIME_RESPONSE = 11
_ROVER_ALIVE = 14
_ROVER_CHANNEL = 1
_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)


class SpiderRoverReadError(RuntimeError):
    pass


@dataclass
class _Reader:
    data: bytes
    pos: int = 0

    def remaining(self) -> int:
        return len(self.data) - self.pos

    def u8(self) -> int:
        self._need(1)
        value = self.data[self.pos]
        self.pos += 1
        return value

    def i8(self) -> int:
        self._need(1)
        value = struct.unpack_from("<b", self.data, self.pos)[0]
        self.pos += 1
        return value

    def u16(self) -> int:
        self._need(2)
        value = struct.unpack_from("<H", self.data, self.pos)[0]
        self.pos += 2
        return value

    def u32(self) -> int:
        self._need(4)
        value = struct.unpack_from("<I", self.data, self.pos)[0]
        self.pos += 4
        return value

    def i32(self) -> int:
        self._need(4)
        value = struct.unpack_from("<i", self.data, self.pos)[0]
        self.pos += 4
        return value

    def f32(self) -> float:
        self._need(4)
        value = struct.unpack_from("<f", self.data, self.pos)[0]
        self.pos += 4
        return value

    def f64(self) -> float:
        self._need(8)
        value = struct.unpack_from("<d", self.data, self.pos)[0]
        self.pos += 8
        return value

    def guid(self) -> bytes:
        self._need(16)
        value = self.data[self.pos : self.pos + 16]
        self.pos += 16
        return value

    def string(self) -> str:
        end = self.data.find(b"\x00", self.pos)
        if end < 0:
            raise SpiderRoverReadError("Unterminated Spider string")
        raw = self.data[self.pos : end]
        self.pos = end + 1
        return raw.decode("utf-8", errors="replace")

    def strings(self) -> list[str]:
        count = self.i32()
        if count < 0 or count > 10000:
            raise SpiderRoverReadError("Spider string list is not usable")
        return [self.string() for _ in range(count)]

    def _need(self, n: int) -> None:
        if self.pos + n > len(self.data):
            raise SpiderRoverReadError("Spider rover message ended early")


def _event_header(reader: _Reader) -> tuple[int, float]:
    return reader.u8(), reader.f64()


def _rover_event(reader: _Reader) -> dict:
    event_type, event_time = _event_header(reader)
    return {
        "event_type": event_type,
        "event_time": event_time,
        "job_id": reader.guid(),
        "old_job_id": reader.u32(),
        "network_server": reader.string(),
        "rtk_server": reader.string(),
    }


def _rover_rtk(reader: _Reader) -> dict:
    row = _rover_event(reader)
    row.update(
        {
            "user_id": reader.u32(),
            "sbc_user_id": reader.i32(),
            "rover_user_name": reader.string(),
            "credential_id": reader.i32(),
            "credential_user_name": reader.string(),
            "status_code": reader.i8(),
        }
    )
    return row


def _rover_update(reader: _Reader) -> dict:
    row = _rover_rtk(reader)
    row.update(
        {
            "num_used_sat_rover": reader.u8(),
            "num_fixed_sat_ref": reader.u8(),
            "latency": reader.f32(),
            "reference_station_name": reader.string(),
            "hdop": reader.f32(),
            "rover_longitude": reader.f64(),
            "rover_latitude": reader.f64(),
            "rover_height": reader.f64(),
            "distance_to_reference_station": reader.f32(),
            "position_quality": reader.u8(),
            "reference_station_id": reader.i32(),
            "virtual_reference_station_id": reader.i32(),
            "site_reference_station_id": reader.i32(),
            "rover_user_detail": reader.string(),
            "start_of_connection": reader.f64(),
            "product_name": reader.string(),
            "product_type": reader.u8(),
            "client_host": reader.string(),
            "user_agent": reader.string(),
            "first_correction_time": reader.f64(),
            "cluster_id": reader.i32(),
            "used_sites": reader.strings(),
        }
    )
    return row


def parse_event(data: bytes, offset: int = 0) -> tuple[dict, int]:
    """Decode one Spider realtime event. Returns the event and the next offset."""
    reader = _Reader(data, offset)
    if reader.remaining() < 1:
        raise SpiderRoverReadError("Empty Spider event")
    kind = data[reader.pos]
    if kind in (_ROVER_UPDATE, _CONNECTION_START):
        row = _rover_update(reader)
    elif kind == _CONNECTION_END:
        row = _rover_rtk(reader)
        row["end_of_connection"] = reader.f64()
    elif kind in (_ROVER_REMOVE, _ROVER_ALIVE):
        row = _rover_event(reader)
    elif kind == _ROVER_TEXT:
        row = _rover_event(reader)
        row["message"] = reader.string()
    elif kind in (_ROVER_CACHE, _BATCH):
        event_type, event_time = _event_header(reader)
        count = reader.u16()
        events = []
        for _ in range(count):
            child, reader.pos = parse_event(data, reader.pos)
            events.append(child)
        row = {"event_type": event_type, "event_time": event_time, "events": events}
    elif kind == _AUTH_RESPONSE:
        event_type, event_time = _event_header(reader)
        row = {
            "event_type": event_type,
            "event_time": event_time,
            "result": reader.u8(),
            "client_id": reader.guid(),
        }
    elif kind == _TIME_REQUEST:
        event_type, event_time = _event_header(reader)
        row = {"event_type": event_type, "event_time": event_time}
    elif kind == _TIME_RESPONSE:
        event_type, event_time = _event_header(reader)
        row = {
            "event_type": event_type,
            "event_time": event_time,
            "time0": reader.f64(),
            "time1": reader.f64(),
        }
    elif kind == _QOS:
        event_type, event_time = _event_header(reader)
        row = {
            "event_type": event_type,
            "event_time": event_time,
            "latency": reader.u32(),
            "messages_failed": reader.u32(),
            "messages_success": reader.u32(),
            "last_event_time": reader.f64(),
            "reset": reader.u8(),
            "data_provider_status": reader.u8(),
        }
    else:
        raise SpiderRoverReadError(f"Unrecognised Spider event type {kind}")
    return row, reader.pos


def parse_data_frame(payload: bytes) -> dict:
    """Data-channel frames start with a float64 timestamp, then one event."""
    if len(payload) < 9:
        raise SpiderRoverReadError("Spider data frame is too short")
    event, end = parse_event(payload, 8)
    if end != len(payload):
        raise SpiderRoverReadError("Spider data frame was not fully read")
    return event


def connected_rovers_from_cache(event: dict) -> list[dict]:
    """Active connections in a rover-cache message, one row per Spider job."""
    if event.get("event_type") != _ROVER_CACHE:
        return []
    seen: dict[bytes, dict] = {}
    for child in event.get("events") or []:
        if child.get("event_type") not in (_ROVER_UPDATE, _CONNECTION_START):
            continue
        job = child.get("job_id")
        if not isinstance(job, bytes):
            continue
        seen[job] = child
    return list(seen.values())


def _auth_frame(credentials: str, channels: int, client_id: bytes | None = None) -> bytes:
    out = bytearray()
    out.append(_AUTH_REQUEST)
    out += struct.pack("<d", time.time() * 1000.0)
    out += client_id if client_id is not None else bytes(16)
    out += (credentials or "").encode("utf-8") + b"\x00"
    out.append(channels & 0xFF)
    return bytes(out)


def _time_response(event_time: float) -> bytes:
    now = time.time() * 1000.0
    time0 = max(event_time, event_time)
    time1 = max(now, time0)
    return struct.pack("<Bd", _TIME_RESPONSE, event_time) + struct.pack("<dd", time0, time1)


class _WebSocket:
    def __init__(self, url: str, *, cookie: str, origin: str, timeout: float):
        parsed = urlparse(url)
        host = parsed.hostname or ""
        port = parsed.port or 443
        path = parsed.path or "/"
        raw = socket.create_connection((host, port), timeout=timeout)
        context = ssl.create_default_context()
        self._sock = context.wrap_socket(raw, server_hostname=host)
        self._sock.settimeout(timeout)
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        host_header = host if port in (80, 443) else f"{host}:{port}"
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host_header}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            f"Origin: {origin}\r\n"
            "Pragma: no-cache\r\n"
            "Cache-Control: no-cache\r\n"
            "Accept-Language: en-US,en;q=0.9\r\n"
            f"Cookie: {cookie}\r\n"
            f"User-Agent: {_USER_AGENT}\r\n"
            "\r\n"
        )
        self._sock.sendall(request.encode("ascii", errors="ignore"))
        header = b""
        while b"\r\n\r\n" not in header:
            chunk = self._sock.recv(4096)
            if not chunk:
                raise SpiderRoverReadError("Spider realtime channel closed during handshake")
            header += chunk
            if len(header) > 65536:
                raise SpiderRoverReadError("Spider realtime handshake was too large")
        head, _, rest = header.partition(b"\r\n\r\n")
        status_line = head.split(b"\r\n", 1)[0].decode("ascii", "replace")
        if " 101 " not in status_line:
            detail = status_line.split(" ", 1)[-1][:40]
            raise SpiderRoverReadError(f"Spider realtime channel returned {detail}")
        self._buf = rest

    def send_text(self, text: str) -> None:
        self._send(0x1, text.encode("utf-8"))

    def send_binary(self, payload: bytes) -> None:
        self._send(0x2, payload)

    def recv(self) -> tuple[int, bytes]:
        while True:
            opcode, payload = self._recv_frame()
            if opcode == 0x9:
                self._send(0xA, payload)
                continue
            if opcode == 0x8:
                raise SpiderRoverReadError("Spider realtime channel closed")
            if opcode in (0x1, 0x2):
                return opcode, payload

    def close(self) -> None:
        try:
            self._send(0x8, b"")
        except Exception:
            pass
        try:
            self._sock.close()
        except Exception:
            pass

    def _send(self, opcode: int, payload: bytes) -> None:
        mask = os.urandom(4)
        header = bytearray([0x80 | opcode])
        length = len(payload)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.append(0x80 | 126)
            header += struct.pack("!H", length)
        else:
            header.append(0x80 | 127)
            header += struct.pack("!Q", length)
        header += mask
        masked = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
        self._sock.sendall(bytes(header) + masked)

    def _recv_exact(self, n: int) -> bytes:
        while len(self._buf) < n:
            chunk = self._sock.recv(65536)
            if not chunk:
                raise SpiderRoverReadError("Spider realtime channel closed")
            self._buf += chunk
        out, self._buf = self._buf[:n], self._buf[n:]
        return out

    def _recv_frame(self) -> tuple[int, bytes]:
        first = self._recv_exact(2)
        opcode = first[0] & 0x0F
        masked = bool(first[1] & 0x80)
        length = first[1] & 0x7F
        if length == 126:
            length = struct.unpack("!H", self._recv_exact(2))[0]
        elif length == 127:
            length = struct.unpack("!Q", self._recv_exact(8))[0]
        mask = self._recv_exact(4) if masked else b""
        payload = self._recv_exact(length)
        if mask:
            payload = bytes(byte ^ mask[i % 4] for i, byte in enumerate(payload))
        return opcode, payload


def _login(timeout: float) -> tuple[requests.Session, str, str, str]:
    base = _spider_base_url()
    user, password = _spider_credentials()
    if not (base and user and password):
        raise SpiderRoverReadError("Spider credentials are not configured")
    session = requests.Session()
    session.headers.update({"User-Agent": _USER_AGENT, "Accept-Language": "en-US,en;q=0.9"})
    login_page = session.get(f"{base}/Account/Index", timeout=timeout, allow_redirects=True)
    login_page.raise_for_status()
    token = _extract_antiforgery(login_page.text)
    form = {"UserName": user, "Password": password, "RememberMe": "false"}
    if token:
        form["__RequestVerificationToken"] = token
    session.post(
        f"{base}/Account/Index",
        data=form,
        timeout=timeout,
        allow_redirects=True,
        headers={"Referer": f"{base}/Account/Index", "Content-Type": "application/x-www-form-urlencoded"},
    )
    page = session.get(
        f"{base}/User/RealTime/RoverStatus",
        timeout=timeout,
        allow_redirects=True,
        headers={"Referer": f"{base}/User/SiteMap/SiteMap"},
    )
    page.raise_for_status()
    html = page.text
    session_token = _between(html, "sessionToken: '", "'")
    control = _between(html, "urlControlChannel: '", "'")
    data = _between(html, "urlDataChannel: '", "'")
    if not (session_token and control and data):
        raise SpiderRoverReadError("Spider rover page did not include a realtime session")
    return session, session_token, control, data


def _between(text: str, start: str, end: str) -> str:
    i = text.find(start)
    if i < 0:
        return ""
    i += len(start)
    j = text.find(end, i)
    if j < 0:
        return ""
    return text[i:j]


def _cookie_header(session: requests.Session) -> str:
    return "; ".join(f"{cookie.name}={cookie.value}" for cookie in session.cookies)


def _origin(url: str) -> str:
    parsed = urlparse(url)
    return f"{parsed.scheme.replace('wss', 'https').replace('ws', 'http')}://{parsed.hostname}"


def _open_channel(url: str, *, cookie: str, timeout: float) -> _WebSocket:
    channel = _WebSocket(url, cookie=cookie, origin=_origin(url), timeout=timeout)
    for _ in range(30):
        channel.send_text("Data Request")
    return channel


def _authenticate(
    channel: _WebSocket,
    credentials: str,
    channels: int,
    client_id: bytes | None,
    *,
    data_channel: bool,
) -> bytes:
    channel.send_binary(_auth_frame(credentials, channels, client_id))
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        opcode, payload = channel.recv()
        if opcode != 2:
            continue
        try:
            if data_channel:
                event = parse_data_frame(payload)
            else:
                event, _end = parse_event(payload, 0)
        except SpiderRoverReadError:
            continue
        if event.get("event_type") == _TIME_REQUEST and not data_channel:
            channel.send_binary(_time_response(float(event["event_time"])))
            continue
        if event.get("event_type") == _AUTH_RESPONSE:
            if event.get("result") != 0 or not isinstance(event.get("client_id"), bytes):
                raise SpiderRoverReadError("Spider refused the rover-status session")
            return event["client_id"]
    raise SpiderRoverReadError("Spider did not accept the rover-status session")


def _read_cache(channel: _WebSocket) -> dict:
    deadline = time.monotonic() + 12
    while time.monotonic() < deadline:
        _opcode, payload = channel.recv()
        try:
            event = parse_data_frame(payload)
        except SpiderRoverReadError:
            continue
        if event.get("event_type") == _ROVER_CACHE:
            return event
    raise SpiderRoverReadError("Spider did not send the connected-rover list")


def _station_rows(rovers: list[dict]) -> list[dict]:
    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

    by_name = {station.name.strip().lower(): station.code.lower().rstrip("_") for station in ZIMBABWE_CORS_STATIONS}
    by_code = {station.code.lower().rstrip("_"): station.code.lower().rstrip("_") for station in ZIMBABWE_CORS_STATIONS}
    counts: dict[str, int] = {}
    for rover in rovers:
        label = str(rover.get("reference_station_name") or "").strip()
        key = label.lower().rstrip("_")
        code = by_code.get(key) or by_name.get(key) or key
        if not code:
            code = "unassigned"
        counts[code] = counts.get(code, 0) + 1
    return [{"code": code, "connected_rovers": count} for code, count in counts.items()]


def fetch_spider_rover_snapshot(*, timeout: float = 20.0) -> RoverClientsSnapshot | None:
    """Return Spider's current rover list, or None when Spider is not configured."""
    user, password = _spider_credentials()
    if not (_spider_base_url() and user and password):
        return None
    control = data = None
    try:
        session, session_token, control_url, data_url = _login(timeout)
        cookie = _cookie_header(session)
        control = _open_channel(control_url, cookie=cookie, timeout=timeout)
        client_id = _authenticate(control, session_token, _ROVER_CHANNEL, None, data_channel=False)
        data = _open_channel(data_url, cookie=cookie, timeout=timeout)
        _authenticate(data, "", _ROVER_CHANNEL, client_id, data_channel=True)
        cache = _read_cache(data)
        rovers = connected_rovers_from_cache(cache)
        updated = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        if not rovers:
            return RoverClientsSnapshot(
                available=True,
                updated_at=updated,
                source="Leica Spider rover status",
                message=None,
                total_rovers=0,
                stations_with_rovers=0,
                stations=[],
            )
        return parse_rover_clients_payload(
            {
                "updated_at": updated,
                "source": "Leica Spider rover status",
                "stations": _station_rows(rovers),
            },
            source="Leica Spider rover status",
        )
    except SpiderRoverReadError:
        log.warning("Spider rover status could not be read")
        return RoverClientsSnapshot(
            available=False,
            source="Leica Spider rover status",
            message=(
                "Spider Rover Status did not send the connected-client list. "
                "No count is shown."
            ),
        )
    except Exception:
        log.warning("Spider rover status could not be read")
        return RoverClientsSnapshot(
            available=False,
            source="Leica Spider rover status",
            message=(
                "Spider Rover Status did not send the connected-client list. "
                "No count is shown."
            ),
        )
    finally:
        if data is not None:
            data.close()
        if control is not None:
            control.close()
