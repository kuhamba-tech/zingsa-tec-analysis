"""NTRIP caster client for ZINGSACORS — credentials loaded from st.secrets."""
from __future__ import annotations

import base64
import socket
import ssl
from typing import Optional

try:
    import streamlit as st
    _ST_AVAILABLE = True
except ImportError:
    _ST_AVAILABLE = False


def _ntrip_cfg() -> dict:
    """Return NTRIP config from st.secrets, falling back to safe defaults."""
    if _ST_AVAILABLE:
        try:
            cfg = st.secrets.get("ntrip", {})
            if cfg:
                return dict(cfg)
        except Exception:
            pass
    return {}


def _auth_header(username: str, password: str, method: str = "Basic") -> str:
    token = base64.b64encode(f"{username}:{password}".encode()).decode()
    return f"Authorization: {method} {token}\r\n"


def get_sourcetable(timeout: int = 10) -> Optional[str]:
    """
    Fetch the NTRIP sourcetable from the ZINGSACORS caster.
    Returns the raw sourcetable string, or None if unavailable/misconfigured.
    """
    cfg = _ntrip_cfg()
    if not cfg:
        return None

    host = cfg.get("host", "")
    port = int(cfg.get("port", 2101))
    username = cfg.get("username", "")
    password = cfg.get("password", "")
    use_tls = str(cfg.get("connection", "TCP")).upper() == "TLS"
    auth_method = cfg.get("auth_method", "Basic")
    ntrip_ver = int(cfg.get("ntrip_version", 2))

    if not host or username.startswith("REPLACE_") or password.startswith("REPLACE_"):
        return None

    try:
        raw = socket.create_connection((host, port), timeout=timeout)
        sock = ssl.wrap_socket(raw) if use_tls else raw

        if ntrip_ver >= 2:
            request = (
                f"GET / HTTP/1.1\r\n"
                f"Host: {host}:{port}\r\n"
                f"Ntrip-Version: Ntrip/2.0\r\n"
                f"User-Agent: ZGIIS/1.0\r\n"
                + _auth_header(username, password, auth_method)
                + "\r\n"
            )
        else:
            request = (
                f"GET / HTTP/1.0\r\n"
                f"User-Agent: ZGIIS/1.0\r\n"
                + _auth_header(username, password, auth_method)
                + "\r\n"
            )

        sock.sendall(request.encode())

        response = b""
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            response += chunk
            if b"ENDSOURCETABLE" in response:
                break

        sock.close()
        return response.decode(errors="replace")
    except Exception:
        return None


def check_connection() -> dict:
    """
    Test connectivity to the ZINGSACORS caster.
    Returns a dict with keys: connected (bool), message (str).
    """
    cfg = _ntrip_cfg()
    if not cfg:
        return {"connected": False, "message": "NTRIP credentials not configured in .streamlit/secrets.toml"}

    host = cfg.get("host", "")
    port = int(cfg.get("port", 2101))
    username = cfg.get("username", "")
    password = cfg.get("password", "")

    if not host:
        return {"connected": False, "message": "NTRIP host not set in secrets.toml"}
    if username.startswith("REPLACE_") or password.startswith("REPLACE_"):
        return {"connected": False, "message": "NTRIP credentials not yet set in .streamlit/secrets.toml"}

    try:
        with socket.create_connection((host, port), timeout=8):
            pass
        return {
            "connected": True,
            "message": f"TCP connection to {host}:{port} succeeded",
            "host": host,
            "port": port,
        }
    except OSError as exc:
        return {"connected": False, "message": f"Cannot reach {host}:{port} — {exc}"}
