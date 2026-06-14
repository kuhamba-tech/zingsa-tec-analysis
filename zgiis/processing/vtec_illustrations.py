"""SVG illustrations for the VTEC Theory page — clean, readable, consistent style."""

from __future__ import annotations

import base64
import math

_FONT = "Arial,Helvetica,sans-serif"
_BG = "#060d1a"
_WHITE = "#ffffff"

# Standard step-card canvas (fits sidebar column without clipping)
_W = 340
_H = 280

_ILLUSTRATIONS: dict[str, tuple[str, str]] = {}


def _register(step_id: str, caption: str, svg: str) -> None:
    _ILLUSTRATIONS[step_id] = (caption, svg)


def _embed_svg(svg: str, css_class: str = "vtec-illus-img") -> str:
    encoded = base64.b64encode(svg.strip().encode("utf-8")).decode("ascii")
    return (
        f'<img class="{css_class}" '
        f'src="data:image/svg+xml;base64,{encoded}" alt="VTEC theory diagram" />'
    )


def render_vtec_illustration(step_id: str) -> str:
    caption, svg = _ILLUSTRATIONS[step_id]
    return (
        f"<div class='vtec-illus-card'>"
        f"<div class='vtec-illus-caption'>{caption}</div>"
        f"{_embed_svg(svg)}"
        f"</div>"
    )


def _canvas(
    inner: str,
    *,
    width: int = _W,
    height: int = _H,
    css_class: str = "vtec-illus-svg",
) -> str:
    return (
        f'<svg class="{css_class}" viewBox="0 0 {width} {height}" '
        f'xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">'
        f'<rect width="{width}" height="{height}" fill="{_BG}"/>'
        f"{inner}"
        f"</svg>"
    )


def _arrow_defs(marker_id: str, color: str = "#e2e8f0") -> str:
    return f"""
  <defs>
    <marker id="{marker_id}" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="{color}"/>
    </marker>
  </defs>"""


def _earth_scene(
    *,
    ox: float = 118,
    oy: float = 188,
    re: float = 56,
    shell_r: float = 86,
    station_angle: float = 218,
    sat_angle: float = 322,
    sat_dist: float = 1.48,
) -> dict[str, float]:
    sa = math.radians(station_angle)
    ta = math.radians(sat_angle)
    sx = ox + re * math.cos(sa)
    sy = oy + re * math.sin(sa)
    shell_x = ox + shell_r * math.cos(ta)
    shell_y = oy + shell_r * math.sin(ta)
    sat_r = re * sat_dist
    sat_x = ox + sat_r * math.cos(ta)
    sat_y = oy + sat_r * math.sin(ta)
    return {
        "ox": ox, "oy": oy, "re": re, "shell_r": shell_r,
        "sx": sx, "sy": sy, "shell_x": shell_x, "shell_y": shell_y,
        "sat_x": sat_x, "sat_y": sat_y,
    }


def _earth_disk(g: dict[str, float], *, label: str = "Earth") -> str:
    ox, oy, re = g["ox"], g["oy"], g["re"]
    return f"""
  <circle cx="{ox}" cy="{oy}" r="{re}" fill="#0a1e38" stroke="#e2e8f0" stroke-width="1.8"/>
  <text x="{ox}" y="{oy + 5}" text-anchor="middle" fill="{_WHITE}" font-size="10"
        font-family="{_FONT}">{label}</text>"""


def _iono_arc(g: dict[str, float]) -> str:
    ox, oy, rs = g["ox"], g["oy"], g["shell_r"]
    return f"""
  <path d="M {ox - rs:.1f} {oy - rs * 0.86:.1f} A {rs} {rs} 0 0 1 {ox + rs * 0.52:.1f} {oy - rs * 0.9:.1f}"
        fill="none" stroke="#00d4ff" stroke-width="1.4" stroke-dasharray="6,4"/>"""


def _station_marker(g: dict[str, float], label: str = "Receiver") -> str:
    sx, sy = g["sx"], g["sy"]
    return f"""
  <polygon points="{sx:.1f},{sy:.1f} {sx + 7:.1f},{sy + 11:.1f} {sx - 7:.1f},{sy + 11:.1f}"
           fill="#00ff88"/>
  <text x="{sx - 48}" y="{sy - 6}" fill="#00ff88" font-size="10" font-weight="700"
        font-family="{_FONT}">{label}</text>"""


