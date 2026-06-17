"""Horizontal Kp and geomagnetic condition scale references."""
from __future__ import annotations

KP_SCALE_BANDS: list[tuple[str, str, str, float, float]] = [
    # kp_label, condition, color, kp_min (inclusive), kp_max (exclusive)
    ("0-2", "Quiet", "#00ff88", 0.0, 3.0),
    ("3", "Unsettled", "#88ff44", 3.0, 4.0),
    ("4", "Active", "#ffff00", 4.0, 5.0),
    ("5", "Minor Storm G1", "#ff8c00", 5.0, 6.0),
    ("6", "Moderate G2", "#ff6600", 6.0, 7.0),
    ("7", "Strong G3", "#ff2200", 7.0, 8.0),
    ("8", "Severe G4", "#cc0044", 8.0, 9.0),
    ("9", "Extreme G5", "#880088", 9.0, 10.0),
]

REFERENCE_SCALE_ROWS: list[tuple[str, list[tuple[str, str, str]]]] = [
    (
        "Dst Index<br>Scale (nT)",
        [
            ("0 to -20", "Quiet", "#00ff88"),
            ("-20 to -30", "Weak", "#88ff44"),
            ("-30 to -50", "Moderate", "#c8ff22"),
            ("-50 to -100", "Intense", "#ffb000"),
            ("-100 to -200", "Severe", "#ff6600"),
            ("-200 to -350", "Extreme", "#ff2200"),
            ("&lt; -350", "Super Storm", "#a000d0"),
        ],
    ),
    (
        "S4 Scintillation<br>Index Scale",
        [
            ("0.0-0.1", "None", "#00ff88"),
            ("0.1-0.2", "Negligible", "#55ee66"),
            ("0.2-0.3", "Weak", "#aaff22"),
            ("0.3-0.5", "Moderate", "#ffcc00"),
            ("0.5-0.7", "Strong", "#ff6600"),
            ("0.7-0.9", "Severe", "#ff2222"),
            ("0.9-1.0", "Full Outage", "#a000d0"),
        ],
    ),
    (
        "TEC Scale<br>(TECU)",
        [
            ("0-10", "Very Low", "#168bd2"),
            ("10-25", "Low", "#33ee88"),
            ("25-40", "Moderate", "#aaff22"),
            ("40-60", "High", "#ffcc00"),
            ("60-80", "Very High", "#ff7700"),
            ("80-100", "Extreme", "#ff2222"),
            ("&gt; 100", "Severe Storm", "#a000d0"),
        ],
    ),
    (
        "Solar Flux<br>F10.7 Scale (SFU)",
        [
            ("65-80", "Solar Min.", "#00d4aa"),
            ("80-100", "Low", "#33ee88"),
            ("100-130", "Below Avg.", "#aaff22"),
            ("130-170", "Moderate", "#ffcc00"),
            ("170-220", "High", "#ff7700"),
            ("220-270", "Very High", "#ff2222"),
            ("&gt; 270", "Extreme", "#a000d0"),
        ],
    ),
    (
        "Solar Wind<br>Speed Scale (km/s)",
        [
            ("250-350", "Slow", "#00d4aa"),
            ("350-450", "Typical", "#33ee88"),
            ("450-550", "Fast", "#aaff22"),
            ("550-650", "Very Fast", "#ffcc00"),
            ("650-750", "Storm Wind", "#ff7700"),
            ("750-850", "Major CME", "#ff2222"),
            ("&gt; 850", "Extreme", "#a000d0"),
        ],
    ),
]


def active_kp_band_index(kp: float | None) -> int:
    if kp is None:
        return -1
    value = float(kp)
    for idx, (_, _, _, lo, hi) in enumerate(KP_SCALE_BANDS):
        if lo <= value < hi:
            return idx
    return len(KP_SCALE_BANDS) - 1


def _band_cell(
    idx: int,
    active_idx: int,
    kp_label: str,
    condition: str,
    color: str,
    *,
    value_fn,
    label_fn,
) -> str:
    active_cls = " kp-scale-item-active" if idx == active_idx else ""
    return (
        f"<div class='kp-scale-item{active_cls}'>"
        f"<div class='kp-scale-value' style='color:{color}'>{value_fn(kp_label, condition)}</div>"
        f"<div class='kp-scale-label'>{label_fn(kp_label, condition)}</div>"
        f"<div class='kp-scale-color-bar' style='background:{color}'></div>"
        f"</div>"
    )


