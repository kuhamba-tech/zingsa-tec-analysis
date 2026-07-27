"""Vercel dispatcher for the smaller FastAPI route families.

These endpoints cannot rely on a dynamic catch-all route in this static-export
deployment. The frontend sends their real backend path in ``__zr`` so this
single named function can serve live, forecast, reports, chat, theory, GIC,
and COSMIC-2 routes while staying below Vercel's function-count limit.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.vercel_dispatch import make_group_dispatcher  # noqa: E402

app = make_group_dispatcher()
