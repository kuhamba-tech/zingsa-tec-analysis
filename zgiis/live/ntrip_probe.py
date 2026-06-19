"""One-shot NTRIP mountpoint probes — verify caster accept vs MSM observation flow."""

from __future__ import annotations



import base64

import os

import socket

import ssl

import time

from collections import Counter

from concurrent.futures import ThreadPoolExecutor, as_completed

from typing import Any



try:

    from pyrtcm import RTCMReader



    _PYRTCM_OK = True

except ImportError:

    _PYRTCM_OK = False



# MSM4/MSM7 types required by the live VTEC pipeline (matches ntrip_stream.py)

_MSM_TYPES: set[int] = {

    1074, 1075, 1076, 1077,

    1084, 1085, 1086, 1087,

    1094, 1095, 1096, 1097,

    1124, 1125, 1126, 1127,

}





def _load_ntrip_cfg() -> dict[str, Any]:

    return {

        "host": os.getenv("NTRIP_HOST", "").strip(),

        "port": int(os.getenv("NTRIP_PORT", "2101")),

        "username": os.getenv("NTRIP_USERNAME", "").strip(),

        "password": os.getenv("NTRIP_PASSWORD", "").strip(),

        "use_tls": os.getenv("NTRIP_CONNECTION", "TCP").strip().upper() == "TLS",

    }





def parse_mountpoints_from_env() -> dict[str, str]:

    raw = os.getenv("NTRIP_MOUNTPOINTS", "").strip()

    if raw:

        out: dict[str, str] = {}

        for pair in raw.split(","):

            pair = pair.strip()

            if not pair or ":" not in pair:

                continue

            station, mp = pair.split(":", 1)

            out[station.strip().lower()] = mp.strip()

        if out:

            return out

    mountpoint = os.getenv("NTRIP_MOUNTPOINT", "").strip()

    station = os.getenv("NTRIP_STATION_CODE", "zinh").strip().lower()

    return {station: mountpoint} if mountpoint else {}





def _counter_to_str_keys(counter: Counter[int]) -> dict[str, int]:

    return {str(k): v for k, v in sorted(counter.items())}





