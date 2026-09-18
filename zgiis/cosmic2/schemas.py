"""Internal helpers for the COSMIC-2 module. Not a duplicate of
backend/schemas.py, which stays the single source of truth for the API
contract."""
from __future__ import annotations

from datetime import date, timedelta


def daterange(start: date, end: date, *, max_days: int) -> list[date]:
    """Inclusive list of days from start to end, capped at max_days.
    Callers (the /analyse endpoint) should reject ranges that would be
    truncated by this cap rather than silently processing a partial range."""
    if end < start:
        start, end = end, start
    days = min((end - start).days + 1, max_days)
    return [start + timedelta(days=i) for i in range(days)]
