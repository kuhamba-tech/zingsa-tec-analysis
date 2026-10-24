from __future__ import annotations

from urllib.parse import parse_qs, urlsplit

from zgiis.db.config import (
    configured_database_env_key,
    database_dsn,
    database_host_kind,
    pool_max_connections,
    pooled_database_dsn,
)


def test_session_url_is_used_for_long_running_processes(monkeypatch):
    monkeypatch.delenv("ZGIIS_SERVERLESS_DB", raising=False)
    monkeypatch.setenv(
        "SUPABASE_DATABASE_URL",
        "postgresql://postgres:pw@203.0.113.10:5432/postgres",
    )
    monkeypatch.setenv(
        "SUPABASE_POOLER_URL",
        "postgresql://postgres:pw@203.0.113.10:6543/postgres",
    )

    dsn = database_dsn()

    assert configured_database_env_key() == "SUPABASE_DATABASE_URL"
    assert database_host_kind(dsn) == "supabase"
    assert urlsplit(dsn).port == 5432
    assert parse_qs(urlsplit(dsn).query)["sslmode"] == ["disable"]


def test_missing_supabase_url_is_not_configured(monkeypatch):
    monkeypatch.delenv("ZGIIS_SERVERLESS_DB", raising=False)
    monkeypatch.delenv("SUPABASE_DATABASE_URL", raising=False)
    monkeypatch.delenv("SUPABASE_POOLER_URL", raising=False)

    assert database_dsn() == ""
    assert pooled_database_dsn() == ""
    assert configured_database_env_key() is None
    assert database_host_kind("") == "unconfigured"


def test_serverless_flag_uses_transaction_pooler(monkeypatch):
    monkeypatch.setenv("ZGIIS_SERVERLESS_DB", "1")
    monkeypatch.setenv(
        "SUPABASE_DATABASE_URL",
        "postgresql://postgres:pw@203.0.113.10:5432/postgres",
    )
    monkeypatch.setenv(
        "SUPABASE_POOLER_URL",
        "postgresql://postgres:pw@203.0.113.10:6543/postgres",
    )

    dsn = database_dsn()

    assert configured_database_env_key() == "SUPABASE_POOLER_URL"
    assert urlsplit(dsn).port == 6543
    assert urlsplit(pooled_database_dsn()).port == 6543


def test_pooler_falls_back_to_session_url(monkeypatch):
    monkeypatch.delenv("SUPABASE_POOLER_URL", raising=False)
    monkeypatch.setenv(
        "SUPABASE_DATABASE_URL",
        "postgresql://postgres:pw@203.0.113.10:5432/postgres",
    )

    assert urlsplit(pooled_database_dsn()).port == 5432


def test_explicit_sslmode_is_preserved(monkeypatch):
    monkeypatch.delenv("ZGIIS_SERVERLESS_DB", raising=False)
    monkeypatch.setenv(
        "SUPABASE_DATABASE_URL",
        "postgresql://postgres:pw@203.0.113.10:5432/postgres?sslmode=require",
    )

    assert parse_qs(urlsplit(database_dsn()).query)["sslmode"] == ["require"]


def test_pool_is_smaller_on_serverless(monkeypatch):
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("ZGIIS_SERVERLESS_DB", raising=False)
    assert pool_max_connections() == 10
    monkeypatch.setenv("ZGIIS_SERVERLESS_DB", "1")
    assert pool_max_connections() == 5
