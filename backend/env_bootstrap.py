"""Load process environment for the API and the NTRIP collector.

Supabase Postgres (``backend/.env``) is the only database. There is no
second hosted database and no local database fallback.
"""
from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]


def load_runtime_env(*, prefer_vercel_db: bool = False) -> None:
    """Load ``.env.local`` then ``backend/.env``.

    ``prefer_vercel_db`` is accepted so existing callers keep working. It does
    not select another database.
    """
    del prefer_vercel_db
    load_dotenv(ROOT / ".env.local", override=False)
    load_dotenv(ROOT / "backend" / ".env", override=True)
