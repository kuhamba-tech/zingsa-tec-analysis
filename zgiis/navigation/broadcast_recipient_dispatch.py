"""Dispatch Navigation News to registered WhatsApp recipients."""
from __future__ import annotations

import logging
import os
from typing import Any

from zgiis.db.broadcast_recipient_db import BroadcastRecipientDB
from zgiis.navigation.broadcast_agent.channels import WhatsAppCloudChannel
from zgiis.navigation.brief_renderer import render_brief_for_recipient

log = logging.getLogger(__name__)


def _dry_run() -> bool:
    raw = os.getenv("BROADCAST_DRY_RUN", "true").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def whatsapp_configured() -> bool:
    token = os.getenv("WHATSAPP_ACCESS_TOKEN", "").strip()
    phone_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "").strip()
    return bool(token and phone_id)


def dispatch_to_registered_recipients(
    *,
    force: bool = True,
    refresh_ntrip: bool = False,
) -> dict[str, Any]:
    """Send the latest Navigation News brief to every active registered recipient.

    `force` is ignored for schedule sends — registered recipients always receive
    on each 4-hour cycle even when script text is unchanged.
    """
    from backend.routers.navigation_news import get_navigation_news_bundle
    from zgiis.navigation.broadcast_recipients_file import sync_recipients_from_file

    sync_recipients_from_file()

    db = BroadcastRecipientDB()
    recipients = db.list_recipients(active_only=True)
    dry = _dry_run()

    if not recipients:
        return {
            "ok": True,
            "skipped": True,
            "reason": "no active registered recipients",
            "deliveries": [],
            "dry_run": dry,
        }

    bundle = get_navigation_news_bundle(refresh_ntrip=refresh_ntrip, force=False)
    briefs_by_id = {b.id: b.model_dump() for b in bundle.briefs}
    channel = WhatsAppCloudChannel()
    deliveries: list[dict[str, Any]] = []
    all_ok = True

    for rec in recipients:
        audience = rec["audience"]
        brief = briefs_by_id.get(audience)
        if not brief:
            detail = f"no brief for audience '{audience}'"
            db.log_delivery(
                recipient_id=rec["recipient_id"],
                display_name=rec["display_name"],
                whatsapp_to=rec["whatsapp_to"],
                audience=audience,
                ok=False,
                detail=detail,
                dry_run=dry,
            )
            deliveries.append({**rec, "ok": False, "detail": detail})
            all_ok = False
            continue

        script_kind = rec.get("script_kind") or "broadcast"
        text = render_brief_for_recipient(
            brief,
            language=rec.get("language"),
            accessibility=rec.get("accessibility"),
            script_kind=script_kind,
        )
        text = str(text or "").strip()
        if not text:
            detail = "empty script"
            db.log_delivery(
                recipient_id=rec["recipient_id"],
                display_name=rec["display_name"],
                whatsapp_to=rec["whatsapp_to"],
                audience=audience,
                ok=False,
                detail=detail,
                dry_run=dry,
            )
            deliveries.append({**rec, "ok": False, "detail": detail})
            all_ok = False
            continue

        try:
            result = channel.send(
                audience=audience,
                script_kind=script_kind,
                text=text,
                brief={**brief, "_computed_at": bundle.computed_at},
                dry_run=dry,
                options={
                    "to": rec["whatsapp_to"],
                    "recipient_type": rec.get("recipient_type") or "phone",
                },
            )
            ok = result.ok
            detail = result.detail
        except Exception as exc:
            log.exception("WhatsApp send failed for %s", rec["display_name"])
            ok = False
            detail = str(exc)

        db.log_delivery(
            recipient_id=rec["recipient_id"],
            display_name=rec["display_name"],
            whatsapp_to=rec["whatsapp_to"],
            audience=audience,
            ok=ok,
            detail=detail,
            dry_run=dry,
        )
        deliveries.append({
            "recipient_id": rec["recipient_id"],
            "display_name": rec["display_name"],
            "whatsapp_to": rec["whatsapp_to"],
            "audience": audience,
            "ok": ok,
            "detail": detail,
        })
        if not ok:
            all_ok = False

    return {
        "ok": all_ok,
        "skipped": False,
        "recipient_count": len(recipients),
        "deliveries": deliveries,
        "dry_run": dry,
        "headline": bundle.briefs[0].headline if bundle.briefs else None,
        "computed_at": bundle.computed_at,
    }
