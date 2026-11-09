"""Hybrid retrieval + citation-safe evidence packing."""
from __future__ import annotations

from typing import Any

from zgiis.scientific_rag.embed import cosine_similarity, embed_texts
from zgiis.scientific_rag import store


def _keyword_score(text: str, query: str) -> float:
    tokens = [t for t in "".join(ch if ch.isalnum() else " " for ch in query.lower()).split() if len(t) > 2]
    if not tokens:
        return 0.0
    hay = text.lower()
    hits = sum(1 for t in tokens if t in hay)
    return hits / len(tokens)


def retrieve_evidence(question: str, *, top_k: int = 6) -> list[dict[str, Any]]:
    question = (question or "").strip()
    if not question:
        return []
    candidates = store.fetch_chunk_candidates(question, limit=180)
    if not candidates:
        return []

    try:
        query_vec = embed_texts([question])[0]
    except Exception:
        query_vec = []

    ranked: list[tuple[float, dict[str, Any]]] = []
    for row in candidates:
        emb = row.get("embedding") or []
        if isinstance(emb, str):
            # unexpected serialization
            sem = 0.0
        else:
            sem = cosine_similarity(query_vec, list(emb)) if query_vec and emb else 0.0
        key = _keyword_score(str(row.get("text") or ""), question)
        score = 0.72 * sem + 0.28 * key
        ranked.append((score, row))
    ranked.sort(key=lambda item: item[0], reverse=True)

    evidence: list[dict[str, Any]] = []
    seen_files: set[str] = set()
    for score, row in ranked:
        if score <= 0 and not evidence:
            continue
        file_id = str(row["drive_file_id"])
        # Diversify a little across documents
        if file_id in seen_files and len(evidence) >= max(2, top_k // 2):
            continue
        seen_files.add(file_id)
        pages = []
        if row.get("page_start") is not None:
            pages.append(int(row["page_start"]))
        if row.get("page_end") is not None and row.get("page_end") != row.get("page_start"):
            pages.append(int(row["page_end"]))
        evidence.append(
            {
                "score": round(float(score), 4),
                "drive_file_id": file_id,
                "title": row.get("title"),
                "authors": row.get("authors"),
                "publication_year": row.get("publication_year"),
                "journal": row.get("journal"),
                "doi": row.get("doi"),
                "source_url": row.get("source_url"),
                "section_heading": row.get("section_heading"),
                "page_start": row.get("page_start"),
                "page_end": row.get("page_end"),
                "pages": pages,
                "passage": (row.get("text") or "")[:1800],
                "citation_label": _citation_label(row),
            }
        )
        if len(evidence) >= top_k:
            break
    return evidence


def _citation_label(row: dict[str, Any]) -> str:
    title = (row.get("title") or "Untitled").strip()
    year = row.get("publication_year")
    authors = (row.get("authors") or "").strip()
    page = row.get("page_start")
    bits = []
    if authors:
        bits.append(authors.split(",")[0].strip())
    if year:
        bits.append(str(year))
    label = " ".join(bits) if bits else title[:80]
    if page is not None:
        label = f"{label}, p. {page}"
    return label


def format_evidence_block(evidence: list[dict[str, Any]]) -> str:
    if not evidence:
        return "No indexed scientific passages were retrieved for this question."
    lines = []
    for i, item in enumerate(evidence, start=1):
        loc = ""
        if item.get("page_start") is not None:
            loc = f" (p. {item['page_start']}"
            if item.get("page_end") and item["page_end"] != item["page_start"]:
                loc += f"–{item['page_end']}"
            loc += ")"
        doi = f" DOI: {item['doi']}." if item.get("doi") else ""
        lines.append(
            f"[{i}] {item.get('title') or 'Untitled'}{loc}.{doi}\nPassage: {item.get('passage')}"
        )
    return "\n\n".join(lines)