def _satellite_marker(g: dict[str, float], label: str = "Satellite") -> str:
    sx, sy = g["sat_x"], g["sat_y"]
    return f"""
  <circle cx="{sx}" cy="{sy}" r="7" fill="#1e3a5f" stroke="#00d4ff" stroke-width="1.4"/>
  <line x1="{sx - 16}" y1="{sy}" x2="{sx - 26}" y2="{sy}" stroke="#00d4ff" stroke-width="1.6"/>
  <line x1="{sx + 16}" y1="{sy}" x2="{sx + 26}" y2="{sy}" stroke="#00d4ff" stroke-width="1.6"/>
  <text x="{sx + 32}" y="{sy + 4}" fill="{_WHITE}" font-size="10" font-family="{_FONT}">{label}</text>"""


def _chart_grid(x0: float = 54, y0: float = 34, w: float = 268, h: float = 128) -> str:
    x1, y1 = x0 + w, y0 + h
    return f"""
  <rect x="{x0 - 4}" y="{y0 - 4}" width="{w + 8}" height="{h + 8}" rx="6"
        fill="#0a1628" stroke="#1e3a5f" stroke-width="1"/>
  <line x1="{x0}" y1="{y1}" x2="{x1}" y2="{y1}" stroke="#475569" stroke-width="1.2"/>
  <line x1="{x0}" y1="{y0}" x2="{x0}" y2="{y1}" stroke="#475569" stroke-width="1.2"/>"""


def _chart_axes(y_label: str, x_label: str, *, x0: float = 54, y1: float = 162) -> str:
    return f"""
  <text x="24" y="102" fill="{_WHITE}" font-size="10" font-family="{_FONT}"
        transform="rotate(-90 24 102)">{y_label}</text>
  <text x="188" y="{y1 + 20}" text-anchor="middle" fill="{_WHITE}" font-size="10"
        font-family="{_FONT}">{x_label}</text>"""


def _legend_row(y: float, color: str, label: str, *, x: float = 54) -> str:
    return f"""
  <line x1="{x}" y1="{y}" x2="{x + 24}" y2="{y}" stroke="{color}" stroke-width="2.8"/>
  <text x="{x + 32}" y="{y + 4}" fill="{_WHITE}" font-size="10" font-family="{_FONT}">{label}</text>"""


def _footer(text: str, y: float = 268) -> str:
    return f"""
  <text x="{_W / 2:.0f}" y="{y}" text-anchor="middle" fill="{_WHITE}" font-size="10"
        font-family="{_FONT}">{text}</text>"""


# ── Step 1 ────────────────────────────────────────────────────────────────────
def _step1_svg() -> str:
    g = _earth_scene(ox=112, oy=192, re=54, shell_r=84)
    return _canvas(
        f"""
  {_iono_arc(g)}
  <text x="248" y="36" fill="#00d4ff" font-size="11" font-weight="700"
        font-family="{_FONT}">Ionosphere</text>
  {_earth_disk(g)}
  {_station_marker(g, "Receiver")}
  {_satellite_marker(g, "Satellite")}
  <line x1="{g['sat_x']:.1f}" y1="{g['sat_y']:.1f}" x2="{g['sx']:.1f}" y2="{g['sy']:.1f}"
        stroke="#e2e8f0" stroke-width="2.2"/>
  <polygon points="{g['sx'] + 6:.1f},{g['sy'] - 2:.1f} {g['sx']:.1f},{g['sy'] - 10:.1f} {g['sx'] - 4:.1f},{g['sy'] - 2:.1f}"
           fill="#e2e8f0"/>
  <text x="228" y="108" fill="{_WHITE}" font-size="10" font-weight="700"
        font-family="{_FONT}">Signal path</text>
  <line x1="{g['ox']:.1f}" y1="{g['oy']:.1f}" x2="{g['sx']:.1f}" y2="{g['sy']:.1f}"
        stroke="#64748b" stroke-width="1.2" stroke-dasharray="4,3"/>
  <text x="{g['ox'] + 12:.1f}" y="{g['oy'] - 10:.1f}" fill="{_WHITE}" font-size="9"
        font-family="{_FONT}">True range</text>
  <rect x="228" y="132" width="96" height="26" rx="6" fill="rgba(251,191,36,0.2)"
        stroke="#fbbf24" stroke-width="1"/>
  <text x="276" y="149" text-anchor="middle" fill="#fbbf24" font-size="10" font-weight="700"
        font-family="{_FONT}">Extra delay</text>
  {_footer("Ionospheric delay = extra path length along the ray")}
"""
    )


