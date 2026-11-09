"""Server-only configuration for scientific RAG / Google Drive."""
from __future__ import annotations

import json
import os
from pathlib import Path


def _clean(value: str | None) -> str:
    return (value or "").strip().strip('"').strip("'")


def rag_enabled() -> bool:
    raw = _clean(os.getenv("SCIENTIFIC_RAG_ENABLED") or "true").lower()
    return raw in {"1", "true", "yes", "on"}


def folder_id() -> str:
    """Accept a bare folder ID or a full Google Drive folder URL from env."""
    raw = _clean(os.getenv("GOOGLE_DRIVE_FOLDER_ID") or os.getenv("GOOGLE_DRIVE_FOLDER_URL"))
    if not raw:
        return ""
    if "folders/" in raw:
        part = raw.split("folders/", 1)[1]
        return part.split("?", 1)[0].split("/", 1)[0].strip()
    return raw


def oauth_client_id() -> str:
    return _clean(os.getenv("GOOGLE_DRIVE_OAUTH_CLIENT_ID"))


def oauth_client_secret() -> str:
    return _clean(os.getenv("GOOGLE_DRIVE_OAUTH_CLIENT_SECRET"))


def oauth_refresh_token() -> str:
    return _clean(os.getenv("GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN"))


def service_account_info() -> dict | None:
    raw = _clean(os.getenv("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON"))
    if raw:
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            path = Path(raw)
            if path.is_file():
                return json.loads(path.read_text(encoding="utf-8"))
            return None
    path_raw = _clean(os.getenv("GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE"))
    if path_raw:
        path = Path(path_raw)
        if path.is_file():
            return json.loads(path.read_text(encoding="utf-8"))
    return None


def embedding_model() -> str:
    return _clean(os.getenv("OPENAI_EMBEDDING_MODEL")) or "text-embedding-3-small"


def drive_configured() -> bool:
    if not folder_id():
        return False
    if oauth_client_id() and oauth_client_secret() and oauth_refresh_token():
        return True
    return service_account_info() is not None
