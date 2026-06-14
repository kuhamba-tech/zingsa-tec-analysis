"""Clickable GNSS constellation cards — Home hero card design + Chapter 4 explanations."""
from __future__ import annotations

from typing import Any, Dict, Optional

import pandas as pd
import streamlit as st

from zgiis.processing.pipeline_explanations import BOOK_CITATION

# Match Home.py hero metric cards (image 1 reference)
HERO_VALUE_COLOR = "#00d4ff"
HERO_WARN_COLOR = "#EF9F27"

CONSTELLATION_KEYS = ("GPS", "Galileo", "BeiDou", "GLONASS")

CONSTELLATION_ICONS = {
    "GPS": "🛰️",
    "Galileo": "🌌",
    "BeiDou": "🔶",
    "GLONASS": "📡",
}

CONSTELLATION_LABELS = {
    "GPS": "GPS",
    "Galileo": "Galileo",
    "BeiDou": "BeiDou",
    "GLONASS": "GLONASS",
}

CONSTELLATION_EXPLANATIONS: Dict[str, Dict[str, Any]] = {
    "GPS": {
        "section": "§4.2.1 — GNSS observation data (GPS / NAVSTAR)",
        "summary": (
            "GPS is the reference constellation for ionospheric TEC in Chapter 4. "
            "Each space vehicle (SV) transmits dual-frequency L1/L2 signals. The "
            "differential code and phase delay between frequencies is proportional to "
            "slant total electron content — the basis of Zimbabwe CORS monitoring."
        ),
        "frequencies": "L1 = 1575.42 MHz · L2 = 1227.60 MHz (CDMA)",
        "metrics": [
            ("SVs", "Unique GPS satellites (G01–G32) with observations above your elevation mask."),
            ("VTEC", "Mean vertical TEC (TECU) after slant-to-vertical mapping (Eq. 4.16–4.17)."),
            ("Quality", "Arc quality (0–100%) from elevation, cycle-slip integrity, and code–phase leveling."),
            ("PRN range", "RINEX satellite identifiers; not every slot is always active."),
        ],
        "formula_caption": "Dual-frequency code TEC (Eq. 4.11)",
        "formula": r"\mathrm{TECG} = k \cdot \frac{P_2 - P_1}{10^{16}} \quad [\mathrm{TECU}], \qquad k = 40.3\ \mathrm{TECU \cdot m^2 / s^2}",
        "zgiis": "GPS anchors ZGIIS processing. CODE/IGS DCB files correct satellite biases before VTEC.",
    },
    "Galileo": {
        "section": "§4.2.1 — Multi-GNSS augmentation (Galileo)",
        "summary": (
            "Galileo adds European GNSS capacity using the same dual-frequency TEC "
            "formulation as GPS. Extra SVs increase ionospheric pierce points and "
            "temporal sampling over Zimbabwe, especially near the equatorial "
            "ionization anomaly at local noon."
        ),
        "frequencies": "E1 = 1575.42 MHz · E5a = 1176.45 MHz (CDMA)",
        "metrics": [
            ("SVs", "Galileo satellites (E01–E36) observed in the current dataset."),
            ("VTEC", "Constellation-mean VTEC after thin-shell mapping."),
            ("Quality", "Arc quality for Galileo tracks."),
            ("PRN range", "E-prefix PRNs in RINEX."),
        ],
        "formula_caption": "Vertical TEC (Eq. 4.17)",
        "formula": r"\mathrm{VTEC} = \frac{\mathrm{STEC}}{M(E)}, \qquad M(E) = \frac{1}{\sqrt{1 - \left(\dfrac{R_e \cos E}{R_e + h}\right)^2}}",
        "zgiis": "Galileo extends sky plots and VTEC time series for denser IPP sampling.",
    },
    "BeiDou": {
        "section": "§4.2.1 — Multi-GNSS augmentation (BeiDou)",
        "summary": (
            "BeiDou contributes GEO, IGSO, and MEO satellites valuable at low latitudes. "
            "Chapter 4 maps each SV's STEC to VTEC through the 350 km thin-shell model."
        ),
        "frequencies": "B1I = 1561.098 MHz · B3I = 1268.520 MHz (CDMA)",
        "metrics": [
            ("SVs", "BeiDou PRNs (C01–C63) in the session."),
            ("VTEC", "Mean BeiDou VTEC."),
            ("Quality", "Arc quality for BeiDou arcs."),
            ("PRN range", "C-prefix identifiers on G/R/E/C ZimCORS receivers."),
        ],
        "formula_caption": "Leveled slant TEC (Eq. 4.15)",
        "formula": r"\mathrm{STEC} = \mathrm{TECP}_{\mathrm{corrected}} + b_{\mathrm{arc}}",
        "zgiis": "BeiDou strengthens diurnal VTEC statistics across the network.",
    },
    "GLONASS": {
        "section": "§4.2.1 — GNSS observation data (GLONASS / FDMA)",
        "summary": (
            "GLONASS uses FDMA with per-satellite carrier offsets. Chapter 4 applies "
            "dual-frequency differences for TEC; GLONASS needs `.g` nav files and "
            "constellation-specific DCB handling."
        ),
        "frequencies": "L1 ≈ 1602 + k·0.5625 MHz · L2 ≈ 1246 + k·0.4375 MHz (FDMA)",
        "metrics": [
            ("SVs", "GLONASS satellites (R01–R24) with usable observations."),
            ("VTEC", "Mean GLONASS VTEC complementing GPS/Galileo geometry."),
            ("Quality", "Arc quality — cycle slips (Eq. 4.13) affect phase TEC."),
            ("PRN range", "R-prefix PRNs; browse `.g` nav on the Processing page."),
        ],
        "formula_caption": "Phase TEC & cycle-slip detection (Eq. 4.12–4.13)",
        "formula": (
            r"\mathrm{TECP} = k \cdot \frac{L_{1m} - L_{2m}}{10^{16}}, \qquad "
            r"|x_i - x_{i-1}| > \sigma \Rightarrow \text{cycle slip}"
        ),
        "zgiis": "GLONASS improves multi-constellation sky coverage on the polar sky plot.",
    },
}


