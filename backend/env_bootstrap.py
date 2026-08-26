"""Shared environment bootstrap for API and NTRIP collector.

The collector always writes live VTEC to the hosted DB configured in
``.env.vercel.production``. Local uvicorn must load the same keys or the map
reads a stale SQLite file and markers diverge from NTRIP decode.
"""
from __future__ import annotations

import os
from pathlib import Path

from dotenv import dotenv_values, load_dotenv

ROOT = Path(__file__).resolve().parents[1]


def load_runtime_env(*, prefer_vercel_db: bool = True) -> None:
    """Load backend/.env then hosted DB URLs used by the persistent collector."""
    load_dotenv(ROOT / ".env.local", override=False)
    load_dotenv(ROOT / "backend" / ".env", override=True)

    vercel_env = dotenv_values(ROOT / ".env.vercel.production")
    if not vercel_env:
        vercel_env = dotenv_values(ROOT / ".vercel" / ".env.production.local")

    allow_neon = str(vercel_env.get("ALLOW_LEGACY_NEON_DATABASE_URL") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if allow_neon:
        # Match collector: drop stale local overrides that would hide Neon.
        os.environ.pop("SUPABASE_DATABASE_URL", None)
        os.environ.pop("TSDB_DSN", None)

    if prefer_vercel_db or os.getenv("ZGIIS_LOAD_VERCEL_ENV", "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }:
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

    tsdb = (os.getenv("TSDB_DSN") or "").strip().strip('"').strip("'")
    if not tsdb:
        for key in (
            "POSTGRES_URL_NON_POOLING",
            "DATABASE_URL_UNPOOLED",
            "POSTGRES_URL",
            "DATABASE_URL",
        ):
            value = (os.getenv(key) or "").strip().strip('"').strip("'")
            if value:
                os.environ["TSDB_DSN"] = value
                break
