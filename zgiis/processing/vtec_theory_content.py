"""VTEC Theory page content — framework-agnostic (FastAPI + Next.js)."""
from __future__ import annotations

from zgiis.processing.ipp_diagram import IPP_LEGEND_HTML, get_ipp_svg
from zgiis.processing.pipeline_explanations import PROCESSING_STAGE_OVERVIEW
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
    VARS_STEP_10,
    VARS_STEP_2,
    VARS_STEP_3,
    VARS_STEP_4,
    VARS_STEP_4B,
    VARS_STEP_5,
    VARS_STEP_6,
    VARS_STEP_7,
    VARS_STEP_8,
    VARS_STEP_9,
    equation_record,
    variables_records,
)
from zgiis.processing.vtec_illustrations import get_illustration, get_journey_pills

BOOK_CITATION = (
    "Gopi Krishna Seemala, Estimation of Ionospheric Total Electron Content (TEC) "
    "from GNSS Observations, Chapter 4 in Abhay Kumar Singh & Shani Tiwari (eds.), "
    "Atmospheric Remote Sensing: Principles and Applications, Elsevier, 2022."
)

COMPUTATION_PIPELINE = {
    "inputs": [
        "RINEX obs file",
        "Navigation file",
        "Satellite DCB file (CODE)",
    ],
    "stages": [
        {
            "label": "Read C₁,C₂,L₁,L₂",
            "ref": "Eqs 4.10–4.12 (Steps 4, 4b)",
        },
        {
            "label": "Compute TEC_G and TEC_P",
            "ref": "code + phase TEC",
        },
        {
            "label": "Detect & correct cycle slips in TEC_P",
            "ref": "Eq. 4.13 (Step 5)",
        },
        {
            "label": "Level TEC_P to TEC_G → TEC_R",
            "ref": "Eqs. 4.14–4.15 (Step 6)",
        },
        {
            "label": "Estimate receiver DCB_R",
            "ref": "Eqs. 4.21–4.22 (Step 7)",
        },
        {
            "label": "Compute mapping function S(E)",
            "ref": "Eq. 4.17 (Step 8)",
        },
        {
            "label": "VTEC = (TEC_R − DCB_R − DCB_Si) / S(E)",
            "ref": "Eq. 4.16 (Step 9)",
        },
        {
            "label": "Locate IPP (φ_pp, λ_pp)",
            "ref": "Eqs. 4.18–4.20 (Step 10)",
        },
    ],
    "output": "VTEC(TECU) at (φ_pp, λ_pp, time) → ZGIIS Maps & Archive",
}

