"""Horizontal Kp and geomagnetic condition scale references."""
from __future__ import annotations

import streamlit as st

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


def active_kp_band_index(kp: float) -> int:
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


def build_synchronized_kp_scales_html(kp: float) -> str:
    """Return synchronized Kp + geomagnetic scales in one aligned grid."""
    active_idx = active_kp_band_index(kp)
    cells: list[str] = [
        "<div class='hero-scales-grid'>",
        "<div class='kp-scale-row-label'>Kp Scale Reference</div>",
    ]
    for idx, band in enumerate(KP_SCALE_BANDS):
        kp_label, condition, color, _, _ = band
        cells.append(
            _band_cell(
                idx,
                active_idx,
                kp_label,
                condition,
                color,
                value_fn=lambda kl, _c: kl,
                label_fn=lambda _kl, c: c,
            )
        )
    cells.append("<div class='kp-scale-row-label'>Geomagnetic Condition Scale</div>")
    for idx, band in enumerate(KP_SCALE_BANDS):
        kp_label, condition, color, _, _ = band
        cells.append(
            _band_cell(
                idx,
                active_idx,
                kp_label,
                condition,
                color,
                value_fn=lambda _kl, c: c,
                label_fn=lambda kl, _c: f"Kp {kl}",
            )
        )
    cells.append("</div>")
    return "".join(cells)


def render_synchronized_kp_scales(kp: float) -> None:
    """Render Kp and geomagnetic scales with aligned columns."""
    st.markdown(build_synchronized_kp_scales_html(kp), unsafe_allow_html=True)


def render_horizontal_kp_scale(kp: float, *, title: str = "Kp Scale Reference") -> None:
    """Render a horizontal Kp reference scale with the current Kp band highlighted."""
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
