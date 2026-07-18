"""Vercel named-route dispatcher for /tec/time-series (see backend/vercel_dispatch.py
for why this must be a statically-named file, not a dynamic route)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from backend.vercel_dispatch import make_dispatcher  # noqa: E402

app = make_dispatcher("/tec/time-series")