def _reference_cell(value: str, label: str, color: str) -> str:
    return (
        "<div class='kp-scale-item'>"
        f"<div class='kp-scale-value' style='color:{color}'>{value}</div>"
        f"<div class='kp-scale-label'>{label}</div>"
        f"<div class='kp-scale-color-bar' style='background:{color}'></div>"
        "</div>"
    )


def _scale_band_row(cells: list[str], column_count: int) -> str:
    return (
        f"<div class='hero-scale-band-row' style='--scale-columns:{column_count}'>"
        f"{''.join(cells)}"
        "</div>"
    )


def build_synchronized_kp_scales_html(kp: float | None) -> str:
    """Return the complete aligned space-weather reference scale panel."""
    active_idx = active_kp_band_index(kp)
    cells: list[str] = [
        "<div class='hero-scales-grid'>",
        "<div class='kp-scale-row-label'>Kp Scale Reference</div>",
    ]
    cells.append(
        _scale_band_row(
            [
                _band_cell(
                    idx,
                    active_idx,
                    kp_label,
                    condition,
                    color,
                    value_fn=lambda kl, _c: kl,
                    label_fn=lambda _kl, c: c,
                )
                for idx, (kp_label, condition, color, _, _) in enumerate(KP_SCALE_BANDS)
            ],
            len(KP_SCALE_BANDS),
        )
    )
    cells.append("<div class='kp-scale-row-label'>Geomagnetic Condition Scale</div>")
    cells.append(
        _scale_band_row(
            [
                _band_cell(
                    idx,
                    active_idx,
                    kp_label,
                    condition,
                    color,
                    value_fn=lambda _kl, c: c,
                    label_fn=lambda kl, _c: f"Kp {kl}",
                )
                for idx, (kp_label, condition, color, _, _) in enumerate(KP_SCALE_BANDS)
            ],
            len(KP_SCALE_BANDS),
        )
    )
    for row_label, bands in REFERENCE_SCALE_ROWS:
        cells.append(f"<div class='kp-scale-row-label'>{row_label}</div>")
        cells.append(
            _scale_band_row(
                [
                    _reference_cell(value, label, color)
                    for value, label, color in bands
                ],
                len(bands),
            )
        )
    cells.append("</div>")
    return "".join(cells)


def render_synchronized_kp_scales(kp: float) -> None:
    """Render Kp and geomagnetic scales with aligned columns."""
    import streamlit as st

    st.markdown(build_synchronized_kp_scales_html(kp), unsafe_allow_html=True)


def render_horizontal_kp_scale(kp: float, *, title: str = "Kp Scale Reference") -> None:
    """Render a horizontal Kp reference scale with the current Kp band highlighted."""
    import streamlit as st

    active_idx = active_kp_band_index(kp)
    band_html = "".join(
        _band_cell(
            idx,
            active_idx,
            kp_label,
            condition,
            color,
            value_fn=lambda kl, _c: kl,
            label_fn=lambda _kl, c: c,
        )
        for idx, (kp_label, condition, color, _, _) in enumerate(KP_SCALE_BANDS)
    )
    st.markdown(
        f"<div class='hero-scales-grid hero-scales-grid-single'>"
        f"<div class='kp-scale-row-label'>{title}</div>{band_html}</div>",
        unsafe_allow_html=True,
    )


def render_horizontal_geomagnetic_scale(
    kp: float,
    *,
    title: str = "Geomagnetic Condition Scale",
) -> None:
    """Render a horizontal geomagnetic-condition scale with the active level highlighted."""
    import streamlit as st

    active_idx = active_kp_band_index(kp)
    band_html = "".join(
        _band_cell(
            idx,
            active_idx,
            kp_label,
            condition,
            color,
            value_fn=lambda _kl, c: c,
            label_fn=lambda kl, _c: f"Kp {kl}",
        )
        for idx, (kp_label, condition, color, _, _) in enumerate(KP_SCALE_BANDS)
    )
    st.markdown(
        f"<div class='hero-scales-grid hero-scales-grid-single'>"
        f"<div class='kp-scale-row-label'>{title}</div>{band_html}</div>",
        unsafe_allow_html=True,
    )
