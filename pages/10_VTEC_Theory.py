"""ZGIIS — Calculating VTEC: Theory & Equations (Chapter 4, Singh & Tiwari 2022)."""
from __future__ import annotations
import sys
from pathlib import Path

import streamlit as st

root = Path(__file__).resolve().parents[1]
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from zgiis.processing.ipp_diagram import IPP_LEGEND_HTML, render_ipp_diagram_streamlit
from zgiis.processing.pipeline_explanations import render_pipeline_overview_cards
from zgiis.processing.vtec_illustrations import (
    render_vtec_illustration,
    render_vtec_steps_journey,
)
from zgiis.processing.vtec_equations import (
    EQ_4_1,
    EQ_4_2,
    EQ_4_3,
    EQ_4_4,
    EQ_4_5,
    EQ_4_8,
    EQ_4_10,
    EQ_4_12,
    EQ_4_13,
    EQ_4_14,
    EQ_4_15,
    EQ_4_16,
    EQ_4_17,
    EQ_4_18,
    EQ_4_19,
    EQ_4_20,
    EQ_4_21,
    EQ_4_22,
    VARS_STEP_1,
    VARS_STEP_2,
    VARS_STEP_3,
    VARS_STEP_4,
    VARS_STEP_4B,
    VARS_STEP_5,
    VARS_STEP_6,
    VARS_STEP_7,
    VARS_STEP_8,
    VARS_STEP_9,
    VARS_STEP_10,
    render_book_equation,
)
from zgiis.theme import inject

st.set_page_config(
    page_title="ZGIIS — Calculating VTEC",
    page_icon="📐",
    layout="wide",
)
inject(st, page_id="vtec_theory")


# ─── helpers ──────────────────────────────────────────────────────────────────
def _step(num: str, title: str, accent: str = "#168bd2") -> None:
    st.markdown(
        f"<div style='display:flex;align-items:center;gap:0.9rem;margin:2rem 0 0.6rem'>"
        f"<div style='background:{accent};color:#000000;font-size:0.72rem;font-weight:900;"
        f"letter-spacing:0.08em;padding:0.3rem 0.65rem;border-radius:20px;white-space:nowrap'>"
        f"STEP {num}</div>"
        f"<div style='font-size:1.15rem;font-weight:800;color:#ffffff'>{title}</div>"
        f"</div>",
        unsafe_allow_html=True,
    )


def _card(body: str, border: str = "#244d73") -> None:
    st.markdown(
        f"<div style='background:#000000;border:1px solid {border};"
        f"border-left:4px solid {border};border-radius:10px;"
        f"padding:1.1rem 1.3rem;margin-bottom:0.5rem;color:#ffffff;"
        f"font-size:0.88rem;line-height:1.7'>{body}</div>",
        unsafe_allow_html=True,
    )


def _why(text: str) -> None:
    st.markdown(
        f"<div class='vtec-why-box'>"
        f"<span class='vtec-why-label'>Why this matters · </span>"
        f"<span class='vtec-why-text'>{text}</span></div>",
        unsafe_allow_html=True,
    )


def _vars(rows: list[tuple[str, str]]) -> None:
    html = (
        "<div class='vtec-vars-wrap'>"
        "<div class='vtec-vars-title'>Where</div>"
        "<table class='vtec-vars-table'>"
    )
    for sym, meaning in rows:
        html += (
            f"<tr><td class='vtec-vars-sym'>{sym}</td>"
            f"<td class='vtec-vars-meaning'>{meaning}</td></tr>"
        )
    html += "</table></div>"
    st.markdown(html, unsafe_allow_html=True)


