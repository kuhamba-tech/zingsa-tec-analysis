"""Vercel consolidated dispatcher for /navigation-news and all
/navigation-news/* routes.

Replaces one function-file per route (16 files: audiences, delivery-
options, recipients, recommendations, schedule, facebook/*, broadcast/*)
with a single function, paired with vercel.json's "/api/navigation-news"
and "/api/navigation-news/:path*" rewrites -- see
backend/vercel_dispatch.py's make_group_dispatcher.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from backend.vercel_dispatch import make_group_dispatcher  # noqa: E402

app = make_group_dispatcher()
