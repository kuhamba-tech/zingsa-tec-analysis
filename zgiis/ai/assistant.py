"""ZGIIS AI Ionosphere Assistant powered by Anthropic Claude."""
from __future__ import annotations

import os
from typing import List, Dict, Optional

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
- If the user provides data (numbers, station names, dates), use them in your analysis.
- Keep answers concise unless the user asks for detail.
- You represent the ZGIIS platform operated by ZINGSA for Zimbabwe.
"""


def build_context_block(tec_summary: Optional[dict] = None, sw: Optional[dict] = None) -> str:
    """Build a context string injected before the user question."""
    parts = []
    if tec_summary:
        parts.append(
            f"[Current TEC data — station: {tec_summary.get('station', 'N/A')}, "
            f"mean VTEC: {tec_summary.get('mean_vtec', 'N/A'):.1f} TECU, "
            f"max VTEC: {tec_summary.get('max_vtec', 'N/A'):.1f} TECU, "
            f"samples: {tec_summary.get('samples', 'N/A')}]"
        )
    if sw:
        parts.append(
            f"[Space weather — Kp: {sw.get('kp', 'N/A')}, "
            f"condition: {sw.get('kp_condition', 'N/A')}, "
            f"F10.7: {sw.get('f107', 'N/A')} sfu, "
            f"GNSS risk: {sw.get('gnss_risk', 'N/A')}]"
        )
    return "\n".join(parts)


def chat(
    messages: List[Dict[str, str]],
    tec_summary: Optional[dict] = None,
    sw: Optional[dict] = None,
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

    context = build_context_block(tec_summary, sw)
    system = SYSTEM_PROMPT
    if context:
        system += f"\n\nLive context injected by ZGIIS platform:\n{context}"

    api_messages = [{"role": m["role"], "content": m["content"]} for m in messages]

    response = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=1024,
        system=system,
        messages=api_messages,
    )
    return response.content[0].text
