"""One-shot NTRIP caster sourcetable fetch — cheap discovery request (GET /),
not a per-mountpoint streaming session, used to cross-check whether the
caster's own STR metadata (identifier, coordinates) actually distinguishes
each configured mountpoint or was cloned from a single template."""
from __future__ import annotations

import base64
import os
import socket
import time
from typing import Any

_STR_FIELDS = [
    "mountpoint", "identifier", "format", "format_details", "carrier",
    "nav_system", "network", "country", "lat", "lon", "nmea", "solution",
    "generator", "compression", "authentication", "fee", "bitrate",
]


def _load_ntrip_cfg() -> dict[str, Any]:
    return {
        "host": os.getenv("NTRIP_HOST", "").strip(),
        "port": int(os.getenv("NTRIP_PORT", "2101")),
        "username": os.getenv("NTRIP_USERNAME", "").strip(),
        "password": os.getenv("NTRIP_PASSWORD", "").strip(),
    }


def fetch_sourcetable_text(
    *,
    host: str,
    port: int,
    username: str = "",
    password: str = "",
    connect_timeout: float = 10.0,
    read_timeout: float = 8.0,
) -> str:
    """Issue a single NTRIP sourcetable discovery request (GET /) and return the raw body."""
    sock = socket.create_connection((host, port), timeout=connect_timeout)
    try:
        auth_header = ""
        if username or password:
            token = base64.b64encode(f"{username}:{password}".encode()).decode()
            auth_header = f"Authorization: Basic {token}\r\n"
        request = (
            "GET / HTTP/1.1\r\n"
            f"Host: {host}:{port}\r\n"
            "Ntrip-Version: Ntrip/2.0\r\n"
            "User-Agent: ZGIIS-Sourcetable/1.0\r\n"
            f"{auth_header}"
            "Connection: close\r\n"
            "\r\n"
        )
        sock.sendall(request.encode())
        sock.settimeout(read_timeout)
        chunks: list[bytes] = []
        try:
            while True:
                chunk = sock.recv(4096)
                if not chunk:
                    break
                chunks.append(chunk)
        except socket.timeout:
            pass
        return b"".join(chunks).decode(errors="replace")
    finally:
        try:
            sock.close()
        except Exception:
            pass


def parse_sourcetable(text: str) -> list[dict[str, Any]]:
    """Parse STR (stream) records from a caster sourcetable response body."""
    rows: list[dict[str, Any]] = []
    body = text.split("\r\n\r\n", 1)[-1] if "\r\n\r\n" in text else text
    for line in body.splitlines():
        line = line.strip()
        if not line.startswith("STR;"):
            continue
        parts = line.split(";")[1:]
        row: dict[str, Any] = {}
        for field_name, value in zip(_STR_FIELDS, parts):
            row[field_name] = value
        try:
            row["lat"] = float(row.get("lat") or "nan")
            row["lon"] = float(row.get("lon") or "nan")
        except ValueError:
            row["lat"] = None
            row["lon"] = None
        rows.append(row)
    return rows


def build_diagnostics(
    entries: list[dict[str, Any]],
    mountpoints: dict[str, str],
) -> dict[str, dict[str, Any]]:
    """Cross-check each configured station's mountpoint against the caster's STR
    identifier/coordinates. Flags a mismatch when the caster reports a
    different identifier for this mountpoint — the same signature seen when
    many mountpoint names are wired to (or cloned from) one physical receiver."""
    by_mountpoint = {
        str(e.get("mountpoint", "")).strip().upper(): e for e in entries
    }
    out: dict[str, dict[str, Any]] = {}
    for station_code, mp in mountpoints.items():
        entry = by_mountpoint.get(mp.strip().upper())
        if entry is None:
            continue
        identifier = str(entry.get("identifier") or "").strip()
        mp_clean = mp.strip().upper().rstrip("_")
        mismatch = bool(identifier) and identifier.upper().rstrip("_") != mp_clean
        note = ""
        if mismatch:
            lat, lon = entry.get("lat"), entry.get("lon")
            coord = f" ({lat:.2f}, {lon:.2f})" if lat is not None and lon is not None else ""
            note = (
                f"Caster sourcetable lists this mountpoint's identifier as "
                f"\"{identifier}\"{coord} instead of its own code \"{mp_clean}\" - "
                "may indicate no distinct receiver is wired to this mountpoint."
            )
        out[station_code] = {
            "identifier": identifier,
            "lat": entry.get("lat"),
            "lon": entry.get("lon"),
            "mismatch": mismatch,
            "note": note,
        }
    return out


def fetch_sourcetable_diagnostics(mountpoints: dict[str, str]) -> dict[str, Any]:
    """Fetch the caster sourcetable once and return per-station diagnostics."""
    cfg = _load_ntrip_cfg()
    if not (cfg["host"] and mountpoints):
        return {
            "fetched_at": None,
            "by_station": {},
            "error": "NTRIP host or mountpoints are not configured",
        }
    try:
        text = fetch_sourcetable_text(
            host=cfg["host"], port=cfg["port"],
            username=cfg["username"], password=cfg["password"],
        )
        entries = parse_sourcetable(text)
        by_station = build_diagnostics(entries, mountpoints)
        return {
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "by_station": by_station,
            "error": None,
        }
    except Exception as exc:
        return {
            "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "by_station": {},
            "error": str(exc),
        }
