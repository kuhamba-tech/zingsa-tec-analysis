"""PRN Explorer constellation theory payload for the Next.js frontend."""
from __future__ import annotations

from zgiis.gnss_prn.constellation_explainer import (
    CONSTELLATION_EXPLANATIONS,
    CONSTELLATION_ICONS,
    CONSTELLATION_KEYS,
    CONSTELLATION_LABELS,
)
from zgiis.processing.pipeline_explanations import BOOK_CITATION

CONSTELLATIONS = {
    "GPS": {"prefix": "G", "max_prn": 32, "color": "#168bd2"},
    "Galileo": {"prefix": "E", "max_prn": 36, "color": "#00ff88"},
    "BeiDou": {"prefix": "C", "max_prn": 63, "color": "#ff8c00"},
    "GLONASS": {"prefix": "R", "max_prn": 24, "color": "#a78bfa"},
}


def build_prn_constellation_payload() -> dict:
    items = []
    for name in CONSTELLATION_KEYS:
        cfg = CONSTELLATIONS[name]
        info = CONSTELLATION_EXPLANATIONS.get(name, {})
        metrics = [
            {"label": label, "text": text}
            for label, text in info.get("metrics", [])
        ]
        items.append({
            "id": name,
            "label": CONSTELLATION_LABELS.get(name, name),
            "icon": CONSTELLATION_ICONS.get(name, "🛰️"),
            "prefix": cfg["prefix"],
            "max_prn": cfg["max_prn"],
            "color": cfg["color"],
            "prn_range": f"{cfg['prefix']}01–{cfg['prefix']}{cfg['max_prn']:02d}",
            "section": info.get("section", ""),
            "summary": info.get("summary", ""),
            "frequencies": info.get("frequencies", ""),
            "metrics": metrics,
            "formula_caption": info.get("formula_caption", ""),
            "formula": info.get("formula", ""),
            "zgiis": info.get("zgiis", ""),
        })
    return {
        "constellations": items,
        "citation": BOOK_CITATION,
        "quality_note": (
            "Arc quality (0–100%) combines carrier-to-noise (CNR), elevation, "
            "cycle-slip integrity, and code–phase leveling stability. Values below "
            "70% suggest excluding that PRN from VTEC mapping."
        ),
    }
