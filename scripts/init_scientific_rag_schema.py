#!/usr/bin/env python3
"""Create scientific RAG tables on Supabase Postgres. Idempotent."""
from __future__ import annotations

import logging
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from backend.env_bootstrap import load_runtime_env  # noqa: E402
from zgiis.db.config import database_dsn  # noqa: E402

log = logging.getLogger(__name__)


def _statements(sql: str) -> list[str]:
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
    dsn = database_dsn()
    if not dsn:
        log.error("SUPABASE_DATABASE_URL is not configured")
        return 1
    path = ROOT / "zgiis" / "db" / "scientific_rag.sql"
    import psycopg2

    sql = path.read_text(encoding="utf-8")
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    ok = 0
    try:
        with conn.cursor() as cur:
            for stmt in _statements(sql):
                cur.execute(stmt)
                ok += 1
        print(f"init_scientific_rag_schema: applied={ok}")
        return 0
    except Exception as exc:
        log.error("failed: %s", exc)
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())
