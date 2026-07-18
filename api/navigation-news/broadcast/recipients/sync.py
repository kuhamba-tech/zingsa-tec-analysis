"""Vercel named-route dispatcher for /navigation-news/broadcast/recipients/sync (see backend/vercel_dispatch.py
for why this must be a statically-named file, not a dynamic route)."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[4]))

from backend.vercel_dispatch import make_dispatcher  # noqa: E402

app = make_dispatcher("/navigation-news/broadcast/recipients/sync")
