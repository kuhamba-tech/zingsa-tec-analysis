"""One-shot live NTRIP verification — real caster, decodes RTCM message types."""
from __future__ import annotations

import base64
import os
import socket
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

# Load backend/.env
env_path = ROOT / "backend" / ".env"
for line in env_path.read_text(encoding="utf-8").splitlines():
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip())

from pyrtcm import RTCMReader

HOST = os.environ["NTRIP_HOST"]
PORT = int(os.environ["NTRIP_PORT"])
USER = os.environ["NTRIP_USERNAME"]
PW = os.environ["NTRIP_PASSWORD"]

_MSM = {
    1074, 1075, 1076, 1077,
    1084, 1085, 1086, 1087,
    1094, 1095, 1096, 1097,
    1124, 1125, 1126, 1127,
}

# From vendor Site Status screenshot (blue=up, red=down)
VENDOR_STATUS = {
    "beit": "up",
    "bing": "down",
    "bula": "down",
    "cent": "up",
    "chim": "down",
}


def parse_mountpoints() -> dict[str, str]:
    out: dict[str, str] = {}
    for pair in os.environ.get("NTRIP_MOUNTPOINTS", "").split(","):
        pair = pair.strip()
        if not pair or ":" not in pair:
            continue
        st, mp = pair.split(":", 1)
        out[st.strip().lower()] = mp.strip()
    return out


def probe(station: str, mountpoint: str, listen_sec: float = 10.0) -> dict:
    mp = mountpoint.lstrip("/")
    result = {
        "station": station,
        "mountpoint": mp,
        "vendor_status": VENDOR_STATUS.get(station, "unknown"),
        "tcp_ok": False,
        "caster_ok": False,
        "http_status": None,
        "rtcm_total": 0,
        "msm_count": 0,
        "msg_types": {},
        "msm_types": {},
        "first_msgs": [],
        "error": None,
        "verdict": "OFFLINE",
    }
    sock = None
    try:
        sock = socket.create_connection((HOST, PORT), timeout=12)
        result["tcp_ok"] = True
        token = base64.b64encode(f"{USER}:{PW}".encode()).decode()
        request = (
            f"GET /{mp} HTTP/1.1\r\n"
            f"Host: {HOST}:{PORT}\r\n"
            f"Ntrip-Version: Ntrip/2.0\r\n"
            f"User-Agent: ZGIIS-Verify/1.0\r\n"
            f"Authorization: Basic {token}\r\n\r\n"
        )
        sock.sendall(request.encode())
        header = b""
        while b"\r\n\r\n" not in header:
            chunk = sock.recv(1024)
            if not chunk:
                raise ConnectionError("Caster closed before HTTP header")
            header += chunk
        line1 = header.decode(errors="replace").split("\r\n", 1)[0]
        result["http_status"] = line1
        result["caster_ok"] = "200" in line1
        if not result["caster_ok"]:
            result["error"] = header[:240].decode(errors="replace")
            result["verdict"] = "REJECTED"
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
                t = int(msg.identity)
            except (AttributeError, ValueError):
                continue
            result["rtcm_total"] += 1
            types[t] += 1
            if t in _MSM:
                result["msm_count"] += 1
                msm_types[t] += 1
            if len(first) < 10:
                first.append(t)

        result["msg_types"] = dict(sorted(types.items()))
        result["msm_types"] = dict(sorted(msm_types.items()))
        result["first_msgs"] = first
        if result["msm_count"] > 0:
            result["verdict"] = "MSM_STREAMING"
        elif result["rtcm_total"] > 0:
            result["verdict"] = "RTCM_NO_MSM"
        else:
            result["verdict"] = "CONNECTED_NO_DATA"
    except Exception as exc:
        result["error"] = str(exc)
        result["verdict"] = "OFFLINE"
    finally:
        if sock is not None:
            try:
                sock.close()
            except Exception:
                pass
    return result


def main() -> None:
    mps = parse_mountpoints()
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    print("=" * 72)
    print("LIVE NTRIP VERIFICATION (real data from caster — no dummy results)")
    print(f"Caster: {HOST}:{PORT}")
    print(f"Account: {USER}")
    print(f"Time: {now}")
    print("=" * 72)

    print("\n--- Vendor screenshot sites (Site Status page) ---\n")
    for st in ["beit", "bing", "bula", "cent", "chim"]:
        r = probe(st, mps[st], listen_sec=12)
        print(f"Station: {st.upper()}  mountpoint={r['mountpoint']}  vendor={r['vendor_status']}")
        print(f"  TCP connect:     {r['tcp_ok']}")
        print(f"  Caster HTTP:     {r['http_status']}")
        print(f"  Verdict:         {r['verdict']}")
        if r["error"]:
            print(f"  Error:           {r['error']}")
        print(f"  RTCM messages:   {r['rtcm_total']}")
        print(f"  MSM messages:    {r['msm_count']}  (required for VTEC pipeline)")
        print(f"  RTCM types:      {r['msg_types']}")
        if r["msm_types"]:
            print(f"  MSM types:       {r['msm_types']}")
        print(f"  First messages:  {r['first_msgs']}")
        print()

    print("--- All 24 mountpoints (8 second listen each) ---\n")
    print(f"{'Station':<7} {'Mount':<6} {'Vendor':<8} {'Verdict':<18} {'RTCM':>5} {'MSM':>5}  Types")
    rows = []
    for st, mp in sorted(mps.items()):
        r = probe(st, mp, listen_sec=8)
        rows.append(r)
        vendor = r["vendor_status"]
        types_str = str(r["msg_types"]) if r["msg_types"] else "-"
        print(
            f"{st:<7} {mp:<6} {vendor:<8} {r['verdict']:<18} "
            f"{r['rtcm_total']:>5} {r['msm_count']:>5}  {types_str}"
        )

    msm_active = [r["station"] for r in rows if r["msm_count"] > 0]
    connected = [r["station"] for r in rows if r["caster_ok"]]
    print()
    print("=" * 72)
    print(f"CONNECTED (caster HTTP 200): {len(connected)}/24")
    print(f"MSM STREAMING (VTEC-usable): {len(msm_active)}/24 -> {', '.join(msm_active) or 'none'}")
    print("=" * 72)
    print()
    print("MEANING:")
    print("  Vendor 'up' = receiver/site hardware online on their network")
    print("  Our 'MSM_STREAMING' = caster is sending MSM4/7 observation RTCM right now")
    print("  RTCM_NO_MSM = connected but only non-observation RTCM (e.g. 1006 station info)")
    print("  CONNECTED_NO_DATA = caster accepts mountpoint but sent zero bytes in window")
    print("  Our VTEC app only counts MSM_STREAMING as 'online' on the map")


if __name__ == "__main__":
    main()
