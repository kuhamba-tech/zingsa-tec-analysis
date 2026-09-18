"""Registered WhatsApp recipients for Navigation News broadcasts."""
from __future__ import annotations

import re
import sqlite3
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

from zgiis.navigation.delivery_preferences import normalize_accessibility, normalize_language

AudienceId = Literal["citizen", "farmer", "surveyor", "driver", "aviation", "scientist"]
RecipientType = Literal["phone", "group"]
ScriptKind = Literal["broadcast", "social"]

VALID_AUDIENCES = frozenset({"citizen", "farmer", "surveyor", "driver", "aviation", "scientist"})
VALID_TYPES = frozenset({"phone", "group"})
VALID_SCRIPTS = frozenset({"broadcast", "social"})

_SQLITE_PATH = Path(__file__).resolve().parents[2] / "static" / "data" / "broadcast_recipients.sqlite"

_DDL = """
CREATE TABLE IF NOT EXISTS broadcast_recipients (
    recipient_id   TEXT PRIMARY KEY,
    recipient_type TEXT NOT NULL,
    whatsapp_to    TEXT NOT NULL UNIQUE,
    display_name   TEXT NOT NULL,
    audience       TEXT NOT NULL DEFAULT 'citizen',
    script_kind    TEXT NOT NULL DEFAULT 'broadcast',
    language       TEXT NOT NULL DEFAULT 'en',
    accessibility  TEXT NOT NULL DEFAULT 'standard',
    active         INTEGER NOT NULL DEFAULT 1,
    notes          TEXT,
    created_at     TEXT NOT NULL,
    updated_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS broadcast_recipients_active_idx ON broadcast_recipients (active);

CREATE TABLE IF NOT EXISTS broadcast_delivery_log (
    delivery_id    TEXT PRIMARY KEY,
    recipient_id   TEXT,
    display_name   TEXT,
    whatsapp_to    TEXT,
    audience       TEXT,
    ok             INTEGER NOT NULL,
    detail         TEXT,
    dry_run        INTEGER NOT NULL DEFAULT 0,
    sent_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS broadcast_delivery_sent_idx ON broadcast_delivery_log (sent_at DESC);
"""


def normalize_whatsapp_to(raw: str) -> str:
    """Normalize a phone recipient — Meta Cloud API expects country code without '+'."""
    return normalize_recipient_address(raw, recipient_type="phone")


def _normalize_single_number(value: str) -> str:
    digits = re.sub(r"\D", "", value)
    if len(digits) < 8:
        raise ValueError(f"WhatsApp number '{value}' must have at least 8 digits")
    if len(digits) > 20:
        raise ValueError(f"WhatsApp number '{value}' is too long")
    return digits


def normalize_recipient_address(raw: str, *, recipient_type: str = "phone") -> str:
    """Normalize a recipient address to E.164 digits.

    Meta's WhatsApp Cloud API has no endpoint to list or message WhatsApp
    groups — only individual phone numbers are addressable. To still support
    "send to a WhatsApp group", recipient_type="group" stores the group's
    member numbers as a comma-separated list; delivery fans out and sends
    the same message to each member's individual chat.
    """
    rtype = recipient_type.strip().lower()
    if rtype not in VALID_TYPES:
        raise ValueError(f"recipient_type must be one of: {', '.join(sorted(VALID_TYPES))}")

    value = (raw or "").strip()
    if not value:
        raise ValueError("WhatsApp recipient address is required")

    if rtype == "group":
        parts = [p.strip() for p in value.split(",") if p.strip()]
        if not parts:
            raise ValueError("Group must list at least one member WhatsApp number")
        seen: list[str] = []
        for part in parts:
            digits = _normalize_single_number(part)
            if digits not in seen:
                seen.append(digits)
        return ",".join(seen)

    return _normalize_single_number(value)


def _utc_now() -> str:
    return datetime.now(tz=timezone.utc).isoformat()


