"""Database connection configuration for hosted Postgres and local fallback."""
from __future__ import annotations

import os
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


_DSN_ENV_KEYS = (
    "SUPABASE_DATABASE_URL",
    "TSDB_DSN",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL",
    "DATABASE_URL",
)


def database_dsn() -> str:
    """Return the configured hosted Postgres DSN, if any.

    Supabase is the preferred hosted database for this app. Older hosted
    Postgres environment variable names are still accepted so existing
    deployments keep working until their environment is updated.
    """
    for key in _DSN_ENV_KEYS:
        value = (os.getenv(key) or "").strip().strip('"').strip("'")
        if value and _dsn_allowed(value):
            return ensure_sslmode(value)
    return ""


def _dsn_allowed(dsn: str) -> bool:
    host = urlsplit(dsn).hostname or ""
    if "neon" not in host:
        return True
    return (os.getenv("ALLOW_LEGACY_NEON_DATABASE_URL") or "").strip().lower() in {"1", "true", "yes", "on"}


def ensure_sslmode(dsn: str) -> str:
    """Require TLS for Supabase Postgres URLs unless the URL already says otherwise."""
    parts = urlsplit(dsn)
    host = parts.hostname or ""
    if "supabase" not in host:
        return dsn
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    if "sslmode" in query:
        return dsn
    query["sslmode"] = "require"
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def database_backend_label(dsn: str) -> str:
    if not dsn:
        return "SQLite"
    host = urlsplit(dsn).hostname or ""
    if "supabase" in host:
        return "Supabase Postgres"
    if "neon" in host:
        return "Neon Postgres"
    return "Postgres"


def database_host_kind(dsn: str) -> str:
    if not dsn:
        return "sqlite"
    host = urlsplit(dsn).hostname or ""
    if "supabase" in host:
        return "supabase"
    if "neon" in host:
        return "neon"
    return "postgres"


def configured_database_env_key() -> str | None:
    for key in _DSN_ENV_KEYS:
        value = (os.getenv(key) or "").strip().strip('"').strip("'")
        if value and _dsn_allowed(value):
            return key
    return None
