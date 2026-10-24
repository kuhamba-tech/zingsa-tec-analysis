"""Isolated Supabase schema for tests.

Writes stay in ``zgiis_test``. The public schema is never truncated.
"""
from __future__ import annotations

import os
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_SCHEMA = "zgiis_test"
_IDENT = re.compile(r"^[a-z][a-z0-9_]*$")


def _install_search_path_hook() -> None:
    """Supavisor drops libpq startup options, so set the schema after connect."""
    import psycopg2

    if getattr(psycopg2.connect, "_zgiis_test_hook", False):
        return
    original = psycopg2.connect

    def connect(*args, **kwargs):
        conn = original(*args, **kwargs)
        blob = " ".join(str(arg) for arg in args)
        blob += " " + str(kwargs.get("dsn") or "")
        if _SCHEMA in blob:
            with conn.cursor() as cur:
                cur.execute(f"SET search_path TO {_SCHEMA}")
            conn.commit()
        return conn

    connect._zgiis_test_hook = True
    psycopg2.connect = connect


def isolated_dsn() -> str:
    saved = os.environ.pop("ZGIIS_SERVERLESS_DB", None)
    try:
        from zgiis.db.config import database_dsn, load_shared_database_env

        load_shared_database_env()
        base = database_dsn()
    finally:
        if saved is not None:
            os.environ["ZGIIS_SERVERLESS_DB"] = saved
    if not base:
        raise RuntimeError("SUPABASE_DATABASE_URL is not configured")
    parts = urlsplit(base)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query["options"] = f"-csearch_path={_SCHEMA}"
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))


def prepare(*tables: str) -> str:
    import psycopg2

    from zgiis.db.config import database_dsn, load_shared_database_env

    for name in tables:
        if not _IDENT.match(name):
            raise RuntimeError(f"refusing table name {name}")

    load_shared_database_env()
    admin_dsn = database_dsn()
    if not admin_dsn:
        raise RuntimeError("SUPABASE_DATABASE_URL is not configured")

    admin = psycopg2.connect(admin_dsn)
    try:
        admin.autocommit = True
        with admin.cursor() as cur:
            cur.execute(f"CREATE SCHEMA IF NOT EXISTS {_SCHEMA}")
    finally:
        admin.close()

    _install_search_path_hook()
    dsn = isolated_dsn()
    conn = psycopg2.connect(dsn)
    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SELECT current_schema()")
            current = cur.fetchone()[0]
            if current != _SCHEMA:
                raise RuntimeError(f"refusing to write schema {current}")
            present: list[str] = []
            for name in tables:
                cur.execute(
                    "SELECT 1 FROM pg_tables WHERE schemaname = %s AND tablename = %s",
                    (_SCHEMA, name),
                )
                if cur.fetchone():
                    present.append(name)
            if present:
                listed = ", ".join(f"{_SCHEMA}.{name}" for name in present)
                cur.execute(f"TRUNCATE TABLE {listed} RESTART IDENTITY CASCADE")
    finally:
        conn.close()
    return dsn
