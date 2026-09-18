"""Render Navigation News briefs for language and accessibility preferences."""
from __future__ import annotations

import re
from typing import Any

from zgiis.navigation.delivery_preferences import normalize_accessibility, normalize_language
from zgiis.navigation.i18n.labels import audience_title, labels_for, status_label, tone_summary

_EMOJI_RE = re.compile(
    "["
    "\U0001F300-\U0001FAFF"
    "\U00002600-\U000027BF"
    "\U0001F1E0-\U0001F1FF"
    "]+",
    flags=re.UNICODE,
)
_BOLD_RE = re.compile(r"\*([^*]+)\*")


def _tone_from_brief(brief: dict[str, Any]) -> str:
    tone = str(brief.get("status_tone") or "excellent").lower()
    if tone not in {"excellent", "moderate", "warning"}:
        return "excellent"
    return tone


def _visual_status(tone: str) -> str:
    if tone == "warning":
        return "🔴 ALERT"
    if tone == "moderate":
        return "🟡 CAUTION"
    return "🟢 OK"


def _strip_markdown(text: str) -> str:
    text = _BOLD_RE.sub(r"\1", text)
    return text.replace("•", "-").strip()


def _strip_emojis(text: str) -> str:
    cleaned = _EMOJI_RE.sub("", text)
    return re.sub(r"[ \t]+", " ", cleaned).strip()


def _expand_for_screen_reader(text: str) -> str:
    replacements = [
        (r"\bGPS\b", "G P S global positioning system"),
        (r"\bRTK\b", "R T K real-time kinematic positioning"),
        (r"\bGNSS\b", "G N S S satellite navigation"),
        (r"\bKp\b", "K-index geomagnetic activity Kp"),
        (r"\bDst\b", "Disturbance storm time Dst"),
        (r"\bS4\b", "S4 scintillation index"),
        (r"\bRAIM\b", "R A I M receiver autonomous integrity monitoring"),
        (r"\bHF\b", "H F high frequency radio"),
    ]
    out = text
    for pattern, repl in replacements:
        out = re.sub(pattern, repl, out, flags=re.IGNORECASE)
    return out


def _format_lines(lines: list[str]) -> str:
    return "\n".join(line for line in lines if line is not None and str(line).strip() != "")


def render_brief_for_recipient(
    brief: dict[str, Any],
    *,
    language: str | None = None,
    accessibility: str | None = None,
    script_kind: str = "broadcast",
) -> str:
    """Build the WhatsApp message text for a recipient's language and accessibility."""
    lang = normalize_language(language)
    mode = normalize_accessibility(accessibility)

    if script_kind == "social":
        base = str(brief.get("social_script") or brief.get("broadcast_script") or "").strip()
        if lang == "en" and mode == "standard":
            return base
        # Social posts stay short; still apply accessibility transforms.
        return _apply_accessibility(base, mode, tone=_tone_from_brief(brief), lang=lang, brief=brief)

    if lang == "en" and mode == "standard":
        return str(brief.get("broadcast_script") or "").strip()

    return _render_structured_brief(brief, lang=lang, mode=mode)


def _render_structured_brief(brief: dict[str, Any], *, lang: str, mode: str) -> str:
    lbl = labels_for(lang)
    tone = _tone_from_brief(brief)
    audience_id = str(brief.get("id") or "citizen")
    title = audience_title(audience_id, lang)
    headline = str(brief.get("headline") or "").strip()
    summary = str(brief.get("summary") or "").strip()
    action = str(brief.get("action") or "").strip()
    sw_today = str(brief.get("space_weather_today") or "").strip()
    sw_bullets = [str(b).strip() for b in (brief.get("space_weather_bullets") or []) if str(b).strip()]
    bullets = [str(b).strip() for b in (brief.get("bullets") or []) if str(b).strip()]
    local_summary = tone_summary(lang, tone)

    lines: list[str] = []

    if mode == "deaf":
        lines.extend([
            lbl["deaf_header"],
            "━━━━━━━━━━━━━━━━━━━━",
            _visual_status(tone),
            f"{lbl['agency']} — {title}",
            f"{status_label(lang, tone)}",
            "━━━━━━━━━━━━━━━━━━━━",
        ])
    elif mode == "blind":
        lines.append(lbl["blind_header"])
        lines.append(f"{lbl['agency']}. {title}.")
        lines.append(f"Status: {status_label(lang, tone)}.")
    else:
        lines.append(f"{lbl['agency']} — {title}")

    if headline:
        lines.append("")
        lines.append(headline if lang == "en" else f"{headline}")

    if local_summary:
        lines.append("")
        lines.append(local_summary)

    if summary and lang == "en":
        lines.append("")
        lines.append(summary)
    elif summary and lang != "en":
        lines.append("")
        lines.append(summary)

    if sw_today:
        lines.append("")
        lines.append(f"{lbl['space_weather']}:")
        lines.append(sw_today)

    if sw_bullets:
        lines.append("")
        lines.append(f"{lbl['live_conditions']}:")
        for i, item in enumerate(sw_bullets, 1):
            prefix = f"{i}." if mode == "blind" else "▸" if mode == "deaf" else "•"
            lines.append(f"{prefix} {item}")

    if bullets:
        lines.append("")
        lines.append(f"{lbl['key_points']}:")
        for i, item in enumerate(bullets, 1):
            prefix = f"Item {i}:" if mode == "blind" else "▸" if mode == "deaf" else "•"
            lines.append(f"{prefix} {item}")

    if action:
        lines.append("")
        lines.append(f"{lbl['action']}:")
        lines.append(action)

    lines.append("")
    lines.append(lbl["footer_contact"])

    text = _format_lines(lines)
    return _apply_accessibility(text, mode, tone=tone, lang=lang, brief=brief)


def _apply_accessibility(text: str, mode: str, *, tone: str, lang: str, brief: dict[str, Any]) -> str:
    if mode == "deaf":
        if "VISUAL BRIEF" not in text and "BRIEF YEKUONA" not in text and "UMBUKO WOKUBUKA" not in text:
            lbl = labels_for(lang)
            text = f"{lbl['deaf_header']}\n{_visual_status(tone)}\n━━━━━━━━━━━━━━━━━━━━\n{text}"
        return text

    if mode == "blind":
        text = _strip_emojis(text)
        text = _strip_markdown(text)
        text = _expand_for_screen_reader(text)
        lbl = labels_for(lang)
        if not text.startswith(lbl["blind_header"][:20]):
            text = f"{lbl['blind_header']}\n{text}"
        return text

    return text
