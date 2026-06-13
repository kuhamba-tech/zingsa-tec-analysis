"""Processing pipeline stage explanations — Chapter 4 (Gopi K. Seemala)."""
from __future__ import annotations

from typing import Iterable, TypedDict

import streamlit as st

BOOK_CITATION = (
    "Gopi K. Seemala, *Estimation of ionospheric total electron content (TEC) "
    "from GNSS observations*, Ch. 4 in Singh & Tiwari (eds.), "
    "*Atmospheric Remote Sensing: Principles and Applications*, Elsevier, 2022."
)


class KeyRelation(TypedDict, total=False):
    type: str
    caption: str
    formula: str
    text: str


class StageExplanation(TypedDict):
    section: str
    summary: str
    key_relations: list[KeyRelation]
    zgiis: str


PIPELINE_EXPLANATIONS: dict[str, StageExplanation] = {
    "RINEX/CMN loading": {
        "section": "§4.2.1 — GNSS observation data",
        "summary": (
            "Dual-frequency GNSS observation files supply the pseudorange and carrier-phase "
            "measurements needed for TEC retrieval. RINEX observation files contain code "
            "observables (P1/P2 or C1/P2) and phase observables (L1/L2) for each satellite "
            "at every epoch. In the Zimbabwe CORS workflow, GOP first converts daily RINEX "
            "to `.Cmn` files with satellite and receiver biases already applied; this app "
            "can load either raw RINEX or pre-processed CMN products."
        ),
        "key_relations": [
            {
                "type": "latex",
                "caption": "Dual-frequency observables",
                "formula": (
                    r"P_1,\; P_2 \quad \text{(code pseudorange, m)}, \qquad "
                    r"L_1,\; L_2 \quad \text{(carrier phase, cycles)}"
                ),
            },
            {
                "type": "latex",
                "caption": "Carrier frequencies (GPS L1 / L2)",
                "formula": r"f_1 = 1575.42\ \mathrm{MHz}, \qquad f_2 = 1227.60\ \mathrm{MHz}",
            },
            {
                "type": "latex",
                "caption": "TEC conversion constant",
                "formula": r"k = 40.3\ \mathrm{TECU \cdot m^2 / s^2}",
            },
        ],
        "zgiis": (
            "ZGIIS scans the selected folder for `*.o` / `*.Cmn` files, matches them to "
            "Zimbabwe CORS station codes, and prepares the observation table for analysis."
        ),
    },
    "Cycle slip detection": {
        "section": "§4.2.2 — Cycle-slip detection and correction (Eq. 4.13)",
        "summary": (
            "Carrier-phase TEC (TECP) is precise but vulnerable to cycle slips — sudden "
            "integer-phase jumps when the receiver loses lock. Slips contaminate slant TEC "
            "arcs and must be corrected before leveling. The book detects a slip when the "
            "difference between consecutive TECP samples exceeds the scatter "
            "(standard deviation) of the previous ten epochs, then removes the slip offset "
            "from the current and all following samples in the arc."
        ),
        "key_relations": [
            {
                "type": "latex",
                "caption": "Eq. (4.13) — cycle-slip detection",
                "formula": (
                    r"|x_i - x_{i-1}| > \sigma, \qquad "
                    r"\sigma = \mathrm{std}\!\left(x_{i-10},\ldots,x_{i-1}\right)"
                ),
            },
            {
                "type": "latex",
                "caption": "Eq. (4.13) — cycle-slip correction",
                "formula": (
                    r"x_j \leftarrow x_j - \Big[(x_i - x_{i-1}) - \overline{\Delta x}\Big], "
                    r"\qquad j \geq i"
                ),
            },
        ],
        "zgiis": (
            "Implemented in `tec_core._cycle_slip_correct()` and applied per PRN arc inside "
            "`_level_tec_all_prns()` before code–phase leveling."
        ),
    },
    "Satellite bias correction": {
        "section": "§4.2.5 — Satellite differential code bias (Eq. 4.16)",
        "summary": (
            "GNSS satellites and receivers introduce hardware delays that appear as biases "
            "in differential code observations. Satellite Differential Code Bias (DCB) "
            "products from CODE/IGS remove the satellite-specific inter-frequency delay. "
            "If civilian C1 code is used instead of P1, an additional P1−C1 correction "
            "converts observations to a P1-equivalent form before TEC estimation."
        ),
        "key_relations": [
            {
                "type": "latex",
                "caption": "P1−C1 correction (when C1 code is used)",
                "formula": (
                    r"\mathrm{STEC} \leftarrow \mathrm{STEC} - \mathrm{DCB}_{P1C1} "
                    r"\quad \text{(ns converted to TECU)}"
                ),
            },
            {
                "type": "latex",
                "caption": "Satellite P1−P2 differential code bias",
                "formula": r"\mathrm{STEC} \leftarrow \mathrm{STEC} + \mathrm{DCB}_{P1P2}",
            },
        ],
        "zgiis": (
            "Loads monthly `P1C1YYMM.DCB` and `P1P2YYMM.DCB` from the GOP/CODE DCB folder "
            "configured in the sidebar and applies per-PRN corrections before VTEC conversion."
        ),
    },
    "Receiver bias correction": {
        "section": "§4.2.5 — Receiver DCB estimation (Eq. 4.21–4.22)",
        "summary": (
            "Each GNSS receiver also has an unknown inter-frequency bias. After satellite "
            "DCB removal, the receiver bias is estimated by searching for the value that "
            "minimises the total standard deviation of VTEC across all visible satellites "
            "at each epoch. Only elevations above 30° are used, with 3-minute decimated "
            "epochs, following the variable step-size search in the book."
        ),
        "key_relations": [
            {
                "type": "latex",
                "caption": "Eq. (4.21) — receiver DCB search objective",
                "formula": (
                    r"\min_{b}\ \sum_{j} \sigma_j(b), \qquad "
                    r"\sigma_j = \mathrm{std}\!\left(\mathrm{VTEC}_j\right), \quad E_j > 30^\circ"
                ),
            },
            {
                "type": "latex",
                "caption": "Eq. (4.22) — variable step-size search",
                "formula": r"b \in \{50,\; 10,\; 1,\; 0.1\}\ \mathrm{TECU}",
            },
        ],
        "zgiis": (
            "Implemented in `tec_core._estimate_receiver_dcb()`. When CODE DCB files are "
            "unavailable, a relative VTEC bias-removal fallback is applied instead."
        ),
    },
    "Slant TEC calculation": {
        "section": "§4.2.3–4.2.4 — Code & phase TEC, leveling (Eq. 4.11–4.15)",
        "summary": (
            "Slant Total Electron Content (STEC) along the satellite–receiver path is "
            "computed from dual-frequency observables. Code TEC (TECG) uses pseudorange "
            "differences; phase TEC (TECP) uses carrier-phase differences. Phase data are "
            "more precise but need leveling to the code solution. For each continuous arc, "
            "the baseline offset between TECG and slip-corrected TECP is estimated at "
            "elevations > 20° (outliers removed at 2σ) and added to TECP to obtain "
            "leveled slant TEC (TECR/STEC)."
        ),
        "key_relations": [
            {
                "type": "latex",
                "caption": "Eq. (4.11) — code TEC (TECG)",
                "formula": (
                    r"\mathrm{TECG} = k \cdot \frac{P_2 - P_1}{10^{16}} \quad [\mathrm{TECU}]"
                ),
            },
            {
                "type": "latex",
                "caption": "Eq. (4.12) — phase TEC (TECP)",
                "formula": (
                    r"\mathrm{TECP} = k \cdot \frac{L_{1m} - L_{2m}}{10^{16}}, \qquad "
                    r"L_{1m} = \frac{c\,L_1}{f_1},\; L_{2m} = \frac{c\,L_2}{f_2}"
                ),
            },
            {
                "type": "latex",
                "caption": "Eq. (4.14) — outlier rejection for leveling",
                "formula": (
                    r"|x_i - \mu| < 2\sigma \quad \text{(retain sample for baseline)}"
                ),
            },
            {
                "type": "latex",
                "caption": "Eq. (4.15) — leveled slant TEC",
                "formula": (
                    r"\mathrm{STEC} = \mathrm{TECP}_{\mathrm{corrected}} + b_{\mathrm{arc}}, "
                    r"\qquad b_{\mathrm{arc}} = \overline{\mathrm{TECG} - \mathrm{TECP}}"
                ),
            },
        ],
        "zgiis": (
            "Computed in `read_rinex_files()`; CMN files already contain bias-corrected "
            "STEC/VTEC from GOP and skip this RINEX-stage math."
        ),
    },
    "Vertical TEC calculation": {
        "section": "§4.2.4 — Ionospheric mapping function (Eq. 4.16–4.17)",
        "summary": (
            "STEC depends on the slant path through the ionosphere. To compare stations "
            "and times, slant TEC is converted to Vertical TEC (VTEC) at the Ionospheric "
            "Pierce Point (IPP) using a thin-shell model. The mapping function M(E) "
            "relates slant to vertical TEC as a function of satellite elevation angle E "
            "and shell height h (default 350 km, R_e = 6378 km)."
        ),
        "key_relations": [
            {
                "type": "latex",
                "caption": "Eq. (4.16) — ionospheric mapping function",
                "formula": (
                    r"M(E) = \frac{1}{\sqrt{1 - \left(\dfrac{R_e \cos E}{R_e + h}\right)^2}}"
                ),
            },
            {
                "type": "latex",
                "caption": "Eq. (4.17) — vertical TEC",
                "formula": r"\mathrm{VTEC} = \frac{\mathrm{STEC}}{M(E)}",
            },
            {
                "type": "latex",
                "caption": "Equivalent slant factor",
                "formula": (
                    r"\mathrm{VTEC} = \mathrm{STEC} \cdot S(E), \qquad S(E) = \frac{1}{M(E)}"
                ),
            },
        ],
        "zgiis": (
            "Applied in `tec_core._mapping_function()` with configurable IPP height. "
            "Observations below the elevation mask (default ≥ 25°) are excluded before "
            "daily, monthly, and yearly summaries."
        ),
    },
    "Map/table generation": {
        "section": "§4.3 — TEC products, visualization & interpretation",
        "summary": (
            "Processed TEC is organised into time series, station tables, and maps for "
            "ionospheric monitoring. The book emphasises presenting VTEC against elevation "
            "and local time to reveal diurnal structure, equatorial anomalies, and storm "
            "enhancements. Maps show the spatial distribution of TEC over the CORS network; "
            "tables support monthly means, storm detection, and comparison with geomagnetic "
            "indices such as Kp."
        ),
        "key_relations": [
            {"type": "bullet", "text": "IPP coordinates from station latitude/longitude and satellite azimuth/elevation"},
            {"type": "bullet", "text": "Storm flagging: elevated VTEC relative to monthly quiet-day baseline"},
            {"type": "bullet", "text": "Outputs: daily mean / max / min, 24 h profiles, Kp scatter plots"},
        ],
        "zgiis": (
            "Exports CSV summaries to `tec_python_outputs/`, renders GOP-style TEC–elevation "
            "plots, Zimbabwe CORS maps, heat maps, and TEC anomaly detection PDF reports."
        ),
    },
}


