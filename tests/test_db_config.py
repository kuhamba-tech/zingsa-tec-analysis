from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

from zgiis.db.config import configured_database_env_key, database_dsn, database_host_kind


def test_supabase_database_url_wins_and_requires_ssl(monkeypatch):
    monkeypatch.setenv("SUPABASE_DATABASE_URL", "postgresql://postgres:pw@db.example.supabase.co:5432/postgres")
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@ep-test.neon.tech/db")

    dsn = database_dsn()

    assert configured_database_env_key() == "SUPABASE_DATABASE_URL"
    assert database_host_kind(dsn) == "supabase"
    assert "sslmode=require" in dsn


def test_neon_urls_are_ignored_unless_explicitly_allowed(monkeypatch):
    monkeypatch.delenv("SUPABASE_DATABASE_URL", raising=False)
    monkeypatch.delenv("ALLOW_LEGACY_NEON_DATABASE_URL", raising=False)
    monkeypatch.setenv("DATABASE_URL", "postgresql://user:pw@ep-test.neon.tech/db")

    assert database_dsn() == ""
    assert configured_database_env_key() is None

    monkeypatch.setenv("ALLOW_LEGACY_NEON_DATABASE_URL", "true")
    allowed = database_dsn()
    parts = urlsplit(allowed)
    assert parts.hostname == "ep-test.neon.tech"
    assert parts.path == "/db"
    assert parse_qs(parts.query)["connect_timeout"] == ["5"]
    assert configured_database_env_key() == "DATABASE_URL"
