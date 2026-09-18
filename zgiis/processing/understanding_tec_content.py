"""Understanding TEC — plain-language ionospheric guide for ZGIIS."""
from __future__ import annotations

from zgiis.processing.understanding_tec_illustrations import get_illustration, get_journey_pills
from zgiis.processing.vtec_equations import equation_record

CITATION = (
    "Concepts follow standard GNSS ionospheric textbooks and ZGIIS operational practice "
    "(dual-frequency GPS, geometry-free TEC, DCB calibration, IPP mapping). "
    "For the full mathematical derivation see Calculating VTEC on this site."
)

OVERVIEW = [
    {"label": "Ionosphere & electrons", "icon": "🌐"},
    {"label": "L1 · L2 dual-freq", "icon": "📡"},
    {"label": "STEC → VTEC", "icon": "📐"},
    {"label": "ZGIIS maps", "icon": "🇿🇼"},
]

PIPELINE = {
    "inputs": [
        "GPS L1 & L2 observations",
        "Navigation ephemeris",
        "CODE satellite DCBs",
    ],
    "stages": [
        {"label": "Geometry-free L1−L2 combination", "ref": "isolates ionospheric delay"},
        {"label": "Remove satellite & receiver biases", "ref": "TEC calibration"},
        {"label": "Detect & fix cycle slips", "ref": "storm / scintillation jumps"},
        {"label": "Map slant TEC → vertical TEC", "ref": "mapping function S(E)"},
    ],
    "output": "VTEC(TECU) over Zimbabwe → dashboard heatmap & archive",
}

