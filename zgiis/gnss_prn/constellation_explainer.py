"""Constellation summary cards for the PRN Explorer page."""
from __future__ import annotations

from typing import Any, Dict

import pandas as pd


def render_constellation_cards(st, df: pd.DataFrame, constellations: Dict[str, Any]) -> None:
    cols = st.columns(len(constellations))
    for col, (name, cfg) in zip(cols, constellations.items()):
        color = cfg.get("color", "#00d4ff")
        prefix = cfg.get("prefix", "?")
        max_prn = cfg.get("max_prn", 0)

        subset = df[df["constellation"] == name] if "constellation" in df.columns else pd.DataFrame()
        n_prns = subset["prn"].nunique() if not subset.empty else 0
        mean_vtec = subset["vtec"].mean() if not subset.empty and "vtec" in subset.columns else 0.0
        mean_qual = subset["quality_pct"].mean() if not subset.empty and "quality_pct" in subset.columns else 0.0

        with col:
            st.markdown(
                f"<div style='"
                f"background:#0d1b2a;border:1px solid #1e3a5f;border-left:4px solid {color};"
                f"border-radius:10px;padding:14px 16px;margin-bottom:6px'>"
                f"<div style='color:{color};font-size:.62rem;font-weight:900;"
                f"letter-spacing:.1em;text-transform:uppercase'>{prefix} · {name}</div>"
                f"<div style='color:#ffffff;font-size:1.45rem;font-weight:800;margin:4px 0'>"
                f"{n_prns} <span style='font-size:.8rem;font-weight:600'>SVs</span></div>"
                f"<div style='color:#ffffff;font-size:.72rem;margin-top:2px'>"
                f"VTEC: <span style='color:{color};font-weight:700'>{mean_vtec:.1f} TECU</span></div>"
                f"<div style='color:#ffffff;font-size:.72rem'>"
                f"Quality: <span style='font-weight:700'>{mean_qual:.0f}%</span></div>"
                f"<div style='color:#ffffff;font-size:.62rem;margin-top:6px;opacity:.7'>"
                f"PRN range: {prefix}01 – {prefix}{max_prn:02d}</div>"
                f"</div>",
                unsafe_allow_html=True,
            )
