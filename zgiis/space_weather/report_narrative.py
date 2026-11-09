"""Evidence-led, deterministic prose for archived space-weather assessments."""
from __future__ import annotations

from typing import Any

import pandas as pd


REPORT_REFERENCES = [
    {"title": "NOAA: planetary K-index", "url": "https://www.spaceweather.gov/products/planetary-k-index"},
    {"title": "NOAA: total electron content", "url": "https://www.spaceweather.gov/phenomena/total-electron-content"},
    {"title": "NOAA: ionospheric scintillation", "url": "https://www.spaceweather.gov/phenomena/ionospheric-scintillation"},
]

# Quiet-day Zimbabwe network-mean VTEC envelopes (CAT). Climatological bands for
# interpretation — not hard operational alarm thresholds.
_DIURNAL_WINDOWS = (
    {
        "id": "morning",
        "title": "Morning",
        "hours_cat": (6, 7, 8, 9, 10),
        "expected_low": 8.0,
        "expected_high": 30.0,
        "note": "After sunrise TEC normally rises under solar EUV ionisation.",
    },
    {
        "id": "noon",
        "title": "Noon / afternoon",
        "hours_cat": (11, 12, 13, 14, 15),
        "expected_low": 12.0,
        "expected_high": 45.0,
        "note": "Peak daytime TEC is expected near local noon–afternoon on quiet days.",
    },
    {
        "id": "night",
        "title": "Night",
        "hours_cat": (20, 21, 22, 23, 0, 1, 2, 3),
        "expected_low": 1.0,
        "expected_high": 12.0,
        "note": "Nighttime TEC normally falls as recombination dominates without EUV production.",
    },
)


def _mean_or_none(series: pd.Series) -> float | None:
    clean = pd.to_numeric(series, errors="coerce").dropna()
    if clean.empty:
        return None
    return float(clean.mean())


def _diurnal_tec_assessment(df: pd.DataFrame) -> tuple[list[str], list[dict[str, Any]]]:
    """Compare morning / noon / night TEC with quiet-day expected bands (CAT)."""
    if df.empty or "mean_vtec" not in df.columns:
        return (
            [
                "Network-mean TEC could not be partitioned into morning, noon and night "
                "because no valid TEC samples are present in this archive window."
            ],
            [],
        )

    work = df.copy()
    work["time"] = pd.to_datetime(work.get("time"), utc=True, errors="coerce")
    work["mean_vtec"] = pd.to_numeric(work.get("mean_vtec"), errors="coerce")
    work = work.dropna(subset=["time", "mean_vtec"])
    if work.empty:
        return (
            [
                "TEC timestamps are unavailable, so morning / noon / night trends cannot be assessed."
            ],
            [],
        )

    # Zimbabwe Central Africa Time = UTC+2
    work["hour_cat"] = (work["time"].dt.hour + 2) % 24
    paragraphs: list[str] = [
        "Local-time structure is assessed in CAT (UTC+2). Quiet-day Zimbabwe network means "
        "are expected to rise after sunrise, peak near noon–afternoon, and fall at night. "
        "Departures from those envelopes are anomalies relative to a quiet climatological band, "
        "not automatic proof of a geomagnetic storm."
    ]
    cards: list[dict[str, Any]] = []
    anomaly_bits: list[str] = []

    for window in _DIURNAL_WINDOWS:
        subset = work[work["hour_cat"].isin(window["hours_cat"])]["mean_vtec"]
        observed = _mean_or_none(subset)
        samples = int(subset.dropna().shape[0])
        low = float(window["expected_low"])
        high = float(window["expected_high"])
        if observed is None:
            status = "unavailable"
            color = "#94a3b8"
            status_label = "No samples"
            explanation = (
                f"{window['title']}: no network-mean TEC samples in hours "
                f"{window['hours_cat'][0]:02d}–{window['hours_cat'][-1]:02d} CAT."
            )
        elif observed < low:
            status = "below_expected"
            color = "#a855f7"
            status_label = "Below expected"
            explanation = (
                f"{window['title']}: observed mean {observed:.1f} TECU is below the quiet-day "
                f"expectation band of {low:.0f}–{high:.0f} TECU. A negative departure can reflect "
                f"a TEC depletion, incomplete station coverage, or an unusual recombination regime. "
                f"{window['note']}"
            )
            anomaly_bits.append(
                f"{window['title'].lower()} TEC {observed:.1f} TECU lay below the quiet band "
                f"({low:.0f}–{high:.0f} TECU)"
            )
        elif observed > high:
            status = "above_expected"
            color = "#f97316"
            status_label = "Above expected"
            explanation = (
                f"{window['title']}: observed mean {observed:.1f} TECU exceeds the quiet-day "
                f"expectation band of {low:.0f}–{high:.0f} TECU. A positive departure can arise from "
                f"elevated solar EUV, storm-time electron-density enhancement, or EIA intensification. "
                f"{window['note']}"
            )
            anomaly_bits.append(
                f"{window['title'].lower()} TEC {observed:.1f} TECU lay above the quiet band "
                f"({low:.0f}–{high:.0f} TECU)"
            )
        else:
            status = "within_expected"
            color = "#22c55e"
            status_label = "Within expected"
            explanation = (
                f"{window['title']}: observed mean {observed:.1f} TECU lies inside the quiet-day "
                f"expectation band of {low:.0f}–{high:.0f} TECU. {window['note']}"
            )

        paragraphs.append(explanation)
        cards.append(
            {
                "id": window["id"],
                "label": window["title"],
                "value": None if observed is None else round(observed, 1),
                "unit": "TECU",
                "status": status,
                "status_label": status_label,
                "value_color": color,
                "expected_low": low,
                "expected_high": high,
                "sample_count": samples,
                "hours_cat": list(window["hours_cat"]),
                "note": explanation,
            }
        )

    if anomaly_bits:
        paragraphs.append(
            "Scientific anomaly note: "
            + "; ".join(anomaly_bits)
            + ". Confirm with Kp, Dst/SYM-H, IMF Bz, solar-wind timing and station-level CORS "
            "TEC/S4 before attributing a local GNSS impact. Same-day geomagnetic elevation is a "
            "coincidence requiring further assessment, not automatic causation."
        )
    else:
        paragraphs.append(
            "No morning, noon or night network-mean TEC means departed from the quiet-day "
            "expectation bands in this archive window. That does not exclude short-lived or "
            "station-specific disturbances unresolved by the network mean."
        )

    return paragraphs, cards


