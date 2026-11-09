"""Split extracted pages into scientifically usable text chunks."""
from __future__ import annotations

import re
from dataclasses import dataclass

from zgiis.scientific_rag.extract import ExtractedDocument


@dataclass
class TextChunk:
    chunk_index: int
    text: str
    page_start: int | None
    page_end: int | None
    section_heading: str | None
    token_estimate: int


_HEADING = re.compile(r"^(?:\d+(?:\.\d+)*\.?\s+|[A-Z][A-Z0-9 \-]{8,})$")


def chunk_document(doc: ExtractedDocument, *, max_chars: int = 1800, overlap: int = 200) -> list[TextChunk]:
    units: list[tuple[int, str, str | None]] = []
    for page in doc.pages:
        heading: str | None = None
        for block in re.split(r"\n{2,}", page.text or ""):
            cleaned = re.sub(r"[ \t]+", " ", block).strip()
            if not cleaned:
                continue
            first = cleaned.split("\n", 1)[0].strip()
            if _HEADING.match(first) and len(first) < 160:
                heading = first[:160]
            units.append((page.page, cleaned, heading))

    if not units:
        return []

    chunks: list[TextChunk] = []
    buf: list[str] = []
    page_start: int | None = None
    page_end: int | None = None
    heading: str | None = None

    def flush() -> None:
        nonlocal buf, page_start, page_end, heading
        text = "\n\n".join(buf).strip()
        if not text:
            buf, page_start, page_end, heading = [], None, None, None
            return
        chunks.append(
            TextChunk(
                chunk_index=len(chunks),
                text=text,
                page_start=page_start,
                page_end=page_end,
                section_heading=heading,
                token_estimate=max(1, len(text) // 4),
            )
        )
        if overlap > 0 and len(text) > overlap:
            tail = text[-overlap:]
            buf = [tail]
            page_start = page_end
            heading = heading
        else:
            buf, page_start, page_end, heading = [], None, None, None

    for page_no, text, head in units:
        if page_start is None:
            page_start = page_no
            heading = head
        page_end = page_no
        if head and not heading:
            heading = head
        candidate = ("\n\n".join(buf + [text])).strip()
        if buf and len(candidate) > max_chars:
            flush()
            page_start = page_no
            page_end = page_no
            heading = head
            buf = [text]
        else:
            buf.append(text)
    flush()
    return chunks
