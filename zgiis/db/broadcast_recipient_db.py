"""Registered WhatsApp recipients for Navigation News broadcasts."""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Literal

from zgiis.db.config import (
    DatabaseUnavailable,
    checkout,
    database_dsn,
    execute_script,
    release,
    schema_init_enabled,
    transaction,
)

log = logging.getLogger(__name__)

from zgiis.navigation.delivery_preferences import normalize_accessibility, normalize_language

AudienceId = Literal["citizen", "farmer", "surveyor", "driver", "aviation", "scientist"]
RecipientType = Literal["phone", "group"]
ScriptKind = Literal["broadcast", "social"]

VALID_AUDIENCES = frozenset({"citizen", "farmer", "surveyor", "driver", "aviation", "scientist"})
VALID_TYPES = frozenset({"phone", "group"})
VALID_SCRIPTS = frozenset({"broadcast", "social"})

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
    active         BOOLEAN NOT NULL DEFAULT TRUE,
    notes          TEXT,
    created_at     TIMESTAMPTZ NOT NULL,
    updated_at     TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS broadcast_recipients_active_idx ON broadcast_recipients (active);

CREATE TABLE IF NOT EXISTS broadcast_delivery_log (
    delivery_id    TEXT PRIMARY KEY,
    recipient_id   TEXT,
    display_name   TEXT,
    whatsapp_to    TEXT,
    audience       TEXT,
    ok             BOOLEAN NOT NULL,
    detail         TEXT,
    dry_run        BOOLEAN NOT NULL DEFAULT FALSE,
    sent_at        TIMESTAMPTZ NOT NULL
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
    def __init__(self, dsn: str | None = None) -> None:
        from psycopg2.extras import RealDictCursor

        self._dsn = database_dsn() if dsn is None else dsn
        if not self._dsn:
            log.error("SUPABASE_DATABASE_URL is not configured")
            raise DatabaseUnavailable("SUPABASE_DATABASE_URL is not configured")
        self._conn = None
        self._cursor_factory = RealDictCursor
        try:
            self._conn = checkout(self._dsn)
            if schema_init_enabled():
                with self._conn.cursor() as cur:
                    execute_script(cur, _DDL)
                    cur.execute(
                        "ALTER TABLE broadcast_recipients ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en'"
                    )
                    cur.execute(
                        "ALTER TABLE broadcast_recipients ADD COLUMN IF NOT EXISTS accessibility TEXT NOT NULL DEFAULT 'standard'"
                    )
        except Exception as exc:
            log.error("BroadcastRecipientDB Postgres init failed: %s", exc)
            raise DatabaseUnavailable("Supabase Postgres init failed") from exc

    def _cursor(self):
        return self._conn.cursor(cursor_factory=self._cursor_factory)

    def _row_to_recipient(self, row) -> dict[str, Any]:
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
            sql += " WHERE active"
        sql += " ORDER BY lower(display_name)"
        with self._cursor() as cur:
            cur.execute(sql)
            rows = cur.fetchall()
        return [self._row_to_recipient(r) for r in rows]

    def get_recipient(self, recipient_id: str) -> dict[str, Any] | None:
        with self._cursor() as cur:
            cur.execute(
                "SELECT * FROM broadcast_recipients WHERE recipient_id = %s",
                (recipient_id,),
            )
            row = cur.fetchone()
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
        now = _utc_now()
        rec_id = str(uuid.uuid4())
        with transaction(self._conn):
            with self._cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM broadcast_recipients WHERE whatsapp_to = %s",
                    (to_norm,),
                )
                existing = cur.fetchone()
            if existing:
                raise ValueError(f"WhatsApp recipient {to_norm} is already registered")
            with self._cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO broadcast_recipients (
                        recipient_id, recipient_type, whatsapp_to, display_name,
                        audience, script_kind, language, accessibility, active, notes, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (rec_id, rtype, to_norm, name, aud, script, lang, access, bool(active), notes, now, now),
                )
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
        clash_to = None
        if "whatsapp_to" in fields and fields["whatsapp_to"] is not None:
            rtype = updates.get("recipient_type") or existing["recipient_type"]
            clash_to = normalize_recipient_address(str(fields["whatsapp_to"]), recipient_type=rtype)
            updates["whatsapp_to"] = clash_to
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
            updates["active"] = bool(fields["active"])
        if "notes" in fields:
            updates["notes"] = fields["notes"]

        if not updates:
            return existing

        updates["updated_at"] = _utc_now()
        set_clause = ", ".join(f"{k} = %s" for k in updates)
        params = list(updates.values()) + [recipient_id]
        with transaction(self._conn):
            if clash_to is not None:
                with self._cursor() as cur:
                    cur.execute(
                        "SELECT recipient_id FROM broadcast_recipients WHERE whatsapp_to = %s AND recipient_id != %s",
                        (clash_to, recipient_id),
                    )
                    if cur.fetchone():
                        raise ValueError(f"WhatsApp recipient {clash_to} is already registered")
            with self._cursor() as cur:
                cur.execute(
                    f"UPDATE broadcast_recipients SET {set_clause} WHERE recipient_id = %s",
                    params,
                )
        return self.get_recipient(recipient_id)

    def delete_recipient(self, recipient_id: str) -> bool:
        with self._cursor() as cur:
            cur.execute(
                "DELETE FROM broadcast_recipients WHERE recipient_id = %s",
                (recipient_id,),
            )
            deleted = cur.rowcount > 0
        self._conn.commit()
        return deleted

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
        with self._cursor() as cur:
            cur.execute(
                """
                INSERT INTO broadcast_delivery_log (
                    delivery_id, recipient_id, display_name, whatsapp_to,
                    audience, ok, detail, dry_run, sent_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    str(uuid.uuid4()),
                    recipient_id,
                    display_name,
                    whatsapp_to,
                    audience,
                    bool(ok),
                    detail[:500] if detail else "",
                    bool(dry_run),
                    _utc_now(),
                ),
            )
        self._conn.commit()

    def recent_deliveries(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._cursor() as cur:
            cur.execute(
                """
                SELECT * FROM broadcast_delivery_log
                ORDER BY sent_at DESC LIMIT %s
                """,
                (limit,),
            )
            rows = cur.fetchall()
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
        with self._cursor() as cur:
            cur.execute(
                "SELECT sent_at FROM broadcast_delivery_log ORDER BY sent_at DESC LIMIT 1",
            )
            row = cur.fetchone()
        if not row:
            return None
        sent = row["sent_at"]
        return sent.isoformat() if hasattr(sent, "isoformat") else sent

    def close(self) -> None:
        conn = getattr(self, "_conn", None)
        self._conn = None
        release(conn)

    def __del__(self) -> None:
        try:
            self.close()
        except Exception:
            pass