_register(
    "1",
    "The ionosphere slows the GNSS signal — the extra path length is the delay.",
    _step1_svg(),
)

# ── Step 2 ────────────────────────────────────────────────────────────────────
_register(
    "2",
    "Carrier phase advances (shorter range); pseudorange/code is delayed (longer range).",
    _canvas(
        f"""
  <rect x="16" y="18" width="308" height="96" rx="10" fill="#0a1628" stroke="#00ff88" stroke-width="1.2"/>
  <text x="28" y="40" fill="#00ff88" font-size="11" font-weight="700" font-family="{_FONT}">
    Phase (carrier L)
  </text>
  <line x1="28" y1="64" x2="312" y2="64" stroke="#64748b" stroke-width="1" stroke-dasharray="5,4"/>
  <path d="M 28 54 Q 96 36 164 54 T 300 54" fill="none" stroke="#00ff88" stroke-width="2.4"/>
  <text x="28" y="98" fill="{_WHITE}" font-size="10" font-family="{_FONT}">
    Shorter apparent range (phase advance)
  </text>

  <rect x="16" y="126" width="308" height="96" rx="10" fill="#0a1628" stroke="#f472b6" stroke-width="1.2"/>
  <text x="28" y="148" fill="#f472b6" font-size="11" font-weight="700" font-family="{_FONT}">
    Group (code C)
  </text>
  <line x1="28" y1="172" x2="312" y2="172" stroke="#64748b" stroke-width="1" stroke-dasharray="5,4"/>
  <path d="M 28 182 Q 96 200 164 182 T 300 182" fill="none" stroke="#f472b6" stroke-width="2.4"/>
  <text x="28" y="206" fill="{_WHITE}" font-size="10" font-family="{_FONT}">
    Longer apparent range (group delay)
  </text>

  {_footer("eta_p = 1 - 40.3*Ne/f^2  |  eta_g = 1 + 40.3*Ne/f^2")}
"""
    ),
)

# ── Step 3 ────────────────────────────────────────────────────────────────────
def _step3_svg() -> str:
    g = _earth_scene(ox=112, oy=192, re=54, shell_r=84)
    return _canvas(
        f"""
  <text x="16" y="24" fill="{_WHITE}" font-size="10" font-family="{_FONT}">
    Higher f -&gt; smaller delay (dispersive medium)
  </text>
  {_earth_disk(g, label="")}
  {_iono_arc(g)}
  {_station_marker(g, "Rx")}
  {_satellite_marker(g, "Sat")}
  <line x1="{g['sat_x']:.1f}" y1="{g['sat_y']:.1f}" x2="{g['sx']:.1f}" y2="{g['sy']:.1f}"
        stroke="#e2e8f0" stroke-width="2.2"/>
  <line x1="{g['sat_x'] - 10:.1f}" y1="{g['sat_y'] + 8:.1f}" x2="{g['sx'] - 10:.1f}" y2="{g['sy'] + 8:.1f}"
        stroke="#a78bfa" stroke-width="10" stroke-linecap="round" opacity="0.35"/>
  <rect x="138" y="48" width="162" height="24" rx="5" fill="rgba(10,22,40,0.95)" stroke="#1e3a5f"/>
  <text x="219" y="64" text-anchor="middle" fill="{_WHITE}" font-size="11" font-weight="700"
        font-family="{_FONT}">STEC = integral Ne dl</text>
  <rect x="248" y="138" width="48" height="48" fill="none" stroke="#a78bfa"
        stroke-width="1.4" stroke-dasharray="4,3"/>
  <text x="272" y="166" text-anchor="middle" fill="{_WHITE}" font-size="11"
        font-family="{_FONT}">1 m2</text>
  {_footer("delay = 40.3 * STEC / f^2")}
"""
    )


_register(
    "3",
    "STEC integrates electron density along the slant path through a 1 m2 column.",
    _step3_svg(),
)

