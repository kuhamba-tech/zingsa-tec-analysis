"""Postgres persistence for scientific RAG documents and chunks."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from zgiis.db.config import database_dsn


def _conn():
    import psycopg2
    from psycopg2.extras import RealDictCursor

    dsn = database_dsn()
    if not dsn:
        raise RuntimeError("SUPABASE_DATABASE_URL is not configured")
    conn = psycopg2.connect(dsn)
    conn.autocommit = True
    return conn, RealDictCursor


def upsert_document(row: dict[str, Any]) -> None:
    conn, cursor_factory = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO scientific_rag_documents (
                    drive_file_id, title, mime_type, source_url, drive_modified,
                    document_version, status, error_message, page_count, byte_size,
                    content_sha256, indexed_at, removed_at, updated_at
                ) VALUES (
                    %(drive_file_id)s, %(title)s, %(mime_type)s, %(source_url)s, %(drive_modified)s,
                    %(document_version)s, %(status)s, %(error_message)s, %(page_count)s, %(byte_size)s,
                    %(content_sha256)s, %(indexed_at)s, %(removed_at)s, NOW()
                )
                ON CONFLICT (drive_file_id) DO UPDATE SET
                    title = EXCLUDED.title,
                    mime_type = EXCLUDED.mime_type,
                    source_url = EXCLUDED.source_url,
                    drive_modified = EXCLUDED.drive_modified,
                    document_version = EXCLUDED.document_version,
                    status = EXCLUDED.status,
                    error_message = EXCLUDED.error_message,
                    page_count = EXCLUDED.page_count,
                    byte_size = EXCLUDED.byte_size,
                    content_sha256 = EXCLUDED.content_sha256,
                    indexed_at = EXCLUDED.indexed_at,
                    removed_at = EXCLUDED.removed_at,
                    updated_at = NOW()
                """,
                row,
            )
    finally:
        conn.close()


def replace_chunks(drive_file_id: str, chunks: list[dict[str, Any]]) -> None:
    conn, _ = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM scientific_rag_chunks WHERE drive_file_id = %s", (drive_file_id,))
            for chunk in chunks:
                cur.execute(
                    """
                    INSERT INTO scientific_rag_chunks (
                        drive_file_id, chunk_index, page_start, page_end,
                        section_heading, text, token_estimate, embedding
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (
                        drive_file_id,
                        chunk["chunk_index"],
                        chunk.get("page_start"),
                        chunk.get("page_end"),
                        chunk.get("section_heading"),
                        chunk["text"],
                        chunk.get("token_estimate"),
                        chunk.get("embedding"),
                    ),
                )
    finally:
        conn.close()


def mark_removed(drive_file_ids: list[str]) -> int:
    if not drive_file_ids:
        return 0
    conn, _ = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE scientific_rag_documents
                SET status = 'removed', removed_at = NOW(), updated_at = NOW()
                WHERE drive_file_id = ANY(%s) AND status <> 'removed'
                """,
                (drive_file_ids,),
            )
            removed = cur.rowcount
            cur.execute(
                "DELETE FROM scientific_rag_chunks WHERE drive_file_id = ANY(%s)",
                (drive_file_ids,),
            )
            return int(removed or 0)
    finally:
        conn.close()


def list_documents(limit: int = 100) -> list[dict[str, Any]]:
    conn, cursor_factory = _conn()
    try:
        with conn.cursor(cursor_factory=cursor_factory) as cur:
            cur.execute(
                """
                SELECT drive_file_id, title, mime_type, authors, publication_year, journal, doi,
                       source_url, status, error_message, page_count, indexed_at, drive_modified
                FROM scientific_rag_documents
                WHERE status <> 'removed'
                ORDER BY indexed_at DESC NULLS LAST, title
                LIMIT %s
                """,
                (limit,),
            )
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


def document_counts() -> dict[str, int]:
    conn, cursor_factory = _conn()
    try:
        with conn.cursor(cursor_factory=cursor_factory) as cur:
            cur.execute(
                """
                SELECT status, COUNT(*) AS n
                FROM scientific_rag_documents
                GROUP BY status
                """
            )
            counts = {str(row["status"]): int(row["n"]) for row in cur.fetchall()}
            cur.execute("SELECT COUNT(*) AS n FROM scientific_rag_chunks")
            chunk_n = int(cur.fetchone()["n"])
            counts["chunks"] = chunk_n
            return counts
    except Exception:
        return {}
    finally:
        conn.close()


def fetch_chunk_candidates(query: str, limit: int = 200) -> list[dict[str, Any]]:
    """Keyword prefilter + recent indexed chunks for hybrid ranking."""
    conn, cursor_factory = _conn()
    tokens = [t for t in "".join(ch if ch.isalnum() else " " for ch in query.lower()).split() if len(t) > 2][:8]
    try:
        with conn.cursor(cursor_factory=cursor_factory) as cur:
            if tokens:
                like_clause = " OR ".join(["c.text ILIKE %s"] * len(tokens))
                params: list[Any] = [f"%{t}%" for t in tokens]
                params.append(limit)
                cur.execute(
                    f"""
                    SELECT c.id, c.drive_file_id, c.chunk_index, c.page_start, c.page_end,
                           c.section_heading, c.text, c.embedding,
                           d.title, d.authors, d.publication_year, d.journal, d.doi, d.source_url
                    FROM scientific_rag_chunks c
                    JOIN scientific_rag_documents d ON d.drive_file_id = c.drive_file_id
                    WHERE d.status = 'indexed' AND ({like_clause})
                    ORDER BY c.id DESC
                    LIMIT %s
                    """,
                    params,
                )
                rows = [dict(row) for row in cur.fetchall()]
                if rows:
                    return rows
            cur.execute(
                """
                SELECT c.id, c.drive_file_id, c.chunk_index, c.page_start, c.page_end,
                       c.section_heading, c.text, c.embedding,
                       d.title, d.authors, d.publication_year, d.journal, d.doi, d.source_url
                FROM scientific_rag_chunks c
                JOIN scientific_rag_documents d ON d.drive_file_id = c.drive_file_id
                WHERE d.status = 'indexed'
                ORDER BY c.id DESC
                LIMIT %s
                """,
                (limit,),
            )
            return [dict(row) for row in cur.fetchall()]
    finally:
        conn.close()


def start_sync_run(mode: str = "incremental") -> int:
    conn, cursor_factory = _conn()
    try:
        with conn.cursor(cursor_factory=cursor_factory) as cur:
            cur.execute(
                "INSERT INTO scientific_rag_sync_runs (mode) VALUES (%s) RETURNING id",
                (mode,),
            )
            return int(cur.fetchone()["id"])
    finally:
        conn.close()


def finish_sync_run(run_id: int, **stats: Any) -> None:
    conn, _ = _conn()
    try:
        with conn.cursor() as cur:
            cur.execute(
                """
                UPDATE scientific_rag_sync_runs
                SET finished_at = NOW(),
                    listed = %s, indexed = %s, failed = %s, removed = %s, message = %s
                WHERE id = %s
                """,
                (
                    stats.get("listed", 0),
                    stats.get("indexed", 0),
                    stats.get("failed", 0),
                    stats.get("removed", 0),
                    stats.get("message"),
                    run_id,
                ),
            )
    finally:
        conn.close()


def utc_now() -> datetime:
    return datetime.now(tz=timezone.utc)
