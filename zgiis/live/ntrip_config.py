"""Shared NTRIP environment parsing helpers."""

from __future__ import annotations

import os
from urllib.parse import urlsplit


def ntrip_host_from_env() -> str:
    """Return a socket-ready NTRIP host, accepting either host or URL input."""
    host = os.getenv("NTRIP_HOST", "").strip().strip('"').strip("'")
    if "://" not in host:
        return host
    parsed = urlsplit(host)
    return parsed.hostname or host
