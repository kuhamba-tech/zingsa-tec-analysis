"""OpenAI embeddings for scientific chunks — server-side key only."""
from __future__ import annotations

import json
import math
import os
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from zgiis.scientific_rag.config import embedding_model


def cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / (na * nb)


def embed_texts(texts: list[str]) -> list[list[float]]:
    if not texts:
        return []
    key = (os.environ.get("OPENAI_API_KEY") or "").strip()
    if not key:
        raise RuntimeError("OPENAI_API_KEY is required to embed scientific literature")
    body = json.dumps({"model": embedding_model(), "input": texts}).encode("utf-8")
    request = Request(
        "https://api.openai.com/v1/embeddings",
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urlopen(request, timeout=90) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        raise RuntimeError(f"Embedding request failed ({exc.code}): {detail}") from exc
    rows = sorted(payload.get("data") or [], key=lambda row: int(row.get("index") or 0))
    return [list(map(float, row.get("embedding") or [])) for row in rows]