_STEP_SPECS: list[dict] = [
    {
        "id": "1",
        "title": "Ionospheric Delay on a Trans-Ionospheric Signal",
        "accent": "#168bd2",
        "body": (
            "GNSS signals are radio waves. As they pass through the ionosphere — a layer of "
            "free electrons between roughly 50 km and 1000 km altitude — the electrons slow "
            "down (and slightly bend) the signal. The extra distance the signal appears to travel "
            "compared to the true geometric range is called the ionospheric delay δρ. "
            "It is measured by integrating the refractive index along the ray path from satellite to receiver."
        ),
        "why": (
            "Without correcting for ionospheric delay, a GNSS position error of up to tens of metres "
            "can occur. At GPS L1, a TEC of 100 TECU causes ~16 m of range error. "
            "Quantifying δρ is the foundation of all TEC estimation."
        ),
        "equations": [equation_record(EQ_4_1, "4.1", "Ionospheric range delay along the line of sight")],
        "variables": variables_records(VARS_STEP_1),
    },
    {
        "id": "2",
        "title": "Ionospheric Refractive Index — Deriving the 40.3 Constant",
        "accent": "#00ff88",
        "body": (
            "The refractive index η of the ionosphere depends on signal frequency and electron density. "
            "Starting from the full Appleton-Hartree formula (Eq. 4.2), and noting that "
            "GNSS carrier frequencies are much higher than the plasma frequency, the expression simplifies "
            "to a first-order approximation. After substituting physical constants "
            "(electron mass m = 9.109×10⁻³¹ kg, charge e = 1.602×10⁻¹⁹ C, "
            "permittivity ε = 8.854×10⁻¹² F m⁻¹), two clean results emerge — one for phase and one for group velocity."
        ),
        "why": (
            "The sign difference between phase and group refractive indices is critical: "
            "carrier phase observations experience a phase advance (shorter apparent range), "
            "while pseudorange/code experiences a group delay (longer apparent range). "
            "Both are needed to eliminate phase ambiguity during levelling (Step 6)."
        ),
        "equations": [
            equation_record(EQ_4_2, "4.2", "Appleton–Hartree refractive index (simplified when ω ≫ ω_p)"),
            equation_record(EQ_4_3, "4.3", "Phase refractive index — first-order approximation"),
            equation_record(EQ_4_4, "4.4", "Group refractive index — first-order approximation"),
        ],
        "variables": variables_records(VARS_STEP_2),
    },
    {
        "id": "3",
        "title": "Slant TEC Definition and Delay in Metres",
        "accent": "#a78bfa",
        "body": (
            "Integrating the refractive index from satellite to receiver converts the density profile "
            "into a single number: Total Electron Content (TEC) — the total number of "
            "free electrons in a column of 1 m² cross-section along the signal path. "
            "TEC is expressed in TECU where 1 TECU = 10¹⁶ electrons m⁻². "
            "The ionospheric delay in metres is then simply proportional to TEC and inversely proportional "
            "to the square of the carrier frequency, making GNSS a dispersive medium — "
            "the key property that allows dual-frequency receivers to measure TEC."
        ),
        "why": (
            "By measuring the difference in delay on two frequencies from the same satellite, "
            "all non-dispersive errors (troposphere, clock, geometry) cancel, leaving only the "
            "ionospheric contribution. This is why two frequencies are essential."
        ),
        "equations": [
            equation_record(EQ_4_5, "4.5", "Ionospheric range delay in metres — link between delay and STEC"),
        ],
        "variables": variables_records(VARS_STEP_3),
    },
    {
        "id": "4",
        "title": "STEC from Dual-Frequency Pseudorange (Code) Observations",
        "accent": "#f472b6",
        "body": (
            "A dual-frequency receiver measures pseudoranges C₁ and C₂ on L1 and L2. "
            "Because all non-dispersive effects (satellite–receiver geometry, troposphere, clocks) "
            "are identical on both frequencies, subtracting C₂ − C₁ cancels them all, "
            "leaving only the differential ionospheric delay. "
            "Rearranging for both frequencies and taking the difference gives "
            "TEC_G — the absolute but noisy code-derived TEC."
        ),
        "why": (
            "Code TEC (TEC_G) gives an absolute TEC value but with pseudorange noise of ~0.3 m "
            "(≈ 2 TECU on L1). It is used as the absolute reference during levelling in Step 6."
        ),
        "equations": [
            equation_record(EQ_4_8, "4.8", "Differential code delay — non-dispersive terms cancel"),
            equation_record(EQ_4_10, "4.10", "Absolute (noisy) TEC from dual-frequency pseudoranges"),
        ],
        "variables": variables_records(VARS_STEP_4),
    },
    {
        "id": "4b",
        "title": "STEC from Dual-Frequency Carrier Phase Observations",
        "accent": "#f59e0b",
        "body": (
            "Carrier phase measurements L₁ and L₂ are about 100× more precise than pseudoranges, "
            "with noise at the millimetre level (~0.003 TECU). However, they contain an unknown "
            "integer ambiguity — the receiver does not know how many full carrier cycles elapsed "
            "before it started tracking. The phase-derived TEC (TEC_P) is therefore "
            "relative — it tracks changes precisely but cannot give an absolute level without "
            "additional processing. L₁ and L₂ here are carrier phase measurements expressed in metres "
            "(i.e. L = λ × φ where φ is phase in cycles)."
        ),
        "why": (
            "TEC_P captures fine ionospheric structure — wave-like travelling ionospheric disturbances "
            "(TIDs), scintillation onset — that TEC_G misses in the noise. "
            "Combining both (Step 6) gives the best of both worlds."
        ),
        "equations": [
            equation_record(EQ_4_12, "4.12", "Precise but ambiguous TEC from dual-frequency carrier phase"),
        ],
        "variables": variables_records(VARS_STEP_4B),
    },
    {
        "id": "5",
        "title": "Cycle Slip Detection and Correction",
        "accent": "#168bd2",
        "body": (
            "Before levelling, the phase TEC arc must be free of cycle slips — "
            "sudden discontinuities caused when the receiver's phase-lock loop (PLL) loses lock, "
            "typically during ionospheric scintillation or signal obstruction. "
            "A cycle slip appears as an abrupt jump in TEC_P. "
            "Seemala's GPS_TEC method uses a simple adaptive arithmetic algorithm: "
            "if the difference between consecutive TEC_P values exceeds the standard deviation "
            "of the previous 10 samples, a slip is flagged and corrected by an offset equal to "
            "the running mean of the previous 5 differences. "
            "No fixed threshold is needed — the algorithm adapts to any sampling rate."
        ),
        "why": (
            "An uncorrected cycle slip introduces an artificial step of one or more TECU into the "
            "phase TEC arc, which would corrupt the levelling offset calculated in Step 6. "
            "Slip correction is mandatory before any subsequent processing."
        ),
        "equations": [
            equation_record(
                EQ_4_13,
                "4.13",
                "Adaptive cycle-slip detector — σ₁₀ is the std dev of the previous 10 TEC_P samples",
            ),
        ],
        "variables": variables_records(VARS_STEP_5),
    },
    {
        "id": "6",
        "title": "TEC Levelling — Combining Code and Phase to get Slant TEC",
        "accent": "#00ff88",
        "body": (
            "TEC_P has ~0.003 TECU precision but an unknown offset (ambiguity). "
            "TEC_G has no ambiguity but ~2 TECU noise. "
            "Levelling resolves this by computing the mean difference "
            "(TEC_G − TEC_P) over a single continuous satellite arc at elevation > 20°. "
            "That mean difference is the arc's ambiguity estimate. "
            "Adding it to the phase TEC produces TEC_R — slant TEC that is "
            "both precise (phase noise level) and absolute (code level), "
            "with outliers in the difference removed using a 2σ MAD filter (Eq. 4.14)."
        ),
        "why": (
            "TEC_R is the input to all downstream VTEC, DCB, and IPP calculations. "
            "Levelling errors of even 1–2 TECU propagate directly into VTEC values, "
            "so outlier rejection during offset estimation is critical. "
            "Low-elevation data (< 20°) are excluded to reduce multipath contamination."
        ),
        "equations": [
            equation_record(EQ_4_14, "4.14", "Outlier rejection using 2σ criterion on arc offsets (xᵢ = TEC_G − TEC_P)"),
            equation_record(EQ_4_15, "4.15", "Levelled slant TEC — phase precision with code absolute level"),
        ],
        "variables": variables_records(VARS_STEP_6),
    },
    {
        "id": "7",
        "title": "Differential Code Bias (DCB) Estimation and Correction",
        "accent": "#ef4444",
        "body": (
            "Even after levelling, TEC_R contains hardware biases — "
            "small frequency-dependent delays in the satellite transmitter and the receiver's "
            "front-end electronics. These are called Differential Code Biases (DCBs). "
            "A 1 ns DCB error causes ~2.85 TECU of TEC error at GPS frequencies. "
            "Satellite DCBs (DCB_Si) are published by IGS analysis centres (e.g. University of Bern CODE). "
            "Receiver DCBs (DCB_R) are estimated by Seemala's standard deviation minimisation method: "
            "the correct DCB is the one that minimises the spread of VTEC values from all satellites "
            "in view — because a correctly biased ionosphere should appear spatially smooth. "
            "A 4-stage variable step-size search (±500 → ±50 → ±10 → ±1 TECU) finds the optimum in ~70 iterations."
        ),
        "why": (
            "Ignoring DCBs can produce non-physical negative TEC values or errors of up to 20 TECU. "
            "In the ZGIIS network, satellite DCBs are downloaded from CODE Bern "
            "and receiver DCBs are estimated per-station per-day."
        ),
        "equations": [
            equation_record(EQ_4_21, "4.21", "Spread of VTEC values from all M_t satellites at epoch t (trial receiver DCB = DCB(k))"),
            equation_record(EQ_4_22, "4.22", "Sum of spreads over all N epochs — minimised to find optimal receiver DCB"),
        ],
        "variables": variables_records(VARS_STEP_7),
    },
    {
        "id": "8",
        "title": "Single-Layer Model (SLM) and the Mapping Function S(E)",
        "accent": "#f59e0b",
        "body": (
            "TEC_R is a slant measurement — it depends on satellite elevation angle "
            "because lower satellites send signals through more ionosphere. "
            "To remove this angular dependence, the Thin Shell Model (TSM) assumes "
            "all electrons are concentrated in an infinitely thin spherical shell at a fixed "
            "Ionospheric Pierce Point height H_IPP (typically 350–400 km, "
            "near the F2-layer peak electron density). "
            "The mapping function S(E) converts the oblique path length to an "
            "equivalent vertical path. At 90° elevation (satellite overhead), S = 1 and STEC = VTEC exactly."
        ),
        "why": (
            "The mapping function is the single most important geometric correction in VTEC derivation. "
            "For a satellite at 20° elevation, S ≈ 2.8 — meaning the signal passes through "
            "~2.8× more ionosphere than a zenith signal. "
            "Using H_IPP = 350 km is appropriate for elevation angles > 50°; "
            "for lower elevations (especially near the Equatorial Ionisation Anomaly over Zimbabwe), "
            "errors increase and local F2-peak heights should be considered."
        ),
        "equations": [
            equation_record(EQ_4_17, "4.17", "Thin-shell obliquity factor — converts slant path length to vertical"),
        ],
        "variables": variables_records(VARS_STEP_8),
    },
    {
        "id": "9",
        "title": "Vertical TEC (VTEC) — The Final Ionospheric Product",
        "accent": "#168bd2",
        "body": (
            "All previous steps converge here. Subtracting the satellite and receiver DCBs from TEC_R "
            "removes hardware biases, and dividing by S(E) removes the elevation-angle dependence. "
            "The result is VTEC — the vertical column electron content at the "
            "Ionospheric Pierce Point (IPP), the point where the line of sight "
            "to the satellite pierces the thin shell. "
            "VTEC is the standard, angle-independent measure of ionospheric electron content "
            "used in space weather monitoring, RTK/PPP modelling, and scintillation research."
        ),
        "why": (
            "VTEC is what ZGIIS computes, archives, and displays. It can be compared across stations "
            "and satellites, used to detect geomagnetic storm effects and equatorial plasma bubbles, "
            "and fed into RTK/PPP corrections to improve positioning accuracy across the Zimbabwe CORS network."
        ),
        "equations": [
            equation_record(EQ_4_16, "4.16", "Vertical TEC at the IPP — the central ionospheric product of ZGIIS"),
        ],
        "variables": variables_records(VARS_STEP_9),
    },
    {
        "id": "10",
        "title": "Locating the Ionospheric Pierce Point (IPP) on the Globe",
        "accent": "#00ff88",
        "body": (
            "Each VTEC value is geo-located at the IPP — the geographic position "
            "where the signal crosses the thin ionospheric shell. "
            "Given the receiver's geodetic latitude φᵤ and longitude λᵤ, and the observed "
            "satellite elevation E and azimuth A, the IPP latitude and longitude are computed "
            "using the single-layer model geometry. "
            "Ψ_pp is the Earth-centre angle between the receiver and the IPP's ground projection."
        ),
        "why": (
            "IPP coordinates allow ZGIIS to plot TEC spatial maps, study the Equatorial Ionisation "
            "Anomaly (EIA) crest movement over Southern Africa, and detect travelling ionospheric "
            "disturbances (TIDs) by tracking how VTEC changes across the IPP network."
        ),
        "equations": [
            equation_record(EQ_4_18, "4.18", "Earth-centre angle between receiver and IPP ground projection"),
            equation_record(EQ_4_19, "4.19", "Geographic latitude of the ionospheric pierce point"),
            equation_record(EQ_4_20, "4.20", "Geographic longitude of the ionospheric pierce point"),
        ],
        "variables": variables_records(VARS_STEP_10),
        "ipp_detail": True,
    },
]


def build_vtec_theory_payload() -> dict:
    """Full VTEC Theory page payload for GET /theory/vtec."""
    steps = []
    for spec in _STEP_SPECS:
        ill = get_illustration(spec["id"])
        step = {
            "id": spec["id"],
            "title": spec["title"],
            "accent": spec["accent"],
            "body": spec["body"],
            "why": spec["why"],
            "equations": spec["equations"],
            "variables": spec["variables"],
            "illustration": ill,
            "ipp_detail": bool(spec.get("ipp_detail")),
        }
        steps.append(step)

    pipeline_stages = [
        {"label": stage, "icon": icon}
        for stage, icon in PROCESSING_STAGE_OVERVIEW
    ]

    return {
        "citation": BOOK_CITATION,
        "journey": get_journey_pills(),
        "pipeline_stages": pipeline_stages,
        "computation_pipeline": COMPUTATION_PIPELINE,
        "steps": steps,
        "ipp": {
            "svg": get_ipp_svg(),
            "legend_html": IPP_LEGEND_HTML,
        },
    }
