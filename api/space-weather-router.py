"""Vercel consolidated dispatcher for all /space-weather/* routes.

Replaces one function-file per route (current.py, report.py,
solar-activity.py, timelines.py) with a single function, paired with
vercel.json's "/api/space-weather/:path*" rewrite -- see
backend/vercel_dispatch.py's make_group_dispatcher.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.vercel_dispatch import make_group_dispatcher  # noqa: E402

app = make_group_dispatcher()
