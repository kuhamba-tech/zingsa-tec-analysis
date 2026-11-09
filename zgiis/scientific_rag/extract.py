"""Extract plain text from PDF / DOCX / TXT while preserving page refs when possible."""
from __future__ import annotations

from dataclasses import dataclass


@dataclass
class ExtractedPage:
    page: int
    text: str


@dataclass
class ExtractedDocument:
    pages: list[ExtractedPage]
    title_guess: str | None = None

    @property
    def full_text(self) -> str:
        return "\n\n".join(p.text for p in self.pages if p.text.strip())


def extract_bytes(data: bytes, mime_type: str, filename: str = "") -> ExtractedDocument:
    mime = (mime_type or "").lower()
    if mime == "text/plain" or filename.lower().endswith(".txt"):
        text = data.decode("utf-8", errors="replace")
        return ExtractedDocument(pages=[ExtractedPage(page=1, text=text)], title_guess=filename or None)

    if "wordprocessingml" in mime or filename.lower().endswith(".docx"):
        return _extract_docx(data, filename)

    if mime == "application/pdf" or filename.lower().endswith(".pdf"):
        return _extract_pdf(data, filename)

    # Fallback: try UTF-8 text
    text = data.decode("utf-8", errors="replace")
    return ExtractedDocument(pages=[ExtractedPage(page=1, text=text)], title_guess=filename or None)


def _extract_pdf(data: bytes, filename: str) -> ExtractedDocument:
    try:
        from pypdf import PdfReader
        import io

        reader = PdfReader(io.BytesIO(data))
        pages: list[ExtractedPage] = []
        for index, page in enumerate(reader.pages, start=1):
            try:
                text = page.extract_text() or ""
            except Exception:
                text = ""
            pages.append(ExtractedPage(page=index, text=text))
        meta_title = None
        try:
            meta_title = (reader.metadata.title if reader.metadata else None) or None
            if meta_title:
                meta_title = str(meta_title).strip() or None
        except Exception:
            meta_title = None
        return ExtractedDocument(pages=pages or [ExtractedPage(page=1, text="")], title_guess=meta_title or filename or None)
    except ImportError:
        return ExtractedDocument(
            pages=[ExtractedPage(page=1, text="")],
            title_guess=filename or None,
        )


def _extract_docx(data: bytes, filename: str) -> ExtractedDocument:
    try:
        import io
        from docx import Document

        doc = Document(io.BytesIO(data))
        paras = [p.text.strip() for p in doc.paragraphs if p.text and p.text.strip()]
        text = "\n".join(paras)
        return ExtractedDocument(pages=[ExtractedPage(page=1, text=text)], title_guess=filename or None)
    except ImportError:
        return ExtractedDocument(pages=[ExtractedPage(page=1, text="")], title_guess=filename or None)