# ── Step 4 ────────────────────────────────────────────────────────────────────
_register(
    "4",
    "Subtracting L2 - L1 cancels geometry, clocks, and troposphere — only ionosphere remains.",
    _canvas(
        f"""
  <text x="20" y="32" fill="#f472b6" font-size="11" font-weight="700" font-family="{_FONT}">
    L1 pseudorange C1
  </text>
  <rect x="20" y="40" width="240" height="24" rx="5" fill="#334155"/>
  <rect x="20" y="40" width="168" height="24" rx="5" fill="#1e3a5f"/>
  <rect x="188" y="40" width="72" height="24" rx="5" fill="#f472b6" opacity="0.9"/>
  <text x="268" y="56" fill="{_WHITE}" font-size="10" font-family="{_FONT}">C1</text>

  <text x="20" y="88" fill="#00d4ff" font-size="11" font-weight="700" font-family="{_FONT}">
    L2 pseudorange C2
  </text>
  <rect x="20" y="96" width="240" height="24" rx="5" fill="#334155"/>
  <rect x="20" y="96" width="168" height="24" rx="5" fill="#1e3a5f"/>
  <rect x="188" y="96" width="92" height="24" rx="5" fill="#00d4ff" opacity="0.9"/>
  <text x="268" y="112" fill="{_WHITE}" font-size="10" font-family="{_FONT}">C2</text>

  <text x="20" y="142" fill="{_WHITE}" font-size="10" font-family="{_FONT}">
    Grey = common terms (geometry, clocks, troposphere)
  </text>
  <text x="20" y="160" fill="#fbbf24" font-size="10" font-family="{_FONT}">
    Colour = dispersive ionospheric delay (different on L1 vs L2)
  </text>

  <rect x="20" y="178" width="300" height="62" rx="10" fill="#0a1628" stroke="#00ff88" stroke-width="1.3"/>
  <text x="170" y="206" text-anchor="middle" fill="#00ff88" font-size="14" font-weight="700"
        font-family="{_FONT}">C2 - C1  -&gt;  TEC_G</text>
  <text x="170" y="228" text-anchor="middle" fill="{_WHITE}" font-size="10" font-family="{_FONT}">
    Noisy (~1-3 TECU) but absolute
  </text>
  {_footer("Non-dispersive errors cancel in the difference")}
"""
    ),
)

# ── Step 4b ───────────────────────────────────────────────────────────────────
_register(
    "4b",
    "Phase TEC tracks changes precisely but has an unknown integer-cycle offset.",
    _canvas(
        f"""
  {_chart_grid()}
  {_chart_axes("TEC", "Time (satellite arc)")}
  <path d="M 64 148 Q 124 138 184 128 T 308 118" fill="none" stroke="#f59e0b" stroke-width="2.6"/>
  <text x="314" y="120" fill="#f59e0b" font-size="10" font-weight="700" font-family="{_FONT}">P</text>
  <path d="M 64 118 Q 124 124 184 132 T 308 142" fill="none" stroke="#f472b6"
        stroke-width="2" stroke-dasharray="5,4"/>
  <text x="314" y="144" fill="#f472b6" font-size="10" font-weight="700" font-family="{_FONT}">G</text>
  <line x1="64" y1="118" x2="64" y2="148" stroke="#00d4ff" stroke-width="2" stroke-dasharray="4,3"/>
  <rect x="10" y="124" width="46" height="20" rx="4" fill="rgba(10,22,40,0.95)" stroke="#00d4ff"/>
  <text x="33" y="138" text-anchor="middle" fill="#00d4ff" font-size="9" font-weight="700"
        font-family="{_FONT}">offset</text>
  {_legend_row(188, "#f59e0b", "TEC_P — precise (~0.003 TECU)")}
  {_legend_row(206, "#f472b6", "TEC_G — absolute but noisy")}
  {_footer("Levelling (Step 6) removes the unknown offset")}
"""
    ),
)

# ── Step 5 ────────────────────────────────────────────────────────────────────
_register(
    "5",
    "A cycle slip is a sudden jump; detected when change exceeds recent variability.",
    _canvas(
        f"""
  {_chart_grid()}
  {_chart_axes("TEC_P", "Epoch")}
  <path d="M 64 138 L 124 130 L 184 124 L 204 124" fill="none" stroke="#00d4ff" stroke-width="2.6"/>
  <path d="M 204 94 L 224 94 L 284 88 L 308 88" fill="none" stroke="#00d4ff" stroke-width="2.6"/>
  <line x1="204" y1="94" x2="204" y2="124" stroke="#ef4444" stroke-width="2.6"/>
  <circle cx="204" cy="109" r="8" fill="none" stroke="#ef4444" stroke-width="2"/>
  <text x="216" y="106" fill="#ef4444" font-size="11" font-weight="700" font-family="{_FONT}">slip</text>
  <path d="M 204 124 L 224 124 L 284 118 L 308 118" fill="none" stroke="#00ff88"
        stroke-width="2.2" stroke-dasharray="6,4"/>
  {_legend_row(188, "#ef4444", "Sudden jump flagged as slip")}
  {_legend_row(206, "#00ff88", "Corrected arc continues smoothly")}
  {_footer("Flagged when |change| &gt; std of last 10 samples")}
"""
    ),
)

