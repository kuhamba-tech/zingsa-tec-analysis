#!/usr/bin/env python3
"""Create ZGIIS tables and indexes on Supabase Postgres. Idempotent."""
from __future__ import annotations

import logging
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.env_bootstrap import load_runtime_env  # noqa: E402
from zgiis.db.config import database_dsn  # noqa: E402

log = logging.getLogger(__name__)


def _statements(sql: str) -> list[str]:
    """Split a SQL file into executable statements (skip empty / comment-only)."""
    parts = re.split(r";\s*\n", sql)
    out: list[str] = []
    for part in parts:
        cleaned = "\n".join(
            line for line in part.splitlines() if not line.strip().startswith("--")
        ).strip()
        if cleaned:
            out.append(cleaned)
    return out


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    load_runtime_env()
    os.environ["ZGIIS_RUN_DB_SCHEMA_INIT"] = "1"
    dsn = database_dsn()
    if not dsn:
        log.error("SUPABASE_DATABASE_URL is not configured; schema was not applied")
        return 1

    schema = ROOT / "zgiis" / "db" / "schema.sql"
    if not schema.is_file():
        log.error("missing %s", schema)
        return 1

    import psycopg2

    sql = schema.read_text(encoding="utf-8")
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    with conn.cursor() as cur:
        cur.execute("SET lock_timeout = '20s'")
    ok = 0
    skipped = 0
    try:
        with conn.cursor() as cur:
            for stmt in _statements(sql):
                try:
                    cur.execute(stmt)
                    ok += 1
                except Exception as exc:
                    msg = str(exc).lower()
                    if "already exists" in msg or "duplicate" in msg:
                        skipped += 1
                        continue
                    log.error("statement failed: %s", exc)
                    log.error("%s", stmt[:200])
                    return 1
            # The backend connects as the table owner, which bypasses RLS. With
            # RLS on and no policies, the public anon key gets nothing via the
            # Supabase REST API.
            cur.execute("SELECT tablename FROM pg_tables WHERE schemaname = 'public'")
            tables = [row[0] for row in cur.fetchall()]
            for table in tables:
                cur.execute(f'ALTER TABLE public."{table}" ENABLE ROW LEVEL SECURITY')
        print(f"init_supabase_schema: applied={ok} skipped_existing={skipped} rls_tables={len(tables)}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