def probe_mountpoint(

    *,

    host: str,

    port: int,

    username: str,

    password: str,

    mountpoint: str,

    use_tls: bool = False,

    listen_sec: float = 6.0,

    connect_timeout: float = 10.0,

) -> dict[str, Any]:

    """Open a short-lived NTRIP session and report connect vs MSM observation flow."""

    mp = mountpoint.lstrip("/")

    result: dict[str, Any] = {

        "mountpoint": mp,

        "tcp_ok": False,

        "caster_ok": False,

        "http_status": None,

        "bytes_received": 0,

        "rtcm_total": 0,

        "msm_count": 0,

        "rtcm_frames": 0,

        "msg_types": {},

        "msm_types": {},

        "first_msgs": [],

        "error": None,

        "verdict": "offline",

        "note": "",

    }

    sock = None

    try:

        raw = socket.create_connection((host, port), timeout=connect_timeout)

        sock = ssl.wrap_socket(raw) if use_tls else raw

        result["tcp_ok"] = True



        token = base64.b64encode(f"{username}:{password}".encode()).decode()

        request = (

            f"GET /{mp} HTTP/1.1\r\n"

            f"Host: {host}:{port}\r\n"

            f"Ntrip-Version: Ntrip/2.0\r\n"

            f"User-Agent: ZGIIS-Probe/1.0\r\n"

            f"Authorization: Basic {token}\r\n\r\n"

        )

        sock.sendall(request.encode())



        header = b""

        while b"\r\n\r\n" not in header:

            chunk = sock.recv(1024)

            if not chunk:

                raise ConnectionError("Caster closed before HTTP header completed")

            header += chunk



        header_text = header.decode(errors="replace")

        if "200" in header_text.split("\r\n", 1)[0]:

            result["caster_ok"] = True

            result["http_status"] = header_text.split("\r\n", 1)[0].strip()

        else:

            result["error"] = header_text[:240].strip()

            result["note"] = "Caster rejected this mountpoint"

            return result



        if not _PYRTCM_OK:

            sock.settimeout(1.0)

            deadline = time.time() + listen_sec

            while time.time() < deadline:

                try:

                    chunk = sock.recv(4096)

                except socket.timeout:

                    continue

                if not chunk:

                    break

                result["bytes_received"] += len(chunk)

                result["rtcm_frames"] += chunk.count(b"\xd3")

            result["rtcm_total"] = result["rtcm_frames"]

            if result["rtcm_frames"] > 0:

                result["verdict"] = "rtcm_no_msm"

                result["note"] = "RTCM bytes seen but pyrtcm unavailable — install pyrtcm for MSM decode"

            elif result["bytes_received"] > 0:

                result["verdict"] = "connected_no_data"

                result["note"] = "Connected but no RTCM frames in probe window"

            else:

                result["verdict"] = "connected_no_data"

                result["note"] = "Caster accepted mountpoint but sent no bytes in probe window"

            return result



        sock.settimeout(1.0)

        deadline = time.time() + listen_sec

        types: Counter[int] = Counter()

        msm_types: Counter[int] = Counter()

        first: list[int] = []



        for _, msg in RTCMReader(sock):

            if time.time() > deadline:

                break

            try:

                msg_type = int(msg.identity)

            except (AttributeError, ValueError):

                continue

            result["rtcm_total"] += 1

            types[msg_type] += 1

            if msg_type in _MSM_TYPES:

                result["msm_count"] += 1

                msm_types[msg_type] += 1

            if len(first) < 8:

                first.append(msg_type)



        result["msg_types"] = _counter_to_str_keys(types)

        result["msm_types"] = _counter_to_str_keys(msm_types)

        result["first_msgs"] = first

        result["rtcm_frames"] = result["rtcm_total"]



        if result["msm_count"] > 0:

            result["verdict"] = "msm_streaming"

            result["note"] = "MSM4/MSM7 observation RTCM received — usable for VTEC pipeline"

        elif result["rtcm_total"] > 0:

            result["verdict"] = "rtcm_no_msm"

            type_list = ", ".join(f"{k}×{v}" for k, v in result["msg_types"].items())

            result["note"] = (

                f"Connected; RTCM types {type_list} — not MSM observations "

                "(vendor site may be up but NTRIP is not streaming MSM)"

            )

        else:

            result["verdict"] = "connected_no_data"

            result["note"] = (

                "Caster accepted mountpoint but sent no RTCM in probe window — "

                "another client may already hold the stream, or receiver is idle"

            )

    except Exception as exc:

        result["error"] = str(exc)

        result["note"] = "Could not reach mountpoint"

    finally:

        if sock is not None:

            try:

                sock.close()

            except Exception:

                pass

    return result





def probe_all_mountpoints(

    *,

    listen_sec: float = 6.0,

    max_workers: int = 6,

    mountpoints: dict[str, str] | None = None,

) -> dict[str, Any]:

    cfg = _load_ntrip_cfg()

    mps = mountpoints if mountpoints is not None else parse_mountpoints_from_env()

    empty_summary = {

        "total": 0,

        "msm_streaming": 0,

        "rtcm_no_msm": 0,

        "connected_no_data": 0,

        "offline": 0,

    }

    if not (cfg["host"] and cfg["username"] and cfg["password"] and mps):

        return {

            "host": cfg["host"] or None,

            "port": cfg["port"],

            "probed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),

            "stations": [],

            "summary": empty_summary,

            "error": "NTRIP credentials or mountpoints are not configured in backend/.env",

        }



    rows: list[dict[str, Any]] = []



    def _one(station: str, mp: str) -> dict[str, Any]:

        probe = probe_mountpoint(

            host=cfg["host"],

            port=cfg["port"],

            username=cfg["username"],

            password=cfg["password"],

            mountpoint=mp,

            use_tls=cfg["use_tls"],

            listen_sec=listen_sec,

        )

        probe["station"] = station

        return probe



    with ThreadPoolExecutor(max_workers=max_workers) as pool:

        futures = {pool.submit(_one, st, mp): st for st, mp in mps.items()}

        for fut in as_completed(futures):

            rows.append(fut.result())



    rows.sort(key=lambda r: r["station"])

    summary = {

        "total": len(rows),

        "msm_streaming": sum(1 for r in rows if r["verdict"] == "msm_streaming"),

        "rtcm_no_msm": sum(1 for r in rows if r["verdict"] == "rtcm_no_msm"),

        "connected_no_data": sum(1 for r in rows if r["verdict"] == "connected_no_data"),

        "offline": sum(1 for r in rows if r["verdict"] == "offline"),

    }

    return {

        "host": cfg["host"],

        "port": cfg["port"],

        "listen_sec": listen_sec,

        "probed_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),

        "stations": rows,

        "summary": summary,

        "error": None,

    }


