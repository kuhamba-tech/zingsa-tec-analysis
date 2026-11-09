"""Status snapshot for admin UI."""
from __future__ import annotations

from typing import Any

from zgiis.scientific_rag import config
from zgiis.scientific_rag import store


def rag_status() -> dict[str, Any]:
    counts: dict[str, int] = {}
    try:
        counts = store.document_counts()
    except Exception as exc:
        return {
            "enabled": config.rag_enabled(),
            "drive_configured": config.drive_configured(),
            "folder_id_set": bool(config.folder_id()),
            "openai_embeddings_ready": bool((__import__("os").environ.get("OPENAI_API_KEY") or "").strip()),
            "database_ready": False,
            "database_error": str(exc),
            "counts": {},
        }
    return {
        "enabled": config.rag_enabled(),
        "drive_configured": config.drive_configured(),
        "folder_id_set": bool(config.folder_id()),
        "auth_mode": (
            "oauth_refresh"
            if config.oauth_refresh_token() and config.oauth_client_id()
            else "service_account"
            if config.service_account_info()
            else "none"
        ),
        "openai_embeddings_ready": bool((__import__("os").environ.get("OPENAI_API_KEY") or "").strip()),
        "database_ready": True,
        "counts": counts,
        "collections_seeded": True,
    }