def scientific_assessment(df: pd.DataFrame) -> dict:
    def values(key: str) -> pd.Series:
        return pd.to_numeric(df.get(key, pd.Series(dtype=float)), errors="coerce").dropna()

    kp, dst, wind, flux, tec, s4 = [
        values(key) for key in ("kp", "dst", "plasma_speed", "f107", "mean_vtec", "s4")
    ]
    times = pd.to_datetime(df.get("time", pd.Series(dtype=str)), utc=True, errors="coerce").dropna()
    diurnal_paragraphs, diurnal_cards = _diurnal_tec_assessment(df)

    if kp.empty:
        overview = "Geomagnetic activity cannot be classified because no valid Kp measurements are available for this interval."
    else:
        peak = float(kp.max())
        state = "storm-level" if peak >= 5 else "active" if peak >= 4 else "unsettled" if peak >= 3 else "quiet"
        overview = (
            f"The available archive indicates {state} planetary geomagnetic conditions at the interval maximum, "
            f"with Kp reaching {peak:.1f}."
        )
        overview += (
            " The archived Kp reached the NOAA minor-storm threshold (Kp 5) or above."
            if peak >= 5
            else " The archived Kp values remained below the NOAA geomagnetic-storm threshold of 5."
        )
    overview += " This describes the sampled interval, not a forecast or confirmation of disruption in Zimbabwe."

    geomagnetic = []
    if not kp.empty:
        geomagnetic.append(
            f"Kp ranged from {kp.min():.1f} to {kp.max():.1f}; the latest archived value was {kp.iloc[-1]:.1f}. "
            "Kp describes planetary magnetic disturbance rather than a local impact measurement."
        )
    if not dst.empty:
        geomagnetic.append(
            f"Dst ranged from {dst.min():.0f} to {dst.max():.0f} nT, ending at {dst.iloc[-1]:.0f} nT. "
            "Negative Dst is consistent with a depression of the equatorial magnetic field associated with "
            "enhanced ring-current activity; it does not quantify local power-grid currents."
        )
    if not geomagnetic:
        geomagnetic.append(
            "Neither Kp nor Dst has valid archived values in this interval; the geomagnetic response remains unassessed."
        )

    drivers = []
    if not wind.empty:
        drivers.append(
            f"Solar-wind speed ranged from {wind.min():.0f} to {wind.max():.0f} km/s, with a latest value of "
            f"{wind.iloc[-1]:.0f} km/s. Speed alone does not establish geoeffectiveness; IMF orientation, density "
            "and the duration of coupling are also required."
        )
    else:
        drivers.append(
            "Solar-wind speed is unavailable in this archive window, so upstream driving cannot be characterised from this report."
        )
    if not flux.empty:
        drivers.append(
            f"The latest archived F10.7 radio flux was {flux.iloc[-1]:.1f} sfu. F10.7 is a proxy for background "
            "solar activity and ionospheric forcing, not a direct measurement of flare intensity."
        )
    drivers.append(
        "This archive does not provide the IMF Bz history or verified flare/CME event chronology needed to "
        "attribute a disturbance to a specific solar driver."
    )

    ionosphere = []
    if not tec.empty:
        ionosphere.append(
            f"Network-mean vertical TEC ranged from {tec.min():.1f} to {tec.max():.1f} TECU; the latest value was "
            f"{tec.iloc[-1]:.1f} TECU. TEC describes the ionospheric electron column."
        )
    else:
        ionosphere.append(
            "No network-mean TEC observations are available in this window; a local ionospheric response cannot be established from TEC."
        )
    if not s4.empty:
        ionosphere.append(
            f"Archived amplitude-scintillation index S4 peaked at {s4.max():.3f}, with a latest value of "
            f"{s4.iloc[-1]:.3f}. Interpretation requires receiver quality control and station/satellite context; "
            "these aggregate values do not demonstrate a network-wide loss of lock."
        )
    else:
        ionosphere.append(
            "S4 observations are unavailable. Missing scintillation measurements must not be interpreted as an absence of scintillation."
        )
    ionosphere.extend(diurnal_paragraphs)

    operations = [
        "For Zimbabwe GNSS operations, interpret these environmental indicators alongside station-level TEC "
        "gradients, receiver tracking, cycle slips and positioning residuals. The archive alone does not "
        "establish RTK accuracy or an observed positioning outage.",
        "CORS availability describes service continuity. A station outage may arise from power, communications "
        "or equipment faults and cannot be attributed to space weather from availability alone.",
        "Power-grid effects are not assessed: local magnetic-field variation, ground conductivity and network "
        "or GIC measurements are not supplied in this report.",
    ]
    monitoring = (
        "Maintain heightened monitoring of local GNSS quality and geomagnetic updates while elevated indicators persist."
        if (not kp.empty and kp.max() >= 5) or (not s4.empty and s4.max() >= 0.3)
        else "Continue routine monitoring and review station-level quality before precision GNSS operations."
    )
    outlook = [
        monitoring
        + " No arrival-time forecast, storm probability or persistence forecast can be derived from this retrospective archive alone."
    ]

    missing = [
        label
        for label, series in [
            ("Kp", kp),
            ("Dst", dst),
            ("solar-wind speed", wind),
            ("F10.7", flux),
            ("TEC", tec),
            ("S4", s4),
        ]
        if series.empty
    ]
    methods = [
        f"This automated assessment uses {len(df)} archived records within the requested UTC interval. "
        "Repeated upstream values may occur in successive records; record count is not a count of independent measurements."
    ]
    if not times.empty:
        methods.append(
            f"Available record timestamps extend from {times.min().strftime('%Y-%m-%d %H:%M UTC')} to "
            f"{times.max().strftime('%Y-%m-%d %H:%M UTC')}. This span does not demonstrate continuous coverage or feed freshness."
        )
    if missing:
        methods.append("Unavailable parameters: " + ", ".join(missing) + ". Their absence limits the assessment.")
    methods.append(
        "Morning / noon / night TEC cards use CAT hours and quiet-day climatological bands "
        "(night ~1–12 TECU, morning ~8–30 TECU, noon ~12–45 TECU). Statistics use valid archived values "
        "without interpolation. Charts show a reduced selection of records and may omit short-lived extrema. "
        "Parameter trends compare the first and second halves of available values; they do not establish a "
        "physical cause. This is an automated scientific assessment; no individual scientist review is recorded."
    )

    return {
        "executive_summary": overview,
        "sections": [
            {"id": key, "title": title, "paragraphs": paragraphs}
            for key, title, paragraphs in [
                ("geomagnetic", "Geomagnetic response", geomagnetic),
                ("drivers", "Solar and solar-wind context", drivers),
                ("ionosphere", "Ionospheric conditions and diurnal TEC trends", ionosphere),
                ("operations", "Implications for Zimbabwe", operations),
                ("outlook", "Monitoring priorities and outlook", outlook),
                ("methods", "Data basis and assessment limits", methods),
            ]
        ],
        "diurnal_cards": diurnal_cards,
        "references": REPORT_REFERENCES,
    }