def _explain(card_body: str, why_text: str, step_id: str, border: str = "#244d73") -> None:
    """Concept text on the left, illustration on the right."""
    text_col, fig_col = st.columns([5, 4], gap="medium")
    with text_col:
        _card(card_body, border=border)
        _why(why_text)
    with fig_col:
        st.markdown(
            "<div style='font-size:0.68rem;color:#168bd2;font-weight:700;"
            "letter-spacing:0.06em;text-transform:uppercase;margin-bottom:0.35rem'>"
            "Illustration</div>",
            unsafe_allow_html=True,
        )
        st.markdown(render_vtec_illustration(step_id), unsafe_allow_html=True)


# ─── Hero ─────────────────────────────────────────────────────────────────────
st.markdown(
    "<div style='background:linear-gradient(135deg,#000000,#000000,#000000);"
    "border:1px solid #244d73;border-left:5px solid #168bd2;border-radius:14px;"
    "padding:2rem 2.2rem;margin-bottom:0.5rem'>"
    "<div style='font-size:0.72rem;color:#168bd2;font-weight:800;letter-spacing:0.12em;"
    "text-transform:uppercase;margin-bottom:0.4rem'>ZGIIS · Ionospheric TEC Theory</div>"
    "<div style='font-size:2rem;font-weight:900;color:#ffffff;line-height:1.2;"
    "margin-bottom:0.6rem'>📐 Calculating Vertical TEC (VTEC)</div>"
    "<div style='font-size:0.92rem;color:#ffffff;opacity:0.85;max-width:780px;line-height:1.65'>"
    "A step-by-step derivation of Vertical Total Electron Content from dual-frequency GNSS "
    "observations, following the method of Gopi Krishna Seemala as presented in "
    "<em>Atmospheric Remote Sensing: Principles and Applications</em>, "
    "Abhay Kumar Singh &amp; Shani Tiwari (eds.), Chapter 4, Elsevier, 2022."
    "</div>"
    "<div style='margin-top:0.8rem;font-size:0.78rem;color:#ffffff'>"
    "GPS L1 = 1575.42 MHz &nbsp;·&nbsp; GPS L2 = 1227.60 MHz &nbsp;·&nbsp; "
    "1 TECU = 10¹⁶ electrons m⁻²"
    "</div></div>",
    unsafe_allow_html=True,
)

st.markdown(
    "<div style='font-size:0.82rem;color:#ffffff;background:#000000;border:1px solid #244d73;"
    "border-radius:8px;padding:0.8rem 1.1rem;margin-bottom:0.6rem'>"
    "📖 &nbsp;<strong>Reading order:</strong> Steps 1 → 10 follow the exact computational "
    "sequence implemented in GPS_TEC v3.5. Each step builds on the previous one. "
    "Equations are numbered (4.1 – 4.22) as in the source chapter and typeset in display form "
    "with centred expressions and right-aligned equation numbers, as in a textbook."
    "</div>",
    unsafe_allow_html=True,
)
st.markdown(render_vtec_steps_journey(), unsafe_allow_html=True)
render_pipeline_overview_cards()


# ══════════════════════════════════════════════════════════════════════════════
# STEP 1 — Ionospheric Delay
# ══════════════════════════════════════════════════════════════════════════════
_step("1", "Ionospheric Delay on a Trans-Ionospheric Signal", "#168bd2")

_explain(
    "GNSS signals are radio waves. As they pass through the ionosphere — a layer of "
    "free electrons between roughly 50 km and 1000 km altitude — the electrons slow "
    "down (and slightly bend) the signal. The extra distance the signal appears to travel "
    "compared to the true geometric range is called the <strong>ionospheric delay</strong> δρ. "
    "It is measured by integrating the refractive index along the ray path from satellite to receiver.",
    "Without correcting for ionospheric delay, a GNSS position error of up to tens of metres "
    "can occur. At GPS L1, a TEC of 100 TECU causes ~16 m of range error. "
    "Quantifying δρ is the foundation of all TEC estimation.",
    "1",
    border="#168bd2",
)

render_book_equation(
    st, EQ_4_1, "4.1",
    "Ionospheric range delay along the line of sight",
)
_vars(VARS_STEP_1)