class BroadcastRecipientDB:
    def __init__(self) -> None:
        try:
            _SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)
            self._conn = sqlite3.connect(str(_SQLITE_PATH), check_same_thread=False)
        except (OSError, sqlite3.OperationalError):
            fallback = Path(tempfile.gettempdir()) / _SQLITE_PATH.name
            self._conn = sqlite3.connect(str(fallback), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_DDL)
        self._migrate_columns()
        self._conn.commit()

    def _migrate_columns(self) -> None:
        cols = {row[1] for row in self._conn.execute("PRAGMA table_info(broadcast_recipients)")}
        if "language" not in cols:
            self._conn.execute("ALTER TABLE broadcast_recipients ADD COLUMN language TEXT NOT NULL DEFAULT 'en'")
        if "accessibility" not in cols:
            self._conn.execute("ALTER TABLE broadcast_recipients ADD COLUMN accessibility TEXT NOT NULL DEFAULT 'standard'")

    def _row_to_recipient(self, row: sqlite3.Row) -> dict[str, Any]:
        keys = row.keys()
        return {
            "recipient_id": row["recipient_id"],
            "recipient_type": row["recipient_type"],
            "whatsapp_to": row["whatsapp_to"],
            "display_name": row["display_name"],
            "audience": row["audience"],
            "script_kind": row["script_kind"],
            "language": row["language"] if "language" in keys else "en",
            "accessibility": row["accessibility"] if "accessibility" in keys else "standard",
            "active": bool(row["active"]),
            "notes": row["notes"],
            "created_at": row["created_at"],
            "updated_at": row["updated_at"],
        }

    def list_recipients(self, *, active_only: bool = False) -> list[dict[str, Any]]:
        sql = "SELECT * FROM broadcast_recipients"
        if active_only:
            sql += " WHERE active = 1"
        sql += " ORDER BY display_name COLLATE NOCASE"
        rows = self._conn.execute(sql).fetchall()
        return [self._row_to_recipient(r) for r in rows]

    def get_recipient(self, recipient_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM broadcast_recipients WHERE recipient_id = ?",
            (recipient_id,),
        ).fetchone()
        return self._row_to_recipient(row) if row else None

    def create_recipient(
        self,
        *,
        recipient_type: str,
        whatsapp_to: str,
        display_name: str,
        audience: str = "citizen",
        script_kind: str = "broadcast",
        language: str = "en",
        accessibility: str = "standard",
        notes: str | None = None,
        active: bool = True,
    ) -> dict[str, Any]:
        rtype = recipient_type.strip().lower()
        aud = audience.strip().lower()
        script = script_kind.strip().lower()
        lang = normalize_language(language)
        access = normalize_accessibility(accessibility)
        if rtype not in VALID_TYPES:
            raise ValueError(f"recipient_type must be one of: {', '.join(sorted(VALID_TYPES))}")
        if aud not in VALID_AUDIENCES:
            raise ValueError(f"audience must be one of: {', '.join(sorted(VALID_AUDIENCES))}")
        if script not in VALID_SCRIPTS:
            raise ValueError(f"script_kind must be broadcast or social")
        name = display_name.strip()
        if len(name) < 2:
            raise ValueError("display_name is required (min 2 characters)")
        to_norm = normalize_recipient_address(whatsapp_to, recipient_type=rtype)
        if self._conn.execute(
            "SELECT 1 FROM broadcast_recipients WHERE whatsapp_to = ?",
            (to_norm,),
        ).fetchone():
            raise ValueError(f"WhatsApp recipient {to_norm} is already registered")

        now = _utc_now()
        rec_id = str(uuid.uuid4())
        self._conn.execute(
            """
            INSERT INTO broadcast_recipients (
                recipient_id, recipient_type, whatsapp_to, display_name,
                audience, script_kind, language, accessibility, active, notes, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (rec_id, rtype, to_norm, name, aud, script, lang, access, int(active), notes, now, now),
        )
        self._conn.commit()
        return self.get_recipient(rec_id)  # type: ignore[return-value]

    def update_recipient(self, recipient_id: str, **fields: Any) -> dict[str, Any] | None:
        existing = self.get_recipient(recipient_id)
        if not existing:
            return None

        updates: dict[str, Any] = {}
        if "recipient_type" in fields and fields["recipient_type"] is not None:
            rtype = str(fields["recipient_type"]).strip().lower()
            if rtype not in VALID_TYPES:
                raise ValueError(f"recipient_type must be one of: {', '.join(sorted(VALID_TYPES))}")
            updates["recipient_type"] = rtype
        if "whatsapp_to" in fields and fields["whatsapp_to"] is not None:
            rtype = updates.get("recipient_type") or existing["recipient_type"]
            to_norm = normalize_recipient_address(str(fields["whatsapp_to"]), recipient_type=rtype)
            clash = self._conn.execute(
                "SELECT recipient_id FROM broadcast_recipients WHERE whatsapp_to = ? AND recipient_id != ?",
                (to_norm, recipient_id),
            ).fetchone()
            if clash:
                raise ValueError(f"WhatsApp recipient {to_norm} is already registered")
            updates["whatsapp_to"] = to_norm
        if "display_name" in fields and fields["display_name"] is not None:
            name = str(fields["display_name"]).strip()
            if len(name) < 2:
                raise ValueError("display_name is required (min 2 characters)")
            updates["display_name"] = name
        if "audience" in fields and fields["audience"] is not None:
            aud = str(fields["audience"]).strip().lower()
            if aud not in VALID_AUDIENCES:
                raise ValueError(f"audience must be one of: {', '.join(sorted(VALID_AUDIENCES))}")
            updates["audience"] = aud
        if "script_kind" in fields and fields["script_kind"] is not None:
            script = str(fields["script_kind"]).strip().lower()
            if script not in VALID_SCRIPTS:
                raise ValueError("script_kind must be broadcast or social")
            updates["script_kind"] = script
        if "language" in fields and fields["language"] is not None:
            updates["language"] = normalize_language(str(fields["language"]))
        if "accessibility" in fields and fields["accessibility"] is not None:
            updates["accessibility"] = normalize_accessibility(str(fields["accessibility"]))
        if "active" in fields and fields["active"] is not None:
            updates["active"] = int(bool(fields["active"]))
        if "notes" in fields:
            updates["notes"] = fields["notes"]

        if not updates:
            return existing

        updates["updated_at"] = _utc_now()
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        params = list(updates.values()) + [recipient_id]
        self._conn.execute(
            f"UPDATE broadcast_recipients SET {set_clause} WHERE recipient_id = ?",
            params,
        )
        self._conn.commit()
        return self.get_recipient(recipient_id)

    def delete_recipient(self, recipient_id: str) -> bool:
        cur = self._conn.execute(
            "DELETE FROM broadcast_recipients WHERE recipient_id = ?",
            (recipient_id,),
        )
        self._conn.commit()
        return cur.rowcount > 0

    def log_delivery(
        self,
        *,
        recipient_id: str | None,
        display_name: str,
        whatsapp_to: str,
        audience: str,
        ok: bool,
        detail: str,
        dry_run: bool,
    ) -> None:
        self._conn.execute(
            """
            INSERT INTO broadcast_delivery_log (
                delivery_id, recipient_id, display_name, whatsapp_to,
                audience, ok, detail, dry_run, sent_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                str(uuid.uuid4()),
                recipient_id,
                display_name,
                whatsapp_to,
                audience,
                int(ok),
                detail[:500] if detail else "",
                int(dry_run),
                _utc_now(),
            ),
        )
        self._conn.commit()

    def recent_deliveries(self, limit: int = 20) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            """
            SELECT * FROM broadcast_delivery_log
            ORDER BY sent_at DESC LIMIT ?
            """,
            (limit,),
        ).fetchall()
        return [
            {
                "delivery_id": r["delivery_id"],
                "recipient_id": r["recipient_id"],
                "display_name": r["display_name"],
                "whatsapp_to": r["whatsapp_to"],
                "audience": r["audience"],
                "ok": bool(r["ok"]),
                "detail": r["detail"],
                "dry_run": bool(r["dry_run"]),
                "sent_at": r["sent_at"],
            }
            for r in rows
        ]

    def last_broadcast_at(self) -> str | None:
        row = self._conn.execute(
            "SELECT sent_at FROM broadcast_delivery_log ORDER BY sent_at DESC LIMIT 1",
        ).fetchone()
        return row["sent_at"] if row else None

    def close(self) -> None:
        self._conn.close()
