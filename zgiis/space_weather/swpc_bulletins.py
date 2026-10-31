"""Parse NOAA SWPC alert, watch, and warning text.

The dashboard shows the bureau's own bulletin. It does not invent a serial
number or a message code.
"""

from __future__ import annotations

import re
from typing import Any

_HEADLINE = re.compile(
    r"^(CONTINUED ALERT|EXTENDED WARNING|CANCEL WATCH|ALERT|WARNING|WATCH|SUMMARY):\s*(.+)$",
    re.IGNORECASE,
)
_CODE = re.compile(r"Space Weather Message Code:\s*([A-Z0-9]+)", re.IGNORECASE)
_SERIAL = re.compile(r"Serial Number:\s*(\d+)", re.IGNORECASE)
_ISSUE = re.compile(r"Issue Time:\s*(.+)", re.IGNORECASE)
_VALID_FROM = re.compile(r"Valid From:\s*(.+)", re.IGNORECASE)
_VALID_TO = re.compile(r"(?:Valid To|Now Valid Until):\s*(.+)", re.IGNORECASE)
_SCALE = re.compile(r"NOAA Scale:\s*(.+)", re.IGNORECASE)
_CONDITION = re.compile(r"Warning Conditions?:\s*(.+)", re.IGNORECASE)
_CONTINUATION = re.compile(r"Continuation of Serial Number:\s*(\d+)", re.IGNORECASE)
_EXTENSION = re.compile(r"Extension to Serial Number:\s*(\d+)", re.IGNORECASE)


def parse_swpc_bulletin(message: str, product_id: str | None = None) -> dict[str, Any]:
    """Pull the fields operators use from one SWPC bulletin."""
    text = message or ""
    lines = [line.strip() for line in text.splitlines()]
    code_match = _CODE.search(text)
    code = (code_match.group(1) if code_match else product_id or "").strip().upper()
    headline = ""
    kind = ""
    for line in lines:
        found = _HEADLINE.match(line)
        if found:
            kind = found.group(1).upper()
            headline = line
            break
    impacts = _impacts(text)
    scale = _first(_SCALE, text)
    return {
        "code": code or None,
        "serial": _first(_SERIAL, text),
        "kind": kind or None,
        "headline": headline or None,
        "issue_time": _first(_ISSUE, text),
        "valid_from": _first(_VALID_FROM, text),
        "valid_to": _first(_VALID_TO, text),
        "condition": _first(_CONDITION, text),
        "noaa_scale": scale,
        "continuation_of": _first(_CONTINUATION, text),
        "extension_to": _first(_EXTENSION, text),
        "impacts": impacts,
    }


def _first(pattern: re.Pattern[str], text: str) -> str | None:
    found = pattern.search(text)
    if not found:
        return None
    value = found.group(1).strip()
    return value or None


def _impacts(text: str) -> str | None:
    marker = "Potential Impacts:"
    start = text.find(marker)
    if start < 0:
        return None
    body = text[start + len(marker):]
    stop = body.find("NOAA Space Weather Scale")
    if stop >= 0:
        body = body[:stop]
    cleaned = " ".join(line.strip() for line in body.splitlines() if line.strip())
    return cleaned or None
