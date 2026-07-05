"""ZGIIS AI Ionosphere Assistant powered by Anthropic Claude."""
from __future__ import annotations

import os
from typing import List, Dict, Optional

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
    api_key: Optional[str] = None,
) -> str:
    """Send chat messages to Claude and return the assistant reply."""
    try:
        import anthropic
    except ImportError:
        return "anthropic package not installed. Run: pip install anthropic"

    key = api_key or os.environ.get("ANTHROPIC_API_KEY", "")
    if not key:
        return (
            "No ANTHROPIC_API_KEY found. Set it as an environment variable or paste it in the "
            "sidebar to activate the AI assistant."
        )

    client = anthropic.Anthropic(api_key=key)

    context_text, _, _ = build_context_block(tec_summary, sw, ekf_summary, live_summary)
    system = SYSTEM_PROMPT
    if context_text:
        system += f"\n\nLive context injected by ZGIIS platform:\n{context_text}"

    api_messages = [
        {"role": m["role"], "content": m["content"]}
        for m in trim_messages(messages)
        if m.get("role") in {"user", "assistant"} and m.get("content")
    ]

    model = os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-4-6")
    max_tokens = int(os.environ.get("ANTHROPIC_MAX_TOKENS", "1024"))

    response = client.messages.create(
        model=model,
        max_tokens=max_tokens,
        system=system,
        messages=api_messages,
    )
    return response.content[0].text
