"""Vercel consolidated dispatcher for all /processing/* routes.

The RINEX/CMN Processing feature had no Vercel function coverage at all
before this -- it only ever worked against a local dev backend. Routes
here include a dynamic {session_id} path segment (status/summary/hourly/
bias/tec-plot/raw), which is exactly what Vercel's own file-based dynamic
routing ([...path].py) can't reliably serve -- but FastAPI's *own*
internal routing handles {session_id} fine once a request reaches this
function, so forwarding the real incoming path via a vercel.json rewrite
("/api/processing/:path*") works where a dynamic route file did not. See
backend/vercel_dispatch.py's make_group_dispatcher.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.vercel_dispatch import make_group_dispatcher  # noqa: E402

app = make_group_dispatcher()