# ══════════════════════════════════════════════════════════════════════════════
# STEP 2 — Refractive Index & the 40.3 Constant
# ══════════════════════════════════════════════════════════════════════════════
_step("2", "Ionospheric Refractive Index — Deriving the 40.3 Constant", "#00ff88")

_explain(
    "The refractive index η of the ionosphere depends on signal frequency and electron density. "
    "Starting from the full <strong>Appleton-Hartree formula</strong> (Eq. 4.2), and noting that "
    "GNSS carrier frequencies are much higher than the plasma frequency, the expression simplifies "
    "to a first-order approximation. After substituting physical constants "
    "(electron mass m = 9.109×10⁻³¹ kg, charge e = 1.602×10⁻¹⁹ C, "
    "permittivity ε = 8.854×10⁻¹² F m⁻¹), two clean results emerge — one for phase and one for group velocity.",
    "The sign difference between phase and group refractive indices is critical: "
    "carrier phase observations experience a phase <em>advance</em> (shorter apparent range), "
    "while pseudorange/code experiences a group <em>delay</em> (longer apparent range). "
    "Both are needed to eliminate phase ambiguity during levelling (Step 5).",
    "2",
    border="#00ff88",
)

render_book_equation(
    st, EQ_4_2, "4.2",
    "Appleton–Hartree refractive index (simplified when ω ≫ ω_p)",
)
render_book_equation(
    st, EQ_4_3, "4.3",
    "Phase refractive index — first-order approximation",
)
render_book_equation(
    st, EQ_4_4, "4.4",
    "Group refractive index — first-order approximation",
)
_vars(VARS_STEP_2)


# ══════════════════════════════════════════════════════════════════════════════
# STEP 3 — Integrating to get TEC and Ionospheric Delay in Metres
# ══════════════════════════════════════════════════════════════════════════════
_step("3", "Slant TEC Definition and Delay in Metres", "#a78bfa")

_explain(
    "Integrating the refractive index from satellite to receiver converts the density profile "
    "into a single number: <strong>Total Electron Content (TEC)</strong> — the total number of "
    "free electrons in a column of 1 m² cross-section along the signal path. "
    "TEC is expressed in <strong>TECU</strong> where 1 TECU = 10¹⁶ electrons m⁻². "
    "The ionospheric delay in metres is then simply proportional to TEC and inversely proportional "
    "to the square of the carrier frequency, making GNSS a <em>dispersive</em> medium — "
    "the key property that allows dual-frequency receivers to measure TEC.",
    "By measuring the <em>difference</em> in delay on two frequencies from the same satellite, "
    "all non-dispersive errors (troposphere, clock, geometry) cancel, leaving only the "
    "ionospheric contribution. This is why two frequencies are essential.",
    "3",
    border="#a78bfa",
)

render_book_equation(
    st, EQ_4_5, "4.5",
    "Ionospheric range delay in metres — link between delay and STEC",
)
_vars(VARS_STEP_3)


# ══════════════════════════════════════════════════════════════════════════════
# STEP 4 — STEC from Code (Pseudorange) Measurements
# ══════════════════════════════════════════════════════════════════════════════
_step("4", "STEC from Dual-Frequency Pseudorange (Code) Observations", "#f472b6")

_explain(
    "A dual-frequency receiver measures pseudoranges C₁ and C₂ on L1 and L2. "
    "Because all non-dispersive effects (satellite–receiver geometry, troposphere, clocks) "
    "are <em>identical</em> on both frequencies, subtracting C₂ − C₁ cancels them all, "
    "leaving only the differential ionospheric delay. "
    "Rearranging Eq. 4.9 for both frequencies and taking the difference gives "
    "<strong>TEC_G</strong> — the <em>absolute but noisy</em> code-derived TEC.",
    "Code TEC (TEC_G) gives an absolute TEC value but with pseudorange noise of ~0.3 m "
    "(≈ 2 TECU on L1). It is used as the absolute reference during levelling in Step 5.",
    "4",
    border="#f472b6",
)