def _render_key_relations(items: list[KeyRelation]) -> None:
    """Render Key relations with proper LaTeX typesetting."""
    parts: list[str] = []
    for item in items:
        if item.get("type") == "latex":
            caption = item.get("caption", "")
            formula = item.get("formula", "")
            cap_line = f"**{caption}**\n\n" if caption else ""
            parts.append(f"{cap_line}$${formula}$$")
        elif item.get("type") == "bullet":
            parts.append(f"- {item.get('text', '')}")
    if parts:
        st.markdown("\n\n".join(parts))


def render_pipeline_explorer(
    stages: Iterable[tuple[str, str]],
    *,
    key_prefix: str = "proc_pipeline",
    stage_states: dict[int, str] | None = None,
) -> None:
    """
    Render clickable pipeline stage cards and show the Chapter 4 explanation below.

    stage_states: optional map {index: 'idle'|'active'|'done'} for processing highlights.
    """
    stage_list = list(stages)
    state_key = f"{key_prefix}_selected"
    if state_key not in st.session_state:
        st.session_state[state_key] = stage_list[0][0] if stage_list else None

    st.markdown("<div class='pipeline-explorer-row'></div>", unsafe_allow_html=True)
    cols = st.columns(len(stage_list))

    for idx, (stage, icon) in enumerate(stage_list):
        with cols[idx]:
            if st.button(
                f"{icon}\n{stage}",
                key=f"{key_prefix}_btn_{idx}",
                use_container_width=True,
                type="secondary",
            ):
                st.session_state[state_key] = stage
                st.rerun()

    selected_stage = st.session_state.get(state_key)
    explanation = PIPELINE_EXPLANATIONS.get(selected_stage or "")
    if not explanation:
        return

    st.markdown(
        f"<div class='pipeline-explain-panel'>"
        f"<div class='pipeline-explain-title'>{selected_stage}</div>"
        f"<div class='pipeline-explain-section'>{explanation['section']}</div>"
        f"<p class='pipeline-explain-body'>{explanation['summary']}</p>"
        f"<div class='pipeline-explain-heading'>Key relations</div>"
        f"</div>",
        unsafe_allow_html=True,
    )

    _render_key_relations(explanation["key_relations"])

    st.markdown(
        f"<div class='pipeline-explain-panel pipeline-explain-panel-tail'>"
        f"<div class='pipeline-explain-heading'>In ZGIIS</div>"
        f"<p class='pipeline-explain-body'>{explanation['zgiis']}</p>"
        f"<div class='pipeline-explain-cite'>{BOOK_CITATION}</div>"
        f"</div>",
        unsafe_allow_html=True,
    )
