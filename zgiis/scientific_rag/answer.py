"""Scientific Knowledge Assistant answers grounded in Drive passages + optional live context."""
from __future__ import annotations

import json
import os
from typing import Any
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from zgiis.scientific_rag.retrieve import format_evidence_block, retrieve_evidence

SYSTEM = """You are the ZINGSA Scientific Knowledge Assistant.
Rules:
- Use ONLY the retrieved publication passages and the supplied ZINGSA observation context.
- Never invent papers, authors, DOIs, page numbers or measurements.
- Distinguish published findings from ZINGSA observations.
- Label hypotheses clearly. Do not claim causation from correlation alone.
- If evidence is insufficient, say so.
- Cite sources as [1], [2] matching the evidence list.
"""


def answer_scientific_question(
    question: str,
    *,
    include_live_context: bool = True,
    live_context: str | None = None,
) -> dict[str, Any]:
    evidence = retrieve_evidence(question, top_k=6)
    evidence_block = format_evidence_block(evidence)
    mode = "literature+observations" if include_live_context and live_context else "literature-only"

    key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not key:
        return {
            "mode": mode,
            "answer": (
                "OPENAI_API_KEY is not configured, so a generated synthesis is unavailable. "
                "Retrieved evidence passages are listed below for manual scientific review."
            ),
            "evidence": evidence,
            "evidence_block": evidence_block,
        }
    if not evidence:
        return {
            "mode": mode,
            "answer": (
                "No indexed scientific passages were retrieved. "
                "Synchronise the Google Drive library before asking literature questions. "
                "ZINGSA live measurements were not substituted with literature values."
            ),
            "evidence": [],
            "evidence_block": evidence_block,
        }

    user = (
        f"Question: {question}\n\n"
        f"Answer mode: {mode}\n\n"
        f"Retrieved evidence:\n{evidence_block}\n\n"
    )
    if include_live_context and live_context:
        user += f"ZINGSA observation context (authoritative for numbers):\n{live_context}\n\n"
    user += "Write a concise scientific answer with citations [n]."

    model = os.environ.get("OPENAI_MODEL", "gpt-5.4")
    max_tokens = int(os.environ.get("OPENAI_MAX_OUTPUT_TOKENS", "1200"))
    body = json.dumps(
        {
            "model": model,
            "instructions": SYSTEM,
            "input": [{"role": "user", "content": user}],
            "max_output_tokens": max_tokens,
            "store": False,
        }
    ).encode("utf-8")
    request = Request(
        "https://api.openai.com/v1/responses",
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=90) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"OpenAI request failed ({exc.code}): {detail}") from exc

    text_parts = [
        part.get("text", "")
        for item in payload.get("output", [])
        if item.get("type") == "message"
        for part in item.get("content", [])
        if part.get("type") == "output_text"
    ]
    answer = "".join(text_parts).strip() or "No assistant text returned."
    return {
        "mode": mode,
        "answer": answer,
        "evidence": evidence,
        "evidence_block": evidence_block,
    }