render_book_equation(
    st, EQ_4_8, "4.8",
    "Differential code delay — non-dispersive terms cancel",
)
render_book_equation(
    st, EQ_4_10, "4.10",
    "Absolute (noisy) TEC from dual-frequency pseudoranges",
)
_vars(VARS_STEP_4)


# ══════════════════════════════════════════════════════════════════════════════
# STEP 4b — STEC from Carrier Phase Measurements
# ══════════════════════════════════════════════════════════════════════════════
_step("4b", "STEC from Dual-Frequency Carrier Phase Observations", "#f59e0b")

_explain(
    "Carrier phase measurements L₁ and L₂ are about 100× more precise than pseudoranges, "
    "with noise at the millimetre level (~0.003 TECU). However, they contain an unknown "
    "integer ambiguity — the receiver does not know how many full carrier cycles elapsed "
    "before it started tracking. The phase-derived TEC (<strong>TEC_P</strong>) is therefore "
    "<em>relative</em> — it tracks changes precisely but cannot give an absolute level without "
    "additional processing. L₁ and L₂ here are carrier phase measurements expressed in metres "
    "(i.e. L = λ × φ where φ is phase in cycles).",
    "TEC_P captures fine ionospheric structure — wave-like travelling ionospheric disturbances "
    "(TIDs), scintillation onset — that TEC_G misses in the noise. "
    "Combining both (Step 5) gives the best of both worlds.",
    "4b",
    border="#f59e0b",
)

render_book_equation(
    st, EQ_4_12, "4.12",
    "Precise but ambiguous TEC from dual-frequency carrier phase",
)
_vars(VARS_STEP_4B)


# ══════════════════════════════════════════════════════════════════════════════
# STEP 5 — Cycle Slip Detection & Correction
# ══════════════════════════════════════════════════════════════════════════════
_step("5", "Cycle Slip Detection and Correction", "#168bd2")

_explain(
    "Before levelling, the phase TEC arc must be free of <strong>cycle slips</strong> — "
    "sudden discontinuities caused when the receiver's phase-lock loop (PLL) loses lock, "
    "typically during ionospheric scintillation or signal obstruction. "
    "A cycle slip appears as an abrupt jump in TEC_P. "
    "Seemala's GPS_TEC method uses a simple <em>adaptive arithmetic</em> algorithm: "
    "if the difference between consecutive TEC_P values exceeds the standard deviation "
    "of the previous 10 samples, a slip is flagged and corrected by an offset equal to "
    "the running mean of the previous 5 differences. "
    "No fixed threshold is needed — the algorithm adapts to any sampling rate.",
    "An uncorrected cycle slip introduces an artificial step of one or more TECU into the "
    "phase TEC arc, which would corrupt the levelling offset calculated in Step 5. "
    "Slip correction is mandatory before any subsequent processing.",
    "5",
    border="#168bd2",
)

render_book_equation(
    st, EQ_4_13, "4.13",
    "Adaptive cycle-slip detector — σ₁₀ is the std dev of the previous 10 TEC_P samples",
)
_vars(VARS_STEP_5)


# ══════════════════════════════════════════════════════════════════════════════
# STEP 6 — TEC Levelling
# ══════════════════════════════════════════════════════════════════════════════
_step("6", "TEC Levelling — Combining Code and Phase to get Slant TEC", "#00ff88")