def _constellation_stats(df: pd.DataFrame, name: str) -> tuple[int, float, float]:
    if "constellation" not in df.columns:
        return 0, 0.0, 0.0
    subset = df[df["constellation"] == name]
    if subset.empty:
        return 0, 0.0, 0.0
    n_prns = int(subset["prn"].nunique()) if "prn" in subset.columns else 0
    mean_vtec = float(subset["vtec"].mean()) if "vtec" in subset.columns else 0.0
    mean_qual = float(subset["quality_pct"].mean()) if "quality_pct" in subset.columns else 0.0
    return n_prns, mean_vtec, mean_qual


def _hero_card_html(
    name: str,
    cfg: dict[str, Any],
    n_prns: int,
    mean_vtec: float,
    mean_qual: float,
    *,
    selected: bool = False,
) -> str:
    """Exact Home.py hero-status-card layout and colours (image 1)."""
    icon = CONSTELLATION_ICONS.get(name, "🛰️")
    label = CONSTELLATION_LABELS.get(name, name)
    prefix = cfg["prefix"]
    max_prn = cfg["max_prn"]
    value = f"{n_prns} Satellites"
    value_color = HERO_WARN_COLOR if mean_qual < 70 else HERO_VALUE_COLOR
    note = f"VTEC: {mean_vtec:.1f} TECU · Quality: {mean_qual:.0f}%"
    subnote = f"PRN {prefix}01–{prefix}{max_prn:02d}"
    selected_cls = " hero-click-selected" if selected else ""
    return (
        f"<div class='zgiis-card zgiis-card-accent hero-status-card hero-click-card{selected_cls}'>"
        f"<span class='hero-status-icon'>{icon}</span>"
        f"<div class='hero-status-label prn-const-label'>{label}</div>"
        f"<div class='hero-status-value' style='color:{value_color}'>{value}</div>"
        f"<div class='hero-status-note'>{note}</div>"
        f"<div class='hero-status-note' style='font-size:0.58rem;opacity:0.78;"
        f"padding-top:0.15rem'>{subnote}</div>"
        f"</div>"
    )


