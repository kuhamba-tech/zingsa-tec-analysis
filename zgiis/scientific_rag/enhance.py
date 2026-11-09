"""Literature enhancement for existing space-weather reports — never replaces measurements."""
from __future__ import annotations

from typing import Any

from zgiis.scientific_rag.retrieve import format_evidence_block, retrieve_evidence


def literature_section_for_report(report: dict[str, Any]) -> dict[str, Any]:
    """Build an optional report section from Drive RAG evidence.

    Measurements in ``report`` remain authoritative. If the index is empty or
    Drive/RAG is unavailable, returns a disclosure section rather than inventing papers.
    """
    period = report.get("period_label") or report.get("period") or "this interval"
    summary = (report.get("executive_summary") or "").strip()
    question = (
        "Southern African or Zimbabwe ionospheric TEC response during geomagnetic and solar-wind conditions. "
        f"Reporting period context: {period}. Observed summary: {summary[:500]}"
    )
    try:
        evidence = retrieve_evidence(question, top_k=5)
    except Exception as exc:
        return {
            "id": "literature",
            "title": "Comparison with scientific literature",
            "paragraphs": [
                "Scientific literature enhancement is unavailable for this draft.",
                f"Retrieval error: {exc}",
                "All numerical values in this report remain archive measurements only.",
            ],
            "evidence": [],
            "available": False,
        }

    if not evidence:
        return {
            "id": "literature",
            "title": "Comparison with scientific literature",
            "paragraphs": [
                "No indexed Google Drive publications matched this reporting window yet.",
                "Index approved scientific PDFs/DOCX in the configured Drive folder, then regenerate.",
                "Observed ZINGSA/NOAA values in other sections are unchanged and were not replaced by literature values.",
            ],
            "evidence": [],
            "available": False,
        }

    citations = []
    for item in evidence:
        cite = item.get("citation_label") or item.get("title")
        if item.get("doi"):
            cite = f"{cite}; DOI {item['doi']}"
        citations.append(cite)

    paragraphs = [
        "The following published passages were retrieved from the authorised ZINGSA Google Drive scientific library. "
        "They provide context only. They do not replace measured TEC, Kp, Dst, solar-wind or scintillation values in this report.",
        format_evidence_block(evidence),
        "Interpret overlaps cautiously: temporal coincidence with a published storm morphology is not proof of the same physical driver over Zimbabwe.",
        "References (retrieved index only — no invented bibliography): " + "; ".join(citations),
    ]
    return {
        "id": "literature",
        "title": "Comparison with scientific literature",
        "paragraphs": paragraphs,
        "evidence": evidence,
        "available": True,
    }


def attach_literature_enhancement(report: dict[str, Any], *, enabled: bool = True) -> dict[str, Any]:
    if not enabled:
        return report
    section = literature_section_for_report(report)
    sections = list(report.get("sections") or [])
    # Insert before methods when present
    insert_at = next((i for i, s in enumerate(sections) if s.get("id") == "methods"), len(sections))
    sections.insert(insert_at, {k: section[k] for k in ("id", "title", "paragraphs")})
    out = dict(report)
    out["sections"] = sections
    out["literature_evidence"] = section.get("evidence") or []
    out["literature_available"] = bool(section.get("available"))
    return out