_explain(
    "TEC_P has ~0.003 TECU precision but an unknown offset (ambiguity). "
    "TEC_G has no ambiguity but ~2 TECU noise. "
    "<strong>Levelling</strong> resolves this by computing the mean difference "
    "(TEC_G − TEC_P) over a single continuous satellite arc at elevation &gt; 20°. "
    "That mean difference is the arc's ambiguity estimate. "
    "Adding it to the phase TEC produces <strong>TEC_R</strong> — slant TEC that is "
    "both precise (phase noise level) and absolute (code level), "
    "with outliers in the difference removed using a 2σ MAD filter (Eq. 4.14).",
    "TEC_R is the input to all downstream VTEC, DCB, and IPP calculations. "
    "Levelling errors of even 1–2 TECU propagate directly into VTEC values, "
    "so outlier rejection during offset estimation is critical. "
    "Low-elevation data (< 20°) are excluded to reduce multipath contamination.",
    "6",
    border="#00ff88",
)

render_book_equation(
    st, EQ_4_14, "4.14",
    "Outlier rejection using 2σ criterion on arc offsets (xᵢ = TEC_G − TEC_P)",
)
render_book_equation(
    st, EQ_4_15, "4.15",
    "Levelled slant TEC — phase precision with code absolute level",
)
_vars(VARS_STEP_6)


# ══════════════════════════════════════════════════════════════════════════════
# STEP 7 — Satellite & Receiver Differential Code Biases (DCBs)
# ══════════════════════════════════════════════════════════════════════════════
_step("7", "Differential Code Bias (DCB) Estimation and Correction", "#ef4444")

_explain(
    "Even after levelling, TEC_R contains <strong>hardware biases</strong> — "
    "small frequency-dependent delays in the satellite transmitter and the receiver's "
    "front-end electronics. These are called <strong>Differential Code Biases (DCBs)</strong>. "
    "A 1 ns DCB error causes ~2.85 TECU of TEC error at GPS frequencies. "
    "Satellite DCBs (DCB_Si) are published by IGS analysis centres (e.g. University of Bern CODE). "
    "Receiver DCBs (DCB_R) are estimated by Seemala's <em>standard deviation minimisation</em> method: "
    "the correct DCB is the one that minimises the spread of VTEC values from all satellites "
    "in view — because a correctly biased ionosphere should appear spatially smooth. "
    "A 4-stage variable step-size search (±500 → ±50 → ±10 → ±1 TECU) finds the optimum in ~70 iterations.",
    "Ignoring DCBs can produce non-physical negative TEC values or errors of up to 20 TECU. "
    "In the ZGIIS network, satellite DCBs are downloaded from CODE Bern "
    "(http://ftp.aiub.unibe.ch/CODE/) and receiver DCBs are estimated per-station per-day.",
    "7",
    border="#ef4444",
)

render_book_equation(
    st, EQ_4_21, "4.21",
    "Spread of VTEC values from all M_t satellites at epoch t (trial receiver DCB = DCB(k))",
)
render_book_equation(
    st, EQ_4_22, "4.22",
    "Sum of spreads over all N epochs — minimised to find optimal receiver DCB",
)
_vars(VARS_STEP_7)


# ══════════════════════════════════════════════════════════════════════════════
# STEP 8 — Thin Shell Model & Mapping Function
# ══════════════════════════════════════════════════════════════════════════════
_step("8", "Single-Layer Model (SLM) and the Mapping Function S(E)", "#f59e0b")

_explain(
    "TEC_R is a <em>slant</em> measurement — it depends on satellite elevation angle "
    "because lower satellites send signals through more ionosphere. "
    "To remove this angular dependence, the <strong>Thin Shell Model (TSM)</strong> assumes "
    "all electrons are concentrated in an infinitely thin spherical shell at a fixed "
    "<strong>Ionospheric Pierce Point height H_IPP</strong> (typically 350–400 km, "
    "near the F2-layer peak electron density). "
    "The <strong>mapping function S(E)</strong> converts the oblique path length to an "
    "equivalent vertical path. At 90° elevation (satellite overhead), S = 1 and STEC = VTEC exactly.",
    "The mapping function is the single most important geometric correction in VTEC derivation. "
    "For a satellite at 20° elevation, S ≈ 2.8 — meaning the signal passes through "
    "~2.8× more ionosphere than a zenith signal. "
    "Using H_IPP = 350 km is appropriate for elevation angles > 50°; "
    "for lower elevations (especially near the Equatorial Ionisation Anomaly over Zimbabwe), "
    "errors increase and local F2-peak heights should be considered.",
    "8",
    border="#f59e0b",
)

