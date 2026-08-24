"""ZGIIS AI Ionosphere Assistant powered by the OpenAI API."""
from __future__ import annotations

import json
import os
from typing import Dict, List, Optional
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from zgiis.ai.context import build_context_block, trim_messages

SYSTEM_PROMPT = """You are the ZGIIS AI Ionosphere Assistant — an expert system for the Zimbabwe GNSS Ionosphere Intelligence System.

You specialise in:
- GNSS TEC (Total Electron Content) analysis and interpretation
- Ionospheric physics over southern Africa and equatorial regions
- Space weather effects on GNSS positioning accuracy
- RINEX and CMN file processing and data quality
- Equatorial Ionospheric Anomaly (EIA) detection
- Geomagnetic storm impacts on RTK and PPP solutions
- Zimbabwe CORS network data interpretation

Behaviour rules:
- Give precise, scientific answers with appropriate units (TECU, sfu, nT).
- When asked about TEC values, explain what they mean for GNSS users.
- When space weather is mentioned, link it to GNSS positioning implications.
- If live context is injected below, treat it as current platform data and reference it explicitly.
- If the user provides data (numbers, station names, dates), use them in your analysis.
- Keep answers concise unless the user asks for detail.
- You represent the ZGIIS platform operated by ZINGSA for Zimbabwe.
- Never invent live measurements — if context is missing, say so and answer from theory.
"""


def chat(
    messages: List[Dict[str, str]],
    tec_summary: Optional[dict] = None,
    sw: Optional[dict] = None,
    ekf_summary: Optional[dict] = None,
    live_summary: Optional[dict] = None,
) -> str:
    """Send chat messages to OpenAI and return the assistant reply."""
    key = os.environ.get("OPENAI_API_KEY", "").strip()
    if not key:
        return (
            "The AI assistant is not configured yet. An administrator must set the "
            "server-only OPENAI_API_KEY environment variable."
        )

    context_text, _, _ = build_context_block(tec_summary, sw, ekf_summary, live_summary)
    system = SYSTEM_PROMPT
    if context_text:
        system += f"\n\nLive context injected by ZGIIS platform:\n{context_text}"

    api_messages = [
        {"role": m["role"], "content": m["content"]}
        for m in trim_messages(messages)
        if m.get("role") in {"user", "assistant"} and m.get("content")
    ]

    model = os.environ.get("OPENAI_MODEL", "gpt-5.4")
    max_tokens = int(os.environ.get("OPENAI_MAX_OUTPUT_TOKENS", "1024"))
    body = json.dumps(
        {
            "model": model,
            "instructions": system,
            "input": api_messages,
            "max_output_tokens": max_tokens,
            "store": False,
        }
    ).encode("utf-8")
    request = Request(
        "https://api.openai.com/v1/responses",
        data=body,
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=60) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        request_id = exc.headers.get("x-request-id", "unavailable")
        raise RuntimeError(
            f"OpenAI request failed ({exc.code}; request ID: {request_id})."
        ) from exc
    text_parts = [
        part.get("text", "")
        for item in payload.get("output", [])
        if item.get("type") == "message"
        for part in item.get("content", [])
        if part.get("type") == "output_text"
    ]
    reply = "".join(text_parts).strip()
    if not reply:
        raise RuntimeError("OpenAI returned no assistant text.")
    return reply
