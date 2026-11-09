"""Incremental Google Drive → chunk/embed sync (batch-sized for serverless)."""
from __future__ import annotations

import hashlib
import logging
from datetime import datetime
from typing import Any

from zgiis.scientific_rag import config
from zgiis.scientific_rag.chunk import chunk_document
from zgiis.scientific_rag.drive import download_file_bytes, list_library_files
from zgiis.scientific_rag.embed import embed_texts
from zgiis.scientific_rag.extract import extract_bytes
from zgiis.scientific_rag import store

log = logging.getLogger(__name__)


def _parse_modified(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def index_one_file(file_meta: dict[str, Any]) -> dict[str, Any]:
    file_id = file_meta["id"]
    name = file_meta.get("name") or file_id
    mime = file_meta.get("mimeType") or "application/octet-stream"
    modified = _parse_modified(file_meta.get("modifiedTime"))
    version = file_meta.get("md5Checksum") or file_meta.get("modifiedTime") or ""
    source_url = file_meta.get("webViewLink")

    store.upsert_document(
        {
            "drive_file_id": file_id,
            "title": name,
            "mime_type": mime,
            "source_url": source_url,
            "drive_modified": modified,
            "document_version": version,
            "status": "indexing",
            "error_message": None,
            "page_count": None,
            "byte_size": int(file_meta["size"]) if str(file_meta.get("size") or "").isdigit() else None,
            "content_sha256": None,
            "indexed_at": None,
            "removed_at": None,
        }
    )

    raw, effective_mime = download_file_bytes(file_id, mime)
    digest = hashlib.sha256(raw).hexdigest()
    extracted = extract_bytes(raw, effective_mime, filename=name)
    if not extracted.full_text.strip():
        store.upsert_document(
            {
                "drive_file_id": file_id,
                "title": name,
                "mime_type": mime,
                "source_url": source_url,
                "drive_modified": modified,
                "document_version": version,
                "status": "failed",
                "error_message": "No extractable text (install pypdf/python-docx for PDF/DOCX if needed).",
                "page_count": len(extracted.pages),
                "byte_size": len(raw),
                "content_sha256": digest,
                "indexed_at": None,
                "removed_at": None,
            }
        )
        return {"drive_file_id": file_id, "status": "failed"}

    chunks = chunk_document(extracted)
    embeddings: list[list[float]] = []
    # Embed in batches of 16
    for start in range(0, len(chunks), 16):
        batch = chunks[start : start + 16]
        embeddings.extend(embed_texts([c.text for c in batch]))

    payload = []
    for chunk, vector in zip(chunks, embeddings):
        payload.append(
            {
                "chunk_index": chunk.chunk_index,
                "page_start": chunk.page_start,
                "page_end": chunk.page_end,
                "section_heading": chunk.section_heading,
                "text": chunk.text,
                "token_estimate": chunk.token_estimate,
                "embedding": vector,
            }
        )
    store.replace_chunks(file_id, payload)
    store.upsert_document(
        {
            "drive_file_id": file_id,
            "title": extracted.title_guess or name,
            "mime_type": mime,
            "source_url": source_url,
            "drive_modified": modified,
            "document_version": version,
            "status": "indexed",
            "error_message": None,
            "page_count": len(extracted.pages),
            "byte_size": len(raw),
            "content_sha256": digest,
            "indexed_at": store.utc_now(),
            "removed_at": None,
        }
    )
    return {"drive_file_id": file_id, "status": "indexed", "chunks": len(payload)}


def sync_library(*, max_files: int = 3, page_token: str | None = None) -> dict[str, Any]:
    """List Drive folder and index up to max_files documents this tick."""
    if not config.rag_enabled():
        return {"ok": False, "message": "SCIENTIFIC_RAG_ENABLED is off"}
    if not config.drive_configured():
        return {
            "ok": False,
            "message": "Google Drive is not configured. Set GOOGLE_DRIVE_FOLDER_ID and OAuth refresh token or service account in backend/.env",
        }

    run_id = store.start_sync_run("incremental")
    listed = 0
    indexed = 0
    failed = 0
    try:
        listing = list_library_files(page_token=page_token, page_size=max(max_files, 20))
        files = listing.get("files") or []
        listed = len(files)
        # Prefer not-yet-indexed / failed first by checking DB statuses
        existing = {row["drive_file_id"]: row for row in store.list_documents(limit=500)}
        pending = []
        for meta in files:
            row = existing.get(meta["id"])
            if row is None or row.get("status") in {"pending", "failed", "indexing"}:
                pending.append(meta)
            elif row.get("status") == "indexed":
                # Reindex when Drive modifiedTime / md5 changed
                version = meta.get("md5Checksum") or meta.get("modifiedTime") or ""
                # document_version not in list_documents projection — always allow explicit reindex path later
                continue
        queue = pending[:max_files] if pending else files[:max_files]
        results = []
        for meta in queue:
            try:
                result = index_one_file(meta)
                results.append(result)
                if result.get("status") == "indexed":
                    indexed += 1
                else:
                    failed += 1
            except Exception as exc:
                failed += 1
                log.exception("index failed for %s", meta.get("id"))
                store.upsert_document(
                    {
                        "drive_file_id": meta["id"],
                        "title": meta.get("name") or meta["id"],
                        "mime_type": meta.get("mimeType"),
                        "source_url": meta.get("webViewLink"),
                        "drive_modified": _parse_modified(meta.get("modifiedTime")),
                        "document_version": meta.get("md5Checksum") or meta.get("modifiedTime"),
                        "status": "failed",
                        "error_message": str(exc)[:500],
                        "page_count": None,
                        "byte_size": None,
                        "content_sha256": None,
                        "indexed_at": None,
                        "removed_at": None,
                    }
                )
                results.append({"drive_file_id": meta["id"], "status": "failed", "error": str(exc)})

        # Soft-remove DB docs no longer present in this page listing when listing is complete
        removed = 0
        next_token = listing.get("nextPageToken")
        message = f"Indexed {indexed}, failed {failed}, listed {listed}"
        store.finish_sync_run(
            run_id,
            listed=listed,
            indexed=indexed,
            failed=failed,
            removed=removed,
            message=message,
        )
        return {
            "ok": True,
            "run_id": run_id,
            "listed": listed,
            "indexed": indexed,
            "failed": failed,
            "removed": removed,
            "next_page_token": next_token,
            "results": results,
            "message": message,
        }
    except Exception as exc:
        store.finish_sync_run(run_id, listed=listed, indexed=indexed, failed=failed, removed=0, message=str(exc))
        return {"ok": False, "run_id": run_id, "message": str(exc)}