render_book_equation(
    st, EQ_4_17, "4.17",
    "Thin-shell obliquity factor — converts slant path length to vertical",
)
_vars(VARS_STEP_8)


# ══════════════════════════════════════════════════════════════════════════════
# STEP 9 — VTEC: The Final Result
# ══════════════════════════════════════════════════════════════════════════════
_step("9", "Vertical TEC (VTEC) — The Final Ionospheric Product", "#168bd2")

_explain(
    "All previous steps converge here. Subtracting the satellite and receiver DCBs from TEC_R "
    "removes hardware biases, and dividing by S(E) removes the elevation-angle dependence. "
    "The result is <strong>VTEC</strong> — the vertical column electron content at the "
    "<strong>Ionospheric Pierce Point (IPP)</strong>, the point where the line of sight "
    "to the satellite pierces the thin shell. "
    "VTEC is the standard, angle-independent measure of ionospheric electron content "
    "used in space weather monitoring, RTK/PPP modelling, and scintillation research.",
    "VTEC is what ZGIIS computes, archives, and displays. It can be compared across stations "
    "and satellites, used to detect geomagnetic storm effects and equatorial plasma bubbles, "
    "and fed into RTK/PPP corrections to improve positioning accuracy across the Zimbabwe CORS network.",
    "9",
    border="#168bd2",
)

render_book_equation(
    st, EQ_4_16, "4.16",
    "Vertical TEC at the IPP — the central ionospheric product of ZGIIS",
)
_vars(VARS_STEP_9)


# ══════════════════════════════════════════════════════════════════════════════
# STEP 10 — IPP Coordinates
# ══════════════════════════════════════════════════════════════════════════════
_step("10", "Locating the Ionospheric Pierce Point (IPP) on the Globe", "#00ff88")

_explain(
    "Each VTEC value is geo-located at the <strong>IPP</strong> — the geographic position "
    "where the signal crosses the thin ionospheric shell. "
    "Given the receiver's geodetic latitude φᵤ and longitude λᵤ, and the observed "
    "satellite elevation E and azimuth A, the IPP latitude and longitude are computed "
    "using the single-layer model geometry. "
    "Ψ_pp is the Earth-centre angle between the receiver and the IPP's ground projection.",
    "IPP coordinates allow ZGIIS to plot TEC spatial maps, study the Equatorial Ionisation "
    "Anomaly (EIA) crest movement over Southern Africa, and detect travelling ionospheric "
    "disturbances (TIDs) by tracking how VTEC changes across the IPP network.",
    "10",
    border="#00ff88",
)

st.markdown(
    "<div style='font-size:0.72rem;color:#00ff88;font-weight:800;letter-spacing:0.08em;"
    "text-transform:uppercase;margin:1rem 0 0.5rem'>Detailed IPP geometry reference</div>",
    unsafe_allow_html=True,
)
ipp_diag_col, ipp_legend_col = st.columns([3, 2], gap="medium")
with ipp_diag_col:
    render_ipp_diagram_streamlit(st)
with ipp_legend_col:
    st.markdown(IPP_LEGEND_HTML, unsafe_allow_html=True)

render_book_equation(
    st, EQ_4_18, "4.18",
    "Earth-centre angle between receiver and IPP ground projection",
)
render_book_equation(
    st, EQ_4_19, "4.19",
    "Geographic latitude of the ionospheric pierce point",
)
render_book_equation(
    st, EQ_4_20, "4.20",
    "Geographic longitude of the ionospheric pierce point",
)
_vars(VARS_STEP_10)


