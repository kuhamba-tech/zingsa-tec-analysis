"""Geomagnetic Storm Metrics Theory — framework-agnostic (FastAPI + Next.js)."""
from __future__ import annotations

from zgiis.processing.vtec_equations import equation_record
from zgiis.space_weather.geomagnetic_illustrations import get_illustration, get_journey_pills

CITATION = (
    "Geomagnetic storm indices follow international conventions: Kp and Ap (GFZ Potsdam / "
    "NOAA SWPC), Dst (WDC Kyoto), F10.7 (NOAA/DRAO), and solar wind parameters (NASA OMNIWeb). "
    "ZINGSA ZGIIS ingests these for operational space-weather monitoring over Zimbabwe."
)

METRIC_OVERVIEW = [
    {"label": "Kp · Dst · Ap", "icon": "🧲"},
    {"label": "F10.7 · SSN", "icon": "☀️"},
    {"label": "Solar wind · Bz", "icon": "💨"},
    {"label": "GIC · GNSS · TEC", "icon": "🇿🇼"},
]

READING_PIPELINE = {
    "inputs": [
        "NOAA SWPC / OMNIWeb",
        "GFZ Potsdam Kp·Ap·Cp",
        "WDC Kyoto Dst",
        "DRAO F10.7",
    ],
    "stages": [
        {"label": "Fetch live & archive indices", "ref": "multi-source Time Series tab"},
        {"label": "Flag storm thresholds (Kp≥5, Dst≤−50, Ap≥50)", "ref": "Storm Watch + Dashboard"},
        {"label": "Cross-check with local data", "ref": "INTERMAGNET dB/dt, CORS TEC/S4"},
        {"label": "Issue Navigation News briefs", "ref": "GNSS Intelligence page"},
    ],
    "output": "ZGIIS operational alerts · GIC monitor · Navigation News briefs",
}

