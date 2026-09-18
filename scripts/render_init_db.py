#!/usr/bin/env python3
"""Apply zgiis/db/schema.sql to the Render Postgres database (pre-deploy)."""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from zgiis.db.config import database_dsn, ensure_sslmode  # noqa: E402


def _statements(sql: str) -> list[str]:
    """Split SQL file into executable statements (skip empty / comment-only)."""
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
    dsn = database_dsn() or (os.getenv("DATABASE_URL") or "").strip()
    if not dsn:
        print("render_init_db: no DATABASE_URL/TSDB_DSN — skipping schema apply")
        return 0

    dsn = ensure_sslmode(dsn)
    schema = ROOT / "zgiis" / "db" / "schema.sql"
    if not schema.is_file():
        print(f"render_init_db: missing {schema}", file=sys.stderr)
        return 1

    import psycopg2

    sql = schema.read_text(encoding="utf-8")
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
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
                    print(f"render_init_db: statement failed: {exc}", file=sys.stderr)
                    print(stmt[:200], file=sys.stderr)
                    return 1
        print(f"render_init_db: applied={ok} skipped_existing={skipped}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
