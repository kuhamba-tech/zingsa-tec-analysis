"""Database connection configuration for hosted Postgres and local fallback."""
from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


_DSN_ENV_KEYS = (
    "SUPABASE_DATABASE_URL",
    "TSDB_DSN",
    # Prefer pooled URLs for Vercel functions and the long-running collector.
    # Direct/unpooled Neon connections can stall under concurrent requests.
    "POSTGRES_URL",
    "DATABASE_URL",
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL_UNPOOLED",
)


def load_shared_database_env(project_root: str | Path | None = None) -> None:
    """Load the same hosted-DB env the NTRIP collector uses.

    Local uvicorn previously fell back to SQLite while the collector wrote Neon,
    so the map showed stale medians instead of live NTRIP VTEC.
    """
    try:
        from dotenv import dotenv_values, load_dotenv
    except ImportError:
        return

    root = Path(project_root) if project_root else Path(__file__).resolve().parents[2]
    load_dotenv(root / "backend" / ".env", override=False)

    vercel_env = dotenv_values(root / ".env.vercel.production")
    allow_neon = str(vercel_env.get("ALLOW_LEGACY_NEON_DATABASE_URL") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if allow_neon:
        # Discard stale local overrides so the managed Neon URL wins.
        os.environ.pop("SUPABASE_DATABASE_URL", None)
        os.environ.pop("TSDB_DSN", None)
    for key in (
        "SUPABASE_DATABASE_URL",
        "TSDB_DSN",
        "DATABASE_URL",
        "DATABASE_URL_UNPOOLED",
        "POSTGRES_URL",
        "POSTGRES_URL_NON_POOLING",
        "ALLOW_LEGACY_NEON_DATABASE_URL",
    ):
        value = vercel_env.get(key)
        if allow_neon and key in {"SUPABASE_DATABASE_URL", "TSDB_DSN"}:
            continue
        if value:
            os.environ[key] = value

    # Normalize to TSDB_DSN for older call sites.
    if not (os.getenv("TSDB_DSN") or "").strip():
        for key in (
            "POSTGRES_URL_NON_POOLING",
            "DATABASE_URL_UNPOOLED",
            "POSTGRES_URL",
            "DATABASE_URL",
            "SUPABASE_DATABASE_URL",
        ):
            value = (os.getenv(key) or "").strip().strip('"').strip("'")
            if value:
                os.environ["TSDB_DSN"] = value
                break


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
    try:
        parts = urlsplit(dsn)
        host = parts.hostname or ""
    except ValueError:
        # A malformed environment value must not prevent unrelated API routes
        # from starting. Treat it as unconfigured and continue to fallbacks.
        return False
    if parts.scheme not in {"postgres", "postgresql"} or not host:
        return False
    if "neon" not in host:
        return True
    return (os.getenv("ALLOW_LEGACY_NEON_DATABASE_URL") or "").strip().lower() in {"1", "true", "yes", "on"}


def ensure_sslmode(dsn: str) -> str:
    """Require TLS/timeouts for hosted Postgres URLs unless already configured."""
    parts = urlsplit(dsn)
    host = parts.hostname or ""
    if not host or parts.scheme not in {"postgres", "postgresql"}:
        return dsn
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    hosted = any(token in host for token in ("supabase", "neon.tech", "render.com", "amazonaws.com"))
    if hosted and "sslmode" not in query:
        query["sslmode"] = "require"
    if "connect_timeout" not in query:
        query["connect_timeout"] = "5"
    if "application_name" not in query:
        query["application_name"] = "zgiis"
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