# ── Step 6 ────────────────────────────────────────────────────────────────────
_register(
    "6",
    "Levelling shifts precise phase TEC to the absolute level of code TEC.",
    _canvas(
        f"""
  {_chart_grid()}
  {_chart_axes("TEC", "Time along satellite arc")}
  <path d="M 64 148 Q 124 142 184 136 T 308 130" fill="none" stroke="#f472b6"
        stroke-width="2" opacity="0.9"/>
  <path d="M 64 128 Q 124 122 184 116 T 308 110" fill="none" stroke="#f59e0b" stroke-width="2.6"/>
  <path d="M 64 108 Q 124 102 184 96 T 308 90" fill="none" stroke="#00ff88" stroke-width="3"/>
  <line x1="88" y1="128" x2="88" y2="108" stroke="#00d4ff" stroke-width="2"/>
  <rect x="92" y="112" width="44" height="18" rx="4" fill="rgba(10,22,40,0.95)" stroke="#00d4ff"/>
  <text x="114" y="124" text-anchor="middle" fill="#00d4ff" font-size="9" font-weight="700"
        font-family="{_FONT}">offset</text>
  {_legend_row(188, "#f472b6", "TEC_G (noisy)")}
  {_legend_row(206, "#f59e0b", "TEC_P (precise)")}
  {_legend_row(224, "#00ff88", "TEC_R = TEC_P + mean(G-P)")}
  {_footer("Uses arc with elevation &gt; 20 deg")}
"""
    ),
)

# ── Step 7 ────────────────────────────────────────────────────────────────────
_register(
    "7",
    "Satellite and receiver hardware add fixed DCB offsets that must be removed.",
    _canvas(
        _arrow_defs("s7-arr")
        + f"""
  <circle cx="170" cy="148" r="42" fill="#0a1e38" stroke="#334155" stroke-width="1.4"/>
  <text x="170" y="152" text-anchor="middle" fill="{_WHITE}" font-size="9"
        font-family="{_FONT}">Signal path</text>

  <rect x="214" y="22" width="104" height="52" rx="9" fill="#1e3a5f" stroke="#00d4ff" stroke-width="1.4"/>
  <text x="266" y="44" text-anchor="middle" fill="{_WHITE}" font-size="11" font-weight="700"
        font-family="{_FONT}">Satellite</text>
  <text x="266" y="62" text-anchor="middle" fill="#ef4444" font-size="10" font-family="{_FONT}">
    DCB_S (from CODE)
  </text>

  <rect x="22" y="196" width="104" height="52" rx="9" fill="#1e3a5f" stroke="#00ff88" stroke-width="1.4"/>
  <text x="74" y="218" text-anchor="middle" fill="{_WHITE}" font-size="11" font-weight="700"
        font-family="{_FONT}">Receiver</text>
  <text x="74" y="236" text-anchor="middle" fill="#ef4444" font-size="10" font-family="{_FONT}">
    DCB_R (estimated)
  </text>

  <line x1="266" y1="74" x2="74" y2="196" stroke="#e2e8f0" stroke-width="2.2"
        marker-end="url(#s7-arr)"/>
  <rect x="142" y="108" width="76" height="30" rx="6" fill="rgba(239,68,68,0.22)" stroke="#ef4444"/>
  <text x="180" y="128" text-anchor="middle" fill="#ef4444" font-size="11" font-weight="700"
        font-family="{_FONT}">+ bias</text>
  {_footer("1 ns bias ~ 2.85 TECU error")}
"""
    ),
)

