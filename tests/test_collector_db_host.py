"""Database host rewrite for the VPS collector container."""

from scripts.collector_db_host import rewrite_database_url


def test_rewrite_replaces_only_the_host():
    rewritten = rewrite_database_url(
        "postgresql://collector:secret%40word@203.0.113.10:5432/postgres?sslmode=disable",
        "db",
        "5432",
    )
    assert rewritten == "postgresql://collector:secret%40word@db:5432/postgres?sslmode=disable"


def test_rewrite_keeps_the_original_port_when_none_is_given():
    rewritten = rewrite_database_url(
        "postgresql://collector:secret@203.0.113.10:5432/postgres",
        "supabase-db",
        None,
    )
    assert rewritten.startswith("postgresql://collector:secret@supabase-db:5432/")