# ══════════════════════════════════════════════════════════════════════════════
# Summary flowchart
# ══════════════════════════════════════════════════════════════════════════════
st.markdown("---")
st.markdown(
    "<div style='font-size:0.72rem;color:#168bd2;font-weight:800;letter-spacing:0.12em;"
    "text-transform:uppercase;margin-bottom:0.8rem'>Complete Computation Pipeline</div>",
    unsafe_allow_html=True,
)

st.markdown(
    """
    <div style='background:#000000;border:1px solid #244d73;border-radius:12px;
                padding:1.5rem;font-family:monospace;font-size:0.82rem;color:#ffffff;
                line-height:2.1'>
      <span style='color:#ffffff;font-weight:700'>RINEX obs file</span>
      &nbsp;+&nbsp;
      <span style='color:#ffffff;font-weight:700'>Navigation file</span>
      &nbsp;+&nbsp;
      <span style='color:#ffffff;font-weight:700'>Satellite DCB file (CODE)</span>
      <br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│
      <br>
      <span style='color:#ffffff;font-weight:700'>① Read C₁,C₂,L₁,L₂</span>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      <em style='color:#ffffff'>← Eqs 4.10–4.12 (Steps 4, 4b)</em>
      <br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│
      <br>
      <span style='color:#ffffff;font-weight:700'>② Compute TEC_G and TEC_P</span>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      <em style='color:#ffffff'>← code + phase TEC</em>
      <br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│
      <br>
      <span style='color:#ffffff;font-weight:700'>③ Detect &amp; correct cycle slips in TEC_P</span>
      &nbsp;&nbsp;
      <em style='color:#ffffff'>← Eq. 4.13 (Step 5)</em>
      <br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│
      <br>
      <span style='color:#ffffff;font-weight:700'>④ Level TEC_P to TEC_G → TEC_R</span>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      <em style='color:#ffffff'>← Eqs. 4.14–4.15 (Step 6)</em>
      <br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│
      <br>
      <span style='color:#ffffff;font-weight:700'>⑤ Estimate receiver DCB_R</span>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      <em style='color:#ffffff'>← Eqs. 4.21–4.22 (Step 7)</em>
      <br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│
      <br>
      <span style='color:#ffffff;font-weight:700'>⑥ Compute mapping function S(E)</span>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      <em style='color:#ffffff'>← Eq. 4.17 (Step 8)</em>
      <br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│
      <br>
      <span style='color:#ffffff;font-weight:700'>⑦ VTEC = (TEC_R − DCB_R − DCB_Si) / S(E)</span>
      &nbsp;
      <em style='color:#ffffff'>← Eq. 4.16 (Step 9)</em>
      <br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│
      <br>
      <span style='color:#ffffff;font-weight:700'>⑧ Locate IPP (φ_pp, λ_pp)</span>
      &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;
      <em style='color:#ffffff'>← Eqs. 4.18–4.20 (Step 10)</em>
      <br>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;│
      <br>
      <span style='color:#ffffff;font-weight:700'>Output: VTEC(TECU) at (φ_pp, λ_pp, time) → ZGIIS Maps &amp; Archive</span>
    </div>
    """,
    unsafe_allow_html=True,
)

st.markdown("<div style='margin-bottom:1.2rem'></div>", unsafe_allow_html=True)
st.caption(
    "Source: Gopi Krishna Seemala, 'Estimation of Ionospheric Total Electron Content (TEC) "
    "from GNSS Observations,' Chapter 4 in Abhay Kumar Singh & Shani Tiwari (eds.), "
    "Atmospheric Remote Sensing: Principles and Applications, Elsevier, 2022. "
    "Equations numbered as in the original text (4.1 – 4.22). "
    "Implemented in GPS_TEC v3.5 and reproduced here for the ZGIIS Zimbabwe platform."
)
