"""Language and accessibility options for Navigation News delivery."""
from __future__ import annotations

from typing import Literal

LanguageCode = Literal["en", "sn", "nd"]
AccessibilityMode = Literal["standard", "deaf", "blind"]

VALID_LANGUAGES = frozenset({"en", "sn", "nd"})
VALID_ACCESSIBILITY = frozenset({"standard", "deaf", "blind"})

LANGUAGE_LABELS: dict[str, str] = {
    "en": "English",
    "sn": "ChiShona",
    "nd": "isiNdebele",
}

ACCESSIBILITY_LABELS: dict[str, str] = {
    "standard": "Standard text",
    "deaf": "Deaf / hard of hearing (visual brief)",
    "blind": "Blind / low vision (screen-reader brief)",
}


def normalize_language(raw: str | None) -> str:
    code = (raw or "en").strip().lower()
    if code in {"shona", "chiShona".lower()}:
        return "sn"
    if code in {"ndebele", "isindebele"}:
        return "nd"
    if code not in VALID_LANGUAGES:
        raise ValueError(f"language must be one of: {', '.join(sorted(VALID_LANGUAGES))}")
    return code


def normalize_accessibility(raw: str | None) -> str:
    mode = (raw or "standard").strip().lower()
    if mode in {"deaf_friendly", "hard_of_hearing", "hoh"}:
        return "deaf"
    if mode in {"blind_friendly", "low_vision", "screen_reader", "tts"}:
        return "blind"
    if mode not in VALID_ACCESSIBILITY:
        raise ValueError(f"accessibility must be one of: {', '.join(sorted(VALID_ACCESSIBILITY))}")
    return mode


def delivery_options_payload() -> dict:
    return {
        "languages": [
            {"id": code, "label": LANGUAGE_LABELS[code]}
            for code in sorted(VALID_LANGUAGES)
        ],
        "accessibility": [
            {"id": code, "label": ACCESSIBILITY_LABELS[code]}
            for code in sorted(VALID_ACCESSIBILITY)
        ],
    }
