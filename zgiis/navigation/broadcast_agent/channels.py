"""Delivery channel adapters for Navigation News broadcasts."""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

import requests

log = logging.getLogger("zgiis.broadcast.channels")


@dataclass
class DeliveryResult:
    channel: str
    audience: str
    script_kind: str
    ok: bool
    detail: str
    dry_run: bool = False


class Channel(Protocol):
    name: str

    def send(
        self,
        *,
        audience: str,
        script_kind: str,
        text: str,
        brief: dict[str, Any],
        dry_run: bool,
        options: dict[str, str],
    ) -> DeliveryResult: ...


class ConsoleChannel:
    name = "console"

    def send(self, *, audience: str, script_kind: str, text: str, brief: dict[str, Any], dry_run: bool, options: dict[str, str]) -> DeliveryResult:
        prefix = "[DRY-RUN] " if dry_run else ""
        print(f"\n{prefix}=== {audience.upper()} / {script_kind} / {self.name} ===")
        print(text)
        print("=" * 60)
        return DeliveryResult(self.name, audience, script_kind, True, "printed", dry_run=dry_run)


class FileChannel:
    name = "file"

    def __init__(self, out_dir: str | Path) -> None:
        self.out_dir = Path(out_dir)

    def send(self, *, audience: str, script_kind: str, text: str, brief: dict[str, Any], dry_run: bool, options: dict[str, str]) -> DeliveryResult:
        self.out_dir.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        path = self.out_dir / f"{ts}_{audience}_{script_kind}.txt"
        path.write_text(text, encoding="utf-8")
        log.info("Wrote %s", path)
        return DeliveryResult(self.name, audience, script_kind, True, str(path), dry_run=dry_run)


class WebhookChannel:
    name = "webhook"

    def send(self, *, audience: str, script_kind: str, text: str, brief: dict[str, Any], dry_run: bool, options: dict[str, str]) -> DeliveryResult:
        import os

        url = options.get("url") or os.getenv("BROADCAST_WEBHOOK_URL", "")
        if not url:
            return DeliveryResult(self.name, audience, script_kind, False, "missing webhook url")

        payload = {
            "source": "zingsa-navigation-news",
            "audience": audience,
            "script_kind": script_kind,
            "headline": brief.get("headline"),
            "status_tone": brief.get("status_tone"),
            "computed_at": brief.get("_computed_at"),
            "text": text,
            "broadcast_script": brief.get("broadcast_script"),
            "social_script": brief.get("social_script"),
        }
        if dry_run:
            log.info("DRY-RUN webhook %s payload keys=%s", url, list(payload.keys()))
            return DeliveryResult(self.name, audience, script_kind, True, f"dry-run {url}", dry_run=True)

        res = requests.post(url, json=payload, timeout=30)
        ok = res.status_code < 400
        return DeliveryResult(self.name, audience, script_kind, ok, f"HTTP {res.status_code}")


class WhatsAppCloudChannel:
    """Meta WhatsApp Cloud API — text messages to a phone or group recipient id."""

    name = "whatsapp"

    def send(self, *, audience: str, script_kind: str, text: str, brief: dict[str, Any], dry_run: bool, options: dict[str, str]) -> DeliveryResult:
        import os

        token = os.getenv("WHATSAPP_ACCESS_TOKEN", "").strip()
        phone_id = os.getenv("WHATSAPP_PHONE_NUMBER_ID", "").strip()
        to = options.get("to") or os.getenv(f"BROADCAST_{audience.upper()}_WHATSAPP_TO", "").strip()

        if not all([token, phone_id, to]):
            return DeliveryResult(
                self.name, audience, script_kind, False,
                "missing WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, or recipient 'to'",
            )

        # WhatsApp has a 4096 char limit; trim with notice if needed
        body = text if len(text) <= 4000 else text[:3950] + "\n\n…(truncated)"

        if dry_run:
            log.info("DRY-RUN WhatsApp to=%s len=%d", to, len(body))
            return DeliveryResult(self.name, audience, script_kind, True, f"dry-run to {to}", dry_run=True)

        url = f"https://graph.facebook.com/v19.0/{phone_id}/messages"
        res = requests.post(
            url,
            headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            json={
                "messaging_product": "whatsapp",
                "to": to,
                "type": "text",
                "text": {"preview_url": False, "body": body},
            },
            timeout=30,
        )
        ok = res.status_code < 400
        detail = res.text[:200] if not ok else "sent"
        return DeliveryResult(self.name, audience, script_kind, ok, detail)


class FacebookPageChannel:
    """Post social_script to a Facebook Page feed."""

    name = "facebook"

    def send(self, *, audience: str, script_kind: str, text: str, brief: dict[str, Any], dry_run: bool, options: dict[str, str]) -> DeliveryResult:
        import os

        token = options.get("page_token") or os.getenv("FACEBOOK_PAGE_ACCESS_TOKEN", "").strip()
        page_id = options.get("page_id") or os.getenv("FACEBOOK_PAGE_ID", "").strip()
        if not token or not page_id:
            return DeliveryResult(self.name, audience, script_kind, False, "missing FACEBOOK_PAGE_ACCESS_TOKEN or FACEBOOK_PAGE_ID")

        message = text if len(text) <= 5000 else text[:4950] + "…"

        if dry_run:
            log.info("DRY-RUN Facebook page %s", page_id)
            return DeliveryResult(self.name, audience, script_kind, True, "dry-run", dry_run=True)

        url = f"https://graph.facebook.com/v19.0/{page_id}/feed"
        res = requests.post(url, params={"access_token": token, "message": message}, timeout=30)
        ok = res.status_code < 400
        return DeliveryResult(self.name, audience, script_kind, ok, res.text[:200])


class TwitterChannel:
    """Post social_script via X (Twitter) API v2."""

    name = "twitter"

    def send(self, *, audience: str, script_kind: str, text: str, brief: dict[str, Any], dry_run: bool, options: dict[str, str]) -> DeliveryResult:
        import os

        bearer = os.getenv("TWITTER_BEARER_TOKEN", "").strip()
        if not bearer:
            return DeliveryResult(self.name, audience, script_kind, False, "missing TWITTER_BEARER_TOKEN")

        tweet = text if len(text) <= 280 else text[:277] + "…"

        if dry_run:
            log.info("DRY-RUN Twitter len=%d", len(tweet))
            return DeliveryResult(self.name, audience, script_kind, True, "dry-run", dry_run=True)

        res = requests.post(
            "https://api.twitter.com/2/tweets",
            headers={"Authorization": f"Bearer {bearer}", "Content-Type": "application/json"},
            json={"text": tweet},
            timeout=30,
        )
        ok = res.status_code < 400
        return DeliveryResult(self.name, audience, script_kind, ok, res.text[:200])


def build_channel(name: str, *, out_dir: str) -> Channel | None:
    if name == "console":
        return ConsoleChannel()
    if name == "file":
        return FileChannel(out_dir)
    if name == "webhook":
        return WebhookChannel()
    if name == "whatsapp":
        return WhatsAppCloudChannel()
    if name == "facebook":
        return FacebookPageChannel()
    if name == "twitter":
        return TwitterChannel()
    log.warning("Unknown channel: %s", name)
    return None
