"""Print whether scientific RAG env keys are set — never print secret values."""
from __future__ import annotations

import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.env_bootstrap import load_runtime_env
from zgiis.scientific_rag import config
from zgiis.scientific_rag.status import rag_status

load_runtime_env()

KEYS = [
    "SCIENTIFIC_RAG_ENABLED",
    "GOOGLE_DRIVE_FOLDER_ID",
    "GOOGLE_DRIVE_FOLDER_URL",
    "GOOGLE_DRIVE_OAUTH_CLIENT_ID",
    "GOOGLE_DRIVE_OAUTH_CLIENT_SECRET",
    "GOOGLE_DRIVE_OAUTH_REFRESH_TOKEN",
    "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON",
    "GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE",
    "SCIENTIFIC_RAG_ADMIN_KEY",
    "OPENAI_API_KEY",
    "OPENAI_EMBEDDING_MODEL",
    "SUPABASE_DATABASE_URL",
]

print("--- env presence ---")
for key in KEYS:
    value = (os.getenv(key) or "").strip()
    print(f"{key}: {'set' if value else 'missing'}" + (f" (len={len(value)})" if value else ""))

print("folder_id_parsed:", "set" if config.folder_id() else "missing")
print("drive_configured:", config.drive_configured())
print("rag_enabled:", config.rag_enabled())
if config.oauth_refresh_token() and config.oauth_client_id():
    auth = "oauth_refresh"
elif config.service_account_info():
    auth = "service_account"
else:
    auth = "none"
print("auth:", auth)

try:
    print("status:", rag_status())
except Exception as exc:
    print("status_error:", type(exc).__name__, str(exc)[:240])