_STEP_SPECS: list[dict] = [
    {
        "id": "1",
        "title": "From the Sun to Earth's Magnetosphere",
        "accent": "#ffcc00",
        "body": (
            "Geomagnetic space weather begins at the Sun. Solar flares and coronal mass ejections (CMEs) "
            "release billions of tonnes of magnetised plasma into the solar wind. When this cloud reaches Earth "
            "— typically 1–3 days later — it compresses the magnetosphere and injects energy into the "
            "radiation belts and ionosphere. The same chain drives auroras, radio blackouts, and the indices "
            "you see on the ZGIIS dashboard."
        ),
        "why": (
            "Understanding the Sun–Earth link explains why storm indices lag solar eruptions by hours or days, "
            "and why not every high F10.7 day produces an immediate geomagnetic storm."
        ),
        "equations": [],
        "variables": [
            {"symbol": "CME", "meaning": "Coronal mass ejection — large burst of solar plasma and magnetic field"},
            {"symbol": "IMF", "meaning": "Interplanetary magnetic field embedded in the solar wind"},
            {"symbol": "Magnetosphere", "meaning": "Earth's magnetic cavity shielding the atmosphere from direct solar-wind impact"},
        ],
    },
    {
        "id": "2",
        "title": "Kp — The Planetary Geomagnetic Index",
        "accent": "#00ff88",
        "body": (
            "Kp is the most widely used real-time storm index. It is derived from magnetometer readings at "
            "sub-auroral observatories worldwide and scaled to a planetary 3-hour index from 0 (quiet) to 9 "
            "(extreme storm). NOAA maps Kp to the G-scale: G1 at Kp = 5, G2 at 6, G3 at 7, G4 at 8, G5 at 9. "
            "On the ZGIIS dashboard and Time Series tab, Kp is plotted from NASA OMNIWeb, CelesTrak, GFZ, and WDC Kyoto."
        ),
        "why": (
            "Kp ≥ 5 is the standard threshold for declaring a geomagnetic storm. It is the first index operators "
            "watch when assessing GIC risk on the ZETDC grid or degraded GNSS accuracy over Zimbabwe."
        ),
        "equations": [
            equation_record(
                r"G\text{-scale storm when } Kp \geq 5 \;(\text{G1}), \; Kp \geq 7 \;(\text{G3 strong})",
                "G1",
                "NOAA geomagnetic storm scale tied to 3-hourly Kp",
            ),
        ],
        "variables": [
            {"symbol": "Kp", "meaning": "Planetary 3-hour geomagnetic index (0–9, quasi-logarithmic)"},
            {"symbol": "Kp = 5", "meaning": "Minor geomagnetic storm (G1) — orange threshold on ZGIIS charts"},
            {"symbol": "Kp<sub>max</sub>", "meaning": "Daily maximum Kp — used for storm-day shading in archive plots"},
        ],
    },
    {
        "id": "3",
        "title": "Dst — Disturbance Storm Time (Ring Current)",
        "accent": "#ff4444",
        "body": (
            "Dst measures the strength of the westward ring current circling Earth at equatorial latitudes, "
            "expressed in nanoTesla (nT). During quiet times Dst is near 0 nT. In a storm's main phase, "
            " Dst becomes strongly negative as millions of amperes flow westward — the signature of a "
            "geomagnetic storm at Earth. WDC Kyoto, Japan, is the authoritative Dst provider; NASA OMNIWeb "
            "redistributes it for comparison on ZGIIS charts."
        ),
        "why": (
            "Dst ≤ −50 nT is a classic storm threshold. It often reaches its minimum (most negative) during "
            "the main phase, while Kp may already have risen at storm sudden commencement (SSC). "
            "Compare Dst timing with GIC spikes on the GIC Monitor."
        ),
        "equations": [
            equation_record(
                r"\text{Storm threshold: } Dst \leq -50\,\text{nT}",
                "Dst",
                "Ring-current storm level widely used in space-weather operations",
            ),
        ],
        "variables": [
            {"symbol": "Dst", "meaning": "Disturbance Storm Time index (nT) — more negative = stronger ring current"},
            {"symbol": "−50 nT", "meaning": "Common weak-storm threshold (orange dashed line on ZGIIS Dst charts)"},
            {"symbol": "−100 nT", "meaning": "Moderate storm main phase; −200 nT and below = intense storm"},
        ],
    },
    {
        "id": "4",
        "title": "Ap — Planetary Amplitude (Daily Activity)",
        "accent": "#a78bfa",
        "body": (
            "While Kp is updated every 3 hours, Ap summarises an entire UTC day. Eight K-derived amplitude "
            "values (a<sub>p</sub>) from the 3-hour intervals are averaged to produce one daily Ap index. "
            "Ap ranges from 0 (quiet) to 400 (extreme). Ap ≥ 50 indicates storm-level daily geomagnetic activity. "
            "CelesTrak publishes daily mean Ap; WDC Kyoto provides definitive planetary Ap for archive comparison."
        ),
        "why": (
            "Ap is useful for daily reports and correlating with daily sunspot or F10.7 trends. "
            "On the Time Series tab, Ap from CelesTrak and Kyoto is plotted alongside Kp and Dst to confirm "
            "the same storm was recorded by multiple providers."
        ),
        "equations": [
            equation_record(
                r"Ap = \mathrm{mean}(a_p^{(1)}, a_p^{(2)}, \ldots, a_p^{(8)}) \quad \text{over UTC day}",
                "Ap",
                "Daily planetary geomagnetic amplitude index",
            ),
        ],
        "variables": [
            {"symbol": "Ap", "meaning": "Daily planetary amplitude index (0–400)"},
            {"symbol": "a<sub>p</sub>", "meaning": "Amplitude derived from each 3-hour K index interval"},
            {"symbol": "Ap ≥ 50", "meaning": "Storm-level daily activity — compare with Kp ≥ 5 days"},
        ],
    },
    {
        "id": "5",
        "title": "F10.7 Solar Radio Flux & Sunspot Number",
        "accent": "#f59e0b",
        "body": (
            "F10.7 is the solar radio flux at 10.7 cm wavelength, measured in solar flux units (sfu). "
            "1 sfu = 10⁻²² W m⁻² Hz⁻¹. It tracks the Sun's activity over the 11-year solar cycle — "
            "quiet Sun ~70 sfu, active Sun ~150–250 sfu. Sunspot number (SSN) is a complementary count of "
            "dark sunspot groups on the solar disc. Both are plotted on the ZGIIS Time Series and Dashboard."
        ),
        "why": (
            "F10.7 and SSN describe the long-term solar driver — they raise background ionospheric TEC over "
            "Zimbabwe but do not by themselves prove a geomagnetic storm today. Always cross-check with Kp, Dst, "
            "and Ap when assessing immediate storm risk."
        ),
        "equations": [
            equation_record(
                r"1\,\text{sfu} = 10^{-22}\,\mathrm{W\,m^{-2}\,Hz^{-1}}",
                "F10.7",
                "Solar flux unit definition for 10.7 cm radio observations",
            ),
        ],
        "variables": [
            {"symbol": "F10.7", "meaning": "10.7 cm solar radio flux (sfu) — proxy for solar UV and activity"},
            {"symbol": "SSN", "meaning": "International sunspot number — count of sunspot groups × multiplier"},
            {"symbol": "~150 sfu", "meaning": "Typical active-Sun level; higher values favour more CMEs over time"},
        ],
    },
    {
        "id": "6",
        "title": "Solar Wind Speed & IMF Bz",
        "accent": "#168bd2",
        "body": (
            "The solar wind is a continuous stream of protons and electrons. Its speed (km/s) and the "
            "north–south component of the interplanetary magnetic field (IMF Bz, in nT) control storm "
            "intensity. Fast wind (> 500 km/s) carries more momentum. When Bz turns southward (negative), "
            "it connects to Earth's northward field and energy transfers efficiently — the classic recipe "
            "for a geomagnetic storm. Both parameters are shown on the ZGIIS Dashboard live timeline."
        ),
        "why": (
            "Solar wind Bz southward is often the immediate trigger before Kp rises and Dst plunges. "
            "Watch for fast wind + negative Bz combinations during Navigation Weather storm briefs."
        ),
        "equations": [
            equation_record(
                r"\text{Strong coupling when } B_z < 0\,\text{nT (southward IMF)}",
                "Bz",
                "Southward interplanetary field opens the magnetosphere to solar-wind energy",
            ),
        ],
        "variables": [
            {"symbol": "V<sub>sw</sub>", "meaning": "Solar wind speed (km/s) — typical quiet: ~400; storm: > 500"},
            {"symbol": "Bz", "meaning": "IMF north–south component (nT) — negative = southward = storm-favourable"},
            {"symbol": "Dynamic pressure", "meaning": "ρV² term compressing the magnetopause during fast wind"},
        ],
    },
    {
        "id": "7",
        "title": "Storm Phases — Putting the Indices Together",
        "accent": "#f472b6",
        "body": (
            "A typical geomagnetic storm unfolds in phases. (1) Quiet: Kp ≤ 2, Dst near 0. "
            "(2) Sudden Storm Commencement (SSC): magnetometers jump as the shock arrives — Kp rises quickly. "
            "(3) Main phase: Kp stays elevated, Dst becomes strongly negative — ring current builds. "
            "(4) Recovery: Kp falls, Dst returns toward zero over hours to days. "
            "On ZGIIS, overlay Kp, Dst, Ap, F10.7, and VTEC on the same date range to see this sequence."
        ),
        "why": (
            "No single index tells the full story. Kp flags real-time storm level; Dst confirms ring-current "
            "intensity; Ap validates the daily summary; F10.7 explains the broader solar-cycle context."
        ),
        "equations": [],
        "variables": [
            {"symbol": "SSC", "meaning": "Sudden Storm Commencement — sharp magnetometer impulse at shock arrival"},
            {"symbol": "Main phase", "meaning": "Period of strongest negative Dst and elevated Kp"},
            {"symbol": "Recovery", "meaning": "Gradual return of Dst and Kp toward quiet values"},
        ],
    },
    {
        "id": "8",
        "title": "Why It Matters for Zimbabwe",
        "accent": "#00ff88",
        "body": (
            "Geomagnetic storms affect Zimbabwe's infrastructure through several pathways. "
            "GIC (geomagnetically induced currents) flow in the ZETDC power grid when the magnetic field "
            "changes rapidly — monitored on the GIC Monitor. GNSS positioning errors increase when the "
            "ionosphere is disturbed (TEC and S4 scintillation from the CORS network). "
            "Radio communications and satellite operations can also degrade. ZINGSA publishes Navigation News "
            "briefs so farmers, surveyors, drivers, and citizens know when to trust GPS and when to call ZINGSA."
        ),
        "why": (
            "The indices on the dashboard are not abstract numbers — they protect national positioning services, "
            "the power grid, and public safety during space-weather events over Southern Africa."
        ),
        "equations": [],
        "variables": [
            {"symbol": "GIC", "meaning": "Geomagnetically induced current (A) in transformers — driven by dB/dt"},
            {"symbol": "VTEC / S4", "meaning": "Ionospheric delay and scintillation affecting GNSS over Zimbabwe"},
            {"symbol": "Cp", "meaning": "GFZ daily planetary character index (0–2.5) — also on Time Series tab"},
        ],
    },
]


def build_geomagnetic_theory_payload() -> dict:
    """Full Geomagnetic Storm Metrics Theory payload for GET /theory/geomagnetic."""
    steps = []
    for spec in _STEP_SPECS:
        step = {
            "id": spec["id"],
            "title": spec["title"],
            "accent": spec["accent"],
            "body": spec["body"],
            "why": spec["why"],
            "equations": spec["equations"],
            "variables": spec["variables"],
            "illustration": get_illustration(spec["id"]),
        }
        steps.append(step)

    return {
        "citation": CITATION,
        "journey": get_journey_pills(),
        "pipeline_stages": METRIC_OVERVIEW,
        "computation_pipeline": READING_PIPELINE,
        "steps": steps,
    }