def _render_explanation(
    constellation: str,
    cfg: dict[str, Any],
    n_prns: int,
    mean_vtec: float,
    mean_qual: float,
) -> None:
    info = CONSTELLATION_EXPLANATIONS.get(constellation)
    if not info:
        return

    prefix = cfg["prefix"]
    max_prn = cfg["max_prn"]
    metrics_html = "".join(
        f"<span><strong>{label}</strong> — {text}</span>"
        for label, text in info.get("metrics", [])
    )

    st.markdown(
        f"<div class='pipeline-explain-panel'>"
        f"<div class='pipeline-explain-title'>{CONSTELLATION_LABELS.get(constellation, constellation)}</div>"
        f"<div class='pipeline-explain-section'>{info['section']}</div>"
        f"<p class='pipeline-explain-body' style='color:#00d4ff;font-weight:700'>"
        f"Current: {n_prns} Satellites · mean VTEC {mean_vtec:.1f} TECU · "
        f"quality {mean_qual:.0f}% · PRN {prefix}01–{prefix}{max_prn:02d}</p>"
        f"<p class='pipeline-explain-body'>{info['summary']}</p>"
        f"<p class='pipeline-explain-body'><strong>Frequencies:</strong> {info['frequencies']}</p>"
        f"<div class='pipeline-explain-heading'>What the card values mean</div>"
        f"<div style='display:grid;gap:0.35rem;margin:0.5rem 0 0.75rem'>{metrics_html}</div>"
        f"</div>",
        unsafe_allow_html=True,
    )

    caption = info.get("formula_caption", "")
    formula = info.get("formula", "")
    if formula:
        st.markdown(f"**{caption}**\n\n$${formula}$$")

    st.markdown(
        f"<div class='pipeline-explain-panel pipeline-explain-panel-tail'>"
        f"<div class='pipeline-explain-heading'>In ZGIIS</div>"
        f"<p class='pipeline-explain-body'>{info['zgiis']}</p>"
        f"<div class='pipeline-explain-cite'>{BOOK_CITATION}</div>"
        f"</div>",
        unsafe_allow_html=True,
    )


def _constellation_button_label(
    name: str,
    cfg: dict[str, Any],
    n_prns: int,
    mean_vtec: float,
    mean_qual: float,
) -> str:
    icon = CONSTELLATION_ICONS.get(name, "🛰️")
    label = CONSTELLATION_LABELS.get(name, name)
    prefix = cfg["prefix"]
    max_prn = cfg["max_prn"]
    return (
        f"{icon}\n{label}\n{n_prns} Satellites\n"
        f"VTEC: {mean_vtec:.1f} TECU · Quality: {mean_qual:.0f}%\n"
        f"PRN {prefix}01–{prefix}{max_prn:02d}"
    )


def render_constellation_cards(
    st_module,
    df: pd.DataFrame,
    constellations: dict[str, dict[str, Any]],
    *,
    session_key: str = "prn_const_sel",
) -> None:
    """Constellation cards as clickable buttons — same pattern as Processing Pipeline."""
    st_module.markdown(
        "<div class='prn-const-hint' style='font-size:0.72rem;color:#ffffff;"
        "margin:0 0 0.6rem'>Click a card for Chapter 4 explanation of Satellites, "
        "VTEC, quality, and PRN range.</div>"
        "<div class='prn-const-explorer-row'></div>",
        unsafe_allow_html=True,
    )

    if session_key not in st_module.session_state:
        st_module.session_state[session_key] = None

    cols = st_module.columns(4)
    for col, name in zip(cols, CONSTELLATION_KEYS):
        cfg = constellations[name]
        n_prns, mean_vtec, mean_qual = _constellation_stats(df, name)
        active = st_module.session_state[session_key] == name
        with col:
            if st_module.button(
                _constellation_button_label(name, cfg, n_prns, mean_vtec, mean_qual),
                key=f"prn_const_btn_{name}",
                use_container_width=True,
                type="primary" if active else "secondary",
            ):
                st_module.session_state[session_key] = (
                    None if st_module.session_state[session_key] == name else name
                )
                st_module.rerun()

    selected: Optional[str] = st_module.session_state.get(session_key)
    if selected and selected in constellations:
        n_prns, mean_vtec, mean_qual = _constellation_stats(df, selected)
        _render_explanation(selected, constellations[selected], n_prns, mean_vtec, mean_qual)