# ── Step 8 ────────────────────────────────────────────────────────────────────
_g8 = _earth_scene(ox=108, oy=198, re=58, shell_r=92, station_angle=228, sat_angle=318, sat_dist=1.46)
_register(
    "8",
    "The mapping function S(E) converts oblique slant TEC to equivalent vertical TEC.",
    _canvas(
        _arrow_defs("s8-arr", "#f59e0b")
        + _earth_disk(_g8, label="")
        + _iono_arc(_g8)
        + _station_marker(_g8, "CORS")
        + _satellite_marker(_g8, "Sat")
        + f"""
  <line x1="{_g8['sat_x']:.1f}" y1="{_g8['sat_y']:.1f}"
        x2="{_g8['sx']:.1f}" y2="{_g8['sy']:.1f}"
        stroke="#f59e0b" stroke-width="2.4" marker-end="url(#s8-arr)"/>
  <line x1="{_g8['sx']:.1f}" y1="{_g8['sy']:.1f}"
        x2="{_g8['sx']:.1f}" y2="{_g8['oy'] - _g8['shell_r'] * 0.76:.1f}"
        stroke="#00ff88" stroke-width="2.2" stroke-dasharray="5,4"/>
  <path d="M {_g8['sx']:.1f} {_g8['sy'] - 24:.1f}
           A 24 24 0 0 1 {_g8['sx'] + 20:.1f} {_g8['sy'] - 14:.1f}"
        fill="none" stroke="#fbbf24" stroke-width="1.6"/>
  <text x="{_g8['sx'] + 22:.1f}" y="{_g8['sy'] - 20:.1f}"
        fill="#fbbf24" font-size="12" font-style="italic" font-family="{_FONT}">E</text>
  <text x="{_g8['shell_x'] - 48:.1f}" y="{_g8['shell_y'] - 8:.1f}"
        fill="#00d4ff" font-size="9" font-family="{_FONT}">H_IPP ~ 350 km</text>
  <text x="{(_g8['sx'] + _g8['sat_x']) / 2 - 36:.1f}"
        y="{(_g8['sy'] + _g8['sat_y']) / 2 - 12:.1f}"
        fill="#f59e0b" font-size="9.5" font-weight="700" font-family="{_FONT}">Slant (STEC)</text>
  <text x="{_g8['sx'] + 8:.1f}" y="{_g8['sy'] - 58:.1f}"
        fill="#00ff88" font-size="9.5" font-weight="700" font-family="{_FONT}">Vertical (VTEC)</text>
  <rect x="196" y="148" width="138" height="108" rx="9" fill="#0a1628" stroke="#f59e0b" stroke-width="1.2"/>
  <text x="208" y="168" fill="{_WHITE}" font-size="9.5" font-weight="700" font-family="{_FONT}">
    Low E -&gt; longer slant path
  </text>
  <line x1="208" y1="174" x2="326" y2="174" stroke="#334155" stroke-width="0.8"/>
  <text x="208" y="192" fill="{_WHITE}" font-size="9" font-family="{_FONT}">S(E) &gt;= 1 ;  S(90 deg) = 1</text>
  <text x="208" y="210" fill="{_WHITE}" font-size="9" font-family="{_FONT}">E = 20 deg -&gt; S ~ 2.8</text>
  <text x="208" y="228" fill="{_WHITE}" font-size="9" font-family="{_FONT}">E = 90 deg -&gt; S = 1</text>
  <text x="208" y="248" fill="#00ff88" font-size="9.5" font-weight="700" font-family="{_FONT}">
    VTEC = STEC / S(E)
  </text>
""",
        width=340,
        height=280,
    ),
)

