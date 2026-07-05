"""Audience role labels — aligned with Navigation News briefs on the dashboard."""
from __future__ import annotations

from typing import TypedDict


class AudienceRoleMeta(TypedDict):
    id: str
    role: str
    title: str
    description: str
    icon: str


# Same briefs as /navigation-news and the GNSS Intelligence page.
AUDIENCE_ROLES: tuple[AudienceRoleMeta, ...] = (
    {
        "id": "citizen",
        "role": "Space enthusiast",
        "title": "Space Weather & You",
        "description": "General public, schools & community — how the Sun and ionosphere affect everyday GPS.",
        "icon": "🌌",
    },
    {
        "id": "farmer",
        "role": "Farmer",
        "title": "Farmer Brief",
        "description": "Farmers, agronomists & smart-agri — tractor GPS, RTK, and planting windows.",
        "icon": "🌱",
    },
    {
        "id": "surveyor",
        "role": "Surveyor",
        "title": "Surveyor Brief",
        "description": "Land surveyors, engineers & cadastral teams — cm-level GNSS under space weather.",
        "icon": "📐",
    },
    {
        "id": "driver",
        "role": "Driver & motorist",
        "title": "Driver & Fleet Brief",
        "description": "Taxi, bus, courier & fleet operators — maps, dispatch & live location reliability.",
        "icon": "🚕",
    },
    {
        "id": "aviation",
        "role": "Aviation",
        "title": "Aviation Brief",
        "description": "Pilots, ATC & drone operators — GNSS approach, RAIM & UAS operations.",
        "icon": "✈️",
    },
    {
        "id": "scientist",
        "role": "Scientist",
        "title": "Scientist Brief",
        "description": "Researchers, geophysicists & GNSS analysts — TEC, CORS QC, EKF residuals & storm data.",
        "icon": "🔬",
    },
)

AUDIENCE_ROLE_BY_ID: dict[str, AudienceRoleMeta] = {r["id"]: r for r in AUDIENCE_ROLES}


def audience_role_meta(audience_id: str) -> AudienceRoleMeta | None:
    return AUDIENCE_ROLE_BY_ID.get(audience_id.strip().lower())


def enrich_recipient(recipient: dict) -> dict:
    from zgiis.navigation.delivery_preferences import ACCESSIBILITY_LABELS, LANGUAGE_LABELS

    meta = audience_role_meta(str(recipient.get("audience") or ""))
    lang = str(recipient.get("language") or "en")
    access = str(recipient.get("accessibility") or "standard")
    base = {
        **recipient,
        "language_label": LANGUAGE_LABELS.get(lang, lang),
        "accessibility_label": ACCESSIBILITY_LABELS.get(access, access),
    }
    if not meta:
        return base
    return {
        **base,
        "audience_role": meta["role"],
        "audience_title": meta["title"],
        "audience_description": meta["description"],
        "audience_icon": meta["icon"],
    }
