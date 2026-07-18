"""Vercel consolidated dispatcher for all /tec/* routes.

Replaces one function-file per route (archive-meta.py, diurnal.py,
guvi-on2.py, seasonal.py, solar-cycle.py, time-series.py) with a single
function, paired with vercel.json's "/api/tec/:path*" rewrite -- see
backend/vercel_dispatch.py's make_group_dispatcher for why this is safe
where a [...path].py dynamic route file was not.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.vercel_dispatch import make_group_dispatcher  # noqa: E402

app = make_group_dispatcher()
