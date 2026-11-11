"""One outage rule shared by the Slack CORS alerts and the Station Uptime page.

A station counts as having an outage only when it stays offline for at least
CORS_OFFLINE_ALERT_MINUTES (default 10). Shorter drops are reported apart as
short drops, so the page and Slack give managers the same outage numbers.
"""
from __future__ import annotations

import os

DEFAULT_OFFLINE_ALERT_MINUTES = 10.0


def offline_alert_minutes() -> float:
    raw = os.getenv("CORS_OFFLINE_ALERT_MINUTES", "").strip()
    try:
        value = float(raw) if raw else DEFAULT_OFFLINE_ALERT_MINUTES
    except ValueError:
        value = DEFAULT_OFFLINE_ALERT_MINUTES
    return max(0.0, value)


def offline_alert_seconds() -> float:
    return offline_alert_minutes() * 60.0
