"""Load WhatsApp broadcast recipients from a private server-side JSON file."""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any

from zgiis.db.broadcast_recipient_db import BroadcastRecipientDB, normalize_recipient_address, VALID_AUDIENCES, VALID_TYPES

log = logging.getLogger(__name__)

_DEFAULT_FILE = Path(__file__).resolve().parents[2] / "static" / "data" / "broadcast_recipients.private.json"


def recipients_file_path() -> Path:
    raw = os.getenv("BROADCAST_RECIPIENTS_FILE", "").strip()
    return Path(raw) if raw else _DEFAULT_FILE


def load_recipients_file(path: Path | None = None) -> list[dict[str, Any]]:
    """Return recipient rows from the private JSON file (empty if missing)."""
    file_path = path or recipients_file_path()
    if not file_path.is_file():
        return []
    try:
        payload = json.loads(file_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        log.warning("Could not read broadcast recipients file %s: %s", file_path, exc)
        return []

    if isinstance(payload, dict):
        rows = payload.get("recipients") or []
    elif isinstance(payload, list):
        rows = payload
    else:
        log.warning("Invalid broadcast recipients file format in %s", file_path)
        return []

    out: list[dict[str, Any]] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        whatsapp_to = str(row.get("whatsapp_to") or row.get("phone") or "").strip()
        display_name = str(row.get("display_name") or row.get("name") or "").strip()
        audience = str(row.get("audience") or "citizen").strip().lower()
        recipient_type = str(row.get("recipient_type") or row.get("type") or "phone").strip().lower()
        language = str(row.get("language") or row.get("lang") or "en").strip().lower()
        accessibility = str(row.get("accessibility") or row.get("access") or "standard").strip().lower()
        if not whatsapp_to or not display_name:
            continue
        if audience not in VALID_AUDIENCES:
            log.warning("Skipping recipient %s — invalid audience %s", display_name, audience)
            continue
        if recipient_type not in VALID_TYPES:
            recipient_type = "phone"
        out.append(
            {
                "recipient_type": recipient_type,
                "whatsapp_to": whatsapp_to,
                "display_name": display_name,
                "audience": audience,
                "script_kind": str(row.get("script_kind") or "broadcast").strip().lower(),
                "language": language,
                "accessibility": accessibility,
                "notes": row.get("notes"),
                "active": bool(row.get("active", True)),
            }
        )
    return out


def sync_recipients_from_file(*, path: Path | None = None) -> dict[str, Any]:
    """Upsert recipients from the private file into SQLite."""
    file_path = path or recipients_file_path()
    rows = load_recipients_file(file_path)
    if not rows:
        return {"ok": True, "file": str(file_path), "synced": 0, "skipped": 0, "reason": "no entries"}

    db = BroadcastRecipientDB()
    synced = 0
    skipped = 0
    errors: list[str] = []

    try:
        existing = {r["whatsapp_to"]: r for r in db.list_recipients()}
        for row in rows:
            try:
                to_norm = normalize_recipient_address(row["whatsapp_to"], recipient_type=row["recipient_type"])
                row = {**row, "whatsapp_to": to_norm}
                if to_norm in existing:
                    rec = existing[to_norm]
                    db.update_recipient(
                        rec["recipient_id"],
                        recipient_type=row["recipient_type"],
                        display_name=row["display_name"],
                        audience=row["audience"],
                        script_kind=row["script_kind"],
                        language=row.get("language", "en"),
                        accessibility=row.get("accessibility", "standard"),
                        notes=row.get("notes"),
                        active=row["active"],
                    )
                else:
                    db.create_recipient(**row)
                synced += 1
            except Exception as exc:
                skipped += 1
                errors.append(f"{row.get('display_name', '?')}: {exc}")
                log.warning("Broadcast recipient sync skipped for %s: %s", row.get("display_name"), exc)
    finally:
        db.close()

    return {
        "ok": not errors or synced > 0,
        "file": str(file_path),
        "synced": synced,
        "skipped": skipped,
        "errors": errors[:10],
    }