# ── Step 9 ────────────────────────────────────────────────────────────────────
_register(
    "9",
    "VTEC is bias-corrected slant TEC, scaled to the vertical at the pierce point.",
    _canvas(
        f"""
  <rect x="118" y="28" width="104" height="36" rx="8" fill="#1e3a5f" stroke="#f59e0b" stroke-width="1.4"/>
  <text x="170" y="52" text-anchor="middle" fill="#f59e0b" font-size="12" font-weight="700"
        font-family="{_FONT}">TEC_R</text>

  <text x="170" y="82" text-anchor="middle" fill="{_WHITE}" font-size="20" font-family="{_FONT}">-</text>

  <rect x="128" y="90" width="84" height="36" rx="8" fill="#1e3a5f" stroke="#ef4444" stroke-width="1.4"/>
  <text x="170" y="114" text-anchor="middle" fill="#ef4444" font-size="12" font-weight="700"
        font-family="{_FONT}">DCB</text>

  <text x="170" y="144" text-anchor="middle" fill="{_WHITE}" font-size="20" font-family="{_FONT}">/</text>

  <rect x="128" y="152" width="84" height="36" rx="8" fill="#1e3a5f" stroke="#00d4ff" stroke-width="1.4"/>
  <text x="170" y="176" text-anchor="middle" fill="#00d4ff" font-size="12" font-weight="700"
        font-family="{_FONT}">S(E)</text>

  <line x1="108" y1="196" x2="232" y2="196" stroke="#64748b" stroke-width="1.2"/>

  <rect x="118" y="206" width="104" height="44" rx="9" fill="rgba(0,255,136,0.12)"
        stroke="#00ff88" stroke-width="1.6"/>
  <text x="170" y="234" text-anchor="middle" fill="#00ff88" font-size="15" font-weight="700"
        font-family="{_FONT}">VTEC</text>

  <circle cx="268" cy="230" r="6" fill="#ff8c00"/>
  <text x="282" y="234" fill="#ff8c00" font-size="10" font-family="{_FONT}">at IPP</text>
  {_footer("Eq. 4.16 — central ZGIIS ionospheric product")}
"""
    ),
)

# ── Pipeline overview ─────────────────────────────────────────────────────────
_register(
    "pipeline",
    "Full GPS_TEC v3.5 pipeline: RINEX in, geo-located VTEC maps out.",
    _canvas(
        _arrow_defs("pipe-arr", "#64748b")
        + f"""
  <rect x="96" y="10" width="148" height="30" rx="8" fill="#0d1b2a" stroke="#64748b"/>
  <text x="170" y="30" text-anchor="middle" fill="{_WHITE}" font-size="11" font-family="{_FONT}">
    RINEX C1,C2,L1,L2
  </text>
  <line x1="170" y1="40" x2="170" y2="50" stroke="#64748b" stroke-width="1.5" marker-end="url(#pipe-arr)"/>

  <rect x="96" y="50" width="148" height="30" rx="8" fill="#0d1b2a" stroke="#f59e0b"/>
  <text x="170" y="70" text-anchor="middle" fill="#f59e0b" font-size="11" font-family="{_FONT}">
    TEC_G and TEC_P
  </text>
  <line x1="170" y1="80" x2="170" y2="90" stroke="#64748b" stroke-width="1.5" marker-end="url(#pipe-arr)"/>

  <rect x="96" y="90" width="148" height="30" rx="8" fill="#0d1b2a" stroke="#00d4ff"/>
  <text x="170" y="110" text-anchor="middle" fill="#00d4ff" font-size="11" font-family="{_FONT}">
    Slip fix + levelling
  </text>
  <line x1="170" y1="120" x2="170" y2="130" stroke="#64748b" stroke-width="1.5" marker-end="url(#pipe-arr)"/>

  <rect x="96" y="130" width="148" height="30" rx="8" fill="#0d1b2a" stroke="#00ff88"/>
  <text x="170" y="150" text-anchor="middle" fill="#00ff88" font-size="11" font-weight="700"
        font-family="{_FONT}">TEC_R</text>
  <line x1="170" y1="160" x2="170" y2="170" stroke="#64748b" stroke-width="1.5" marker-end="url(#pipe-arr)"/>

  <rect x="78" y="170" width="72" height="28" rx="8" fill="#0d1b2a" stroke="#ef4444"/>
  <text x="114" y="189" text-anchor="middle" fill="#ef4444" font-size="10" font-family="{_FONT}">DCB</text>
  <rect x="190" y="170" width="72" height="28" rx="8" fill="#0d1b2a" stroke="#f59e0b"/>
  <text x="226" y="189" text-anchor="middle" fill="#f59e0b" font-size="10" font-family="{_FONT}">S(E)</text>
  <line x1="170" y1="198" x2="170" y2="208" stroke="#64748b" stroke-width="1.5" marker-end="url(#pipe-arr)"/>

  <rect x="82" y="208" width="176" height="38" rx="9" fill="rgba(0,255,136,0.1)" stroke="#00ff88" stroke-width="1.5"/>
  <text x="170" y="232" text-anchor="middle" fill="#00ff88" font-size="12" font-weight="700"
        font-family="{_FONT}">VTEC @ IPP -&gt; ZGIIS Maps</text>
""",
        css_class="vtec-illus-svg vtec-pipeline-svg",
    ),
)