_STEP_SPECS: list[dict] = [
    {
        "id": "1",
        "title": "Standing at Harare CORS — The Signal Path",
        "accent": "#168bd2",
        "body": (
            "Imagine you are standing at a Zimbabwe CORS station in Harare. A GPS satellite sits about "
            "20,200 km above you. The radio signal cannot reach your receiver directly — it must travel "
            "through the ionosphere, a layer of free electrons between roughly 50 km and 1,000 km altitude. "
            "Those electrons bend and slow the signal. That delay is exactly what Total Electron Content (TEC) "
            "quantifies — and it is what ZGIIS measures every day from the CORS network."
        ),
        "why": (
            "Every map pin, RTK survey, and aviation GNSS fix in Zimbabwe depends on signals crossing this "
            "same ionospheric shell. When the shell is disturbed, positioning errors grow."
        ),
        "equations": [],
        "variables": [
            {"symbol": "CORS", "meaning": "Continuously Operating Reference Station — Harare (HARA/ZINH) and sites nationwide"},
            {"symbol": "Ionosphere", "meaning": "Plasma layer where free electrons affect GNSS radio waves"},
            {"symbol": "~20,200 km", "meaning": "Typical GPS orbital altitude above Earth"},
        ],
    },
    {
        "id": "2",
        "title": "What Is TEC?",
        "accent": "#00ff88",
        "body": (
            "TEC means Total Electron Content — simply: how many electrons sit between the satellite and your "
            "receiver along the signal path. Imagine every electron is a grain of sand stacked between the "
            "satellite and the antenna. TEC is the count of all those electrons in a column of 1 m² "
            "cross-section along the path. The more electrons, the larger the TEC. We express TEC in TECU "
            "where 1 TECU = 10¹⁶ electrons per square metre."
        ),
        "why": (
            "TEC is a single number that tells you how much ionospheric “traffic” a GNSS signal had to pass "
            "through — without counting electrons one by one in the lab."
        ),
        "equations": [
            equation_record(
                r"1\,\mathrm{TECU} = 10^{16}\,\mathrm{electrons\,m^{-2}}",
                "TECU",
                "Standard unit for total electron content",
            ),
        ],
        "variables": [
            {"symbol": "TEC", "meaning": "Total Electron Content along the line of sight"},
            {"symbol": "TECU", "meaning": "TEC unit — 10¹⁶ electrons m⁻²"},
        ],
    },
    {
        "id": "3",
        "title": "Why Do We Care?",
        "accent": "#ff4444",
        "body": (
            "Electrons slow GNSS signals. More electrons → more delay → larger positioning error. During "
            "geomagnetic storms the ionosphere over Southern Africa can become turbulent: RTK becomes unstable, "
            "phones lose accuracy, aircraft GNSS approaches degrade, and scintillation can break carrier-phase "
            "lock. So TEC is not an abstract number — it measures how disturbed the ionosphere is right now."
        ),
        "why": (
            "ZINGSA monitors TEC alongside Kp and Dst so farmers, surveyors, pilots, and citizens know when "
            "navigation will struggle even if the CORS caster still looks online."
        ),
        "equations": [],
        "variables": [
            {"symbol": "Delay", "meaning": "Extra travel time imposed by electrons — metres at GPS frequencies"},
            {"symbol": "Storm", "meaning": "Kp ≥ 5 or Dst ≤ −50 nT — ionosphere often shows elevated TEC and S4"},
        ],
    },
    {
        "id": "4",
        "title": "Why Two Frequencies? (L1 & L2)",
        "accent": "#f59e0b",
        "body": (
            "GNSS satellites transmit on at least two frequencies — GPS L1 at 1575.42 MHz and L2 at 1227.60 MHz. "
            "Electrons affect lower frequencies more than higher ones. Think of two cars through traffic: the slower "
            "car (L2) suffers more delay. Comparing L1 and L2 reveals how much electron “traffic” exists — that "
            "difference is the key to computing TEC without guessing the troposphere or clock errors."
        ),
        "why": (
            "Dual-frequency receivers at every ZGIIS CORS site are what make real TEC measurement possible from "
            "live data — never from a single frequency alone."
        ),
        "equations": [],
        "variables": [
            {"symbol": "L1", "meaning": "1575.42 MHz — less ionospheric delay"},
            {"symbol": "L2", "meaning": "1227.60 MHz — more ionospheric delay"},
        ],
    },
    {
        "id": "5",
        "title": "The Appleton Equation — How Radio Meets Plasma",
        "accent": "#a78bfa",
        "body": (
            "The Appleton–Hartree equation describes how radio waves behave in a plasma — air filled with free "
            "electrons. The full form is complicated, but for GNSS it simplifies to η ≈ 1 − 40.3·Nₑ/f², where "
            "Nₑ is electron density and f is signal frequency. This single relationship is the foundation of "
            "GNSS ionospheric research: higher electron density means more bending and delay; higher frequency "
            "means less effect."
        ),
        "why": (
            "This is why the same storm can disturb L2 more than L1, and why the L1−L2 difference isolates "
            "ionospheric delay in processing software."
        ),
        "equations": [
            equation_record(
                r"\eta \approx 1 - \frac{40.3\,N_e}{f^2}",
                "Ap",
                "First-order refractive index in the ionosphere (Nₑ in m⁻³, f in Hz)",
            ),
        ],
        "variables": [
            {"symbol": "η", "meaning": "Refractive index — how much the medium slows the wave"},
            {"symbol": "Nₑ", "meaning": "Electron density (electrons per cubic metre)"},
            {"symbol": "f", "meaning": "Carrier frequency (Hz)"},
        ],
    },
    {
        "id": "6",
        "title": "Electron Density vs TEC",
        "accent": "#168bd2",
        "body": (
            "Electron density Nₑ is the number of electrons inside one cubic metre — like counting grains in "
            "one small box. TEC is different: it integrates electron density along the entire slant path from "
            "satellite to receiver. That integrated value is Slant TEC (STEC). You cannot convert a single "
            "density reading into TEC without knowing the full path length and profile through the ionosphere."
        ),
        "why": (
            "Confusing density with TEC is a common mistake. ZGIIS products report STEC/VTEC — integrated "
            "quantities along each satellite ray."
        ),
        "equations": [
            equation_record(
                r"\mathrm{STEC} = \int N_e(s)\,ds \quad \text{along satellite}\rightarrow\mathrm{receiver}",
                "STEC",
                "Integral of electron density along the signal path",
            ),
        ],
        "variables": [
            {"symbol": "Nₑ", "meaning": "Electron density — local, per m³"},
            {"symbol": "STEC", "meaning": "Slant TEC — integrated along the oblique ray"},
        ],
    },
    {
        "id": "7",
        "title": "From Slant TEC to Vertical TEC (VTEC)",
        "accent": "#00ff88",
        "body": (
            "When the satellite is low on the horizon, the signal travels a long slant path through the "
            "ionosphere — STEC is large. Scientists usually want Vertical TEC (VTEC): the electron content "
            "through a vertical column, which is easier to compare between sites and times. A mapping function "
            "S(E) converts STEC to VTEC using the satellite elevation angle E. VTEC = STEC / S(E)."
        ),
        "why": (
            "The TEC heatmap and dashboard timelines on ZGIIS show VTEC at the ionospheric pierce point — "
            "the mapped vertical equivalent of each slant measurement."
        ),
        "equations": [
            equation_record(
                r"\mathrm{VTEC} = \frac{\mathrm{STEC}}{S(E)}",
                "VTEC",
                "Vertical TEC from slant TEC and elevation mapping function",
            ),
        ],
        "variables": [
            {"symbol": "S(E)", "meaning": "Mapping function — depends on satellite elevation E"},
            {"symbol": "VTEC", "meaning": "Vertical TEC — standard product for maps and storm studies"},
        ],
    },
    {
        "id": "8",
        "title": "Code vs Carrier Phase — and Geometry-Free TEC",
        "accent": "#f472b6",
        "body": (
            "GNSS measures distance two ways. Code (pseudorange) is like shouting START…STOP and timing the "
            "pulse — accurate to roughly 30 cm–1 m. Carrier phase counts radio wave cycles like a fine ruler "
            "— accurate to about 2 mm, but with an unknown integer ambiguity (which wave did you start on?). "
            "Almost all TEC studies use carrier phase because its noise is tiny (±2 mm vs ±50 cm for code). "
            "The trick: subtract L1 minus L2. Distance, clocks, troposphere, and most errors cancel. What "
            "remains is TEC plus biases and noise — the geometry-free linear combination used in ZGIIS software."
        ),
        "why": (
            "Without the geometry-free combination you cannot separate ionospheric delay from satellite clock "
            "and tropospheric errors in a single equation."
        ),
        "equations": [
            equation_record(
                r"L_1 - L_2 \;\Rightarrow\; \mathrm{TEC} + \mathrm{biases} + \mathrm{noise}",
                "GF",
                "Geometry-free combination — standard in TEC software",
            ),
        ],
        "variables": [
            {"symbol": "Code", "meaning": "Pseudorange — robust but noisier (~decimetre to metre)"},
            {"symbol": "Carrier", "meaning": "Phase observation — millimetre precision with ambiguity"},
        ],
    },
    {
        "id": "9",
        "title": "Biases, Calibration & Cycle Slips",
        "accent": "#ff8c00",
        "body": (
            "Even after L1−L2 subtraction, receiver hardware and satellite electronics add biases of several "
            "TECU — e.g. true TEC 20 TECU but measured 26 TECU without calibration. Satellite DCB files (CODE) "
            "and receiver DCB estimation remove these offsets. Phase ambiguity is an unknown integer number of "
            "waves at lock start; if the receiver loses lock (tree, cloud, scintillation, power cut) counting "
            "restarts — a cycle slip. Smooth TEC suddenly jumps. Severe ionospheric disturbance or solar flares "
            "can cause the same. ZGIIS processing must detect and repair slips before trusting the arc."
        ),
        "why": (
            "Raw TEC is never published as-is on the dashboard — calibration and slip editing turn measurements "
            "into scientifically usable VTEC."
        ),
        "equations": [],
        "variables": [
            {"symbol": "DCB", "meaning": "Differential Code Bias — satellite and receiver hardware offsets"},
            {"symbol": "Cycle slip", "meaning": "Sudden integer jump in carrier phase — must be detected and fixed"},
        ],
    },
    {
        "id": "10",
        "title": "Many Satellites → Zimbabwe Ionosphere Map",
        "accent": "#168bd2",
        "body": (
            "At any moment GPS 1, 2, 3, 4… each give one slant TEC from Harare, Mutare, Bulawayo, and every "
            "CORS site. After mapping and calibration, those rays become a picture of VTEC over Zimbabwe — "
            "exactly what the ZGIIS dashboard heatmap, time series, and storm alerts display. When TEC rises "
            "during a geomagnetic storm, you are seeing the same electrons that disturb RTK, phones, and aviation "
            "navigation — now mapped in TECU over the country."
        ),
        "why": (
            "This closes the loop: from one receiver looking at one satellite to a national ionospheric monitoring "
            "service for Zimbabwe."
        ),
        "equations": [],
        "variables": [
            {"symbol": "IPP", "meaning": "Ionospheric Pierce Point — where each VTEC value is geo-located"},
            {"symbol": "ZGIIS dashboard", "meaning": "Live VTEC, S4, and storm context from the CORS network"},
        ],
    },
]


def build_understanding_tec_payload() -> dict:
    """Full Understanding TEC page payload for GET /theory/understanding-tec."""
    steps = []
    for spec in _STEP_SPECS:
        steps.append({
            "id": spec["id"],
            "title": spec["title"],
            "accent": spec["accent"],
            "body": spec["body"],
            "why": spec["why"],
            "equations": spec["equations"],
            "variables": spec["variables"],
            "illustration": get_illustration(spec["id"]),
        })

    return {
        "citation": CITATION,
        "journey": get_journey_pills(),
        "pipeline_stages": OVERVIEW,
        "computation_pipeline": PIPELINE,
        "steps": steps,
    }
