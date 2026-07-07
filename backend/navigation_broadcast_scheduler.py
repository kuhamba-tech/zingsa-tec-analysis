"""Background scheduler — Navigation News WhatsApp every 4 hours to registered recipients."""
from __future__ import annotations

import logging
import os
import threading
from datetime import datetime, timedelta, timezone

log = logging.getLogger(__name__)

_thread: threading.Thread | None = None
_stop = threading.Event()
_last_run_at: datetime | None = None


def _interval_sec() -> float:
    # Default 4 hours — matches Navigation News content refresh cadence.
    hours = float(os.getenv("NAV_BROADCAST_INTERVAL_HOURS", "4"))
    return max(300.0, hours * 3600.0)


def _enabled() -> bool:
    raw = os.getenv("NAV_BROADCAST_ENABLED", "true").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def run_broadcast_now(
    *,
    force: bool = True,
    dry_run_override: bool | None = None,
    whatsapp_only: bool = False,
) -> dict:
    from zgiis.navigation.broadcast_recipient_dispatch import dispatch_to_registered_recipients
    from zgiis.navigation.facebook_publish import publish_navigation_news_to_facebook

    global _last_run_at
    result = dispatch_to_registered_recipients(force=force, dry_run_override=dry_run_override)
    if not whatsapp_only:
        fb = publish_navigation_news_to_facebook()
        result["facebook"] = fb
    _last_run_at = datetime.now(tz=timezone.utc)
    if result.get("skipped"):
        log.info("Navigation broadcast skipped: %s", result.get("reason"))
    else:
        ok_count = sum(1 for d in result.get("deliveries", []) if d.get("ok"))
        log.info(
            "Navigation broadcast finished — %d/%d WhatsApp ok, Facebook ok=%s (dry_run=%s)",
            ok_count,
            result.get("recipient_count", 0),
            (result.get("facebook") or {}).get("ok"),
            result.get("dry_run"),
        )
    return result


def _loop() -> None:
    interval = _interval_sec()
    log.info("Navigation News broadcast scheduler started (every %.0fs)", interval)
    while not _stop.wait(interval):
        try:
            run_broadcast_now(force=True)
        except Exception as exc:
            log.exception("Scheduled navigation broadcast failed: %s", exc)


def start() -> None:
    global _thread
    if not _enabled():
        log.info("Navigation News broadcast scheduler disabled (NAV_BROADCAST_ENABLED=false)")
        return
    try:
        from zgiis.navigation.broadcast_recipients_file import sync_recipients_from_file

        sync_recipients_from_file()
    except Exception as exc:
        log.warning("Broadcast recipient file sync on start failed: %s", exc)
    if _thread and _thread.is_alive():
        return
    _stop.clear()
    _thread = threading.Thread(target=_loop, name="nav-broadcast-scheduler", daemon=True)
    _thread.start()


def stop() -> None:
    _stop.set()
    global _thread
    if _thread:
        _thread.join(timeout=3.0)
        _thread = None


def status() -> dict:
    from zgiis.db.broadcast_recipient_db import BroadcastRecipientDB
    from zgiis.navigation.broadcast_recipient_dispatch import _dry_run, whatsapp_configured
    from zgiis.navigation.facebook_status import facebook_status_payload

    interval = _interval_sec()
    db = BroadcastRecipientDB()
    recipients = db.list_recipients(active_only=True)
    last_db = db.last_broadcast_at()
    now = datetime.now(tz=timezone.utc)

    last_run = _last_run_at.isoformat() if _last_run_at else last_db
    next_run = None
    if last_run:
        try:
            last_dt = datetime.fromisoformat(last_run.replace("Z", "+00:00"))
            next_run = (last_dt + timedelta(seconds=interval)).isoformat()
        except ValueError:
            next_run = (now + timedelta(seconds=interval)).isoformat()
    else:
        next_run = (now + timedelta(seconds=interval)).isoformat()

    return {
        "enabled": _enabled(),
        "running": bool(_thread and _thread.is_alive()),
        "interval_hours": interval / 3600.0,
        "last_broadcast_at": last_run,
        "next_broadcast_at": next_run,
        "active_recipient_count": len(recipients),
        "whatsapp_configured": whatsapp_configured(),
        "dry_run": _dry_run(),
        "recent_deliveries": db.recent_deliveries(limit=10),
        "facebook": facebook_status_payload(),
    }
