"""IPP geometry diagram — matches Chapter 4 reference (Singh & Tiwari 2022)."""

from __future__ import annotations

import base64
import math

_FONT = "Arial,Helvetica,sans-serif"
_BG = "#060d1a"


def _pol(ox: float, oy: float, r: float, deg: float) -> tuple[float, float]:
    """Math angle (deg, 0=right, CCW positive) → SVG x,y."""
    a = math.radians(deg)
    return ox + r * math.cos(a), oy - r * math.sin(a)


def _label_bg(x: float, y: float, w: float, h: float) -> str:
    return (
        f'<rect x="{x - 4:.1f}" y="{y - 13:.1f}" width="{w:.1f}" height="{h:.1f}" '
        f'rx="4" fill="{_BG}" opacity="0.92"/>'
    )


def _ipp_svg() -> str:
    """Textbook pierce-point geometry on dark background."""
    ox, oy = 168.0, 228.0
    re = 66.0
    rs = 98.0
    sat_r = 154.0

    sx, sy = _pol(ox, oy, re, 158)
    ix, iy = _pol(ox, oy, rs, 26)
    satx, saty = _pol(ox, oy, sat_r, 34)

    shell_lx, shell_ly = _pol(ox, oy, rs, 156)
    shell_rx, shell_ry = _pol(ox, oy, rs, 20)

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 340" width="480" height="340">
  <rect width="480" height="340" fill="{_BG}"/>

  <!-- Earth -->
  <circle cx="{ox}" cy="{oy}" r="{re}" fill="#0a1e38" stroke="#e2e8f0" stroke-width="2"/>
  {_label_bg(ox - 30, oy + 6, 60, 18)}
  <text x="{ox}" y="{oy + 6}" text-anchor="middle" fill="#ffffff" font-size="12"
        font-family="{_FONT}">Geocenter</text>

  <!-- Ionospheric shell -->
  <path d="M {shell_lx:.1f} {shell_ly:.1f} A {rs} {rs} 0 0 1 {shell_rx:.1f} {shell_ry:.1f}"
        fill="none" stroke="#00d4ff" stroke-width="1.6" stroke-dasharray="7,5"/>
  {_label_bg(286, 54, 124, 18)}
  <text x="348" y="54" text-anchor="middle" fill="#00d4ff" font-size="12" font-weight="bold"
        font-family="{_FONT}">Ionospheric layer</text>

  <!-- Radial through pierce point -->
  <line x1="{ox}" y1="{oy}" x2="{ix}" y2="{iy}" stroke="#64748b" stroke-width="1.2"
        stroke-dasharray="5,4"/>
  <line x1="{ix}" y1="{iy}" x2="{ix + 24:.1f}" y2="{iy - 48:.1f}"
        stroke="#64748b" stroke-width="1.2" stroke-dasharray="5,4"/>

  <!-- |r_p| -->
  <line x1="{ox}" y1="{oy}" x2="{ix}" y2="{iy}" stroke="#f8fafc" stroke-width="2.2"/>
  <polygon points="{ix - 5:.1f},{iy + 7:.1f} {ix + 9:.1f},{iy - 1:.1f} {ix - 2:.1f},{iy - 9:.1f}"
           fill="#ffffff"/>
  {_label_bg(198, 176, 40, 18)}
  <text x="218" y="176" text-anchor="middle" fill="#ffffff" font-size="12" font-style="italic"
        font-family="{_FONT}">|r_p|</text>

  <!-- |r_s| -->
  <line x1="{ox}" y1="{oy}" x2="{satx}" y2="{saty}" stroke="#f8fafc" stroke-width="2.2"/>
  <polygon points="{satx - 9:.1f},{saty + 5:.1f} {satx + 3:.1f},{saty - 1:.1f} {satx - 3:.1f},{saty - 9:.1f}"
           fill="#ffffff"/>
  {_label_bg(262, 122, 40, 18)}
  <text x="282" y="122" text-anchor="middle" fill="#ffffff" font-size="12" font-style="italic"
        font-family="{_FONT}">|r_s|</text>

  <!-- Signal path -->
  <line x1="{satx}" y1="{saty}" x2="{ix}" y2="{iy}" stroke="#e2e8f0" stroke-width="2.2"/>
  <line x1="{ix}" y1="{iy}" x2="{sx}" y2="{sy}" stroke="#e2e8f0" stroke-width="2.2"/>
  <polygon points="{sx + 6:.1f},{sy - 4:.1f} {sx - 2:.1f},{sy - 10:.1f} {sx - 6:.1f},{sy - 2:.1f}"
           fill="#e2e8f0"/>
  {_label_bg(312, 86, 78, 18)}
  <text x="351" y="86" text-anchor="middle" fill="#ffffff" font-size="11" font-style="italic"
        font-family="{_FONT}">|r_s - r_p|</text>

  <!-- Pierce point -->
  <circle cx="{ix}" cy="{iy}" r="7" fill="#ff8c00" stroke="#ffffff" stroke-width="1"/>
  {_label_bg(ix + 48, iy - 10, 96, 18)}
  <text x="{ix + 96}" y="{iy - 2}" text-anchor="middle" fill="#ff8c00" font-size="12"
        font-weight="bold" font-family="{_FONT}">Pierce point</text>

  <!-- Permanent station -->
  <polygon points="{sx:.1f},{sy:.1f} {sx + 8:.1f},{sy + 12:.1f} {sx - 8:.1f},{sy + 12:.1f}"
           fill="#00ff88"/>
  {_label_bg(sx - 62, sy - 16, 116, 18)}
  <text x="{sx - 4}" y="{sy - 4}" text-anchor="middle" fill="#00ff88" font-size="11"
        font-weight="bold" font-family="{_FONT}">Permanent station</text>

  <!-- Satellite -->
  <circle cx="{satx}" cy="{saty}" r="9" fill="#1e3a5f" stroke="#00d4ff" stroke-width="1.6"/>
  <line x1="{satx - 20}" y1="{saty}" x2="{satx - 34}" y2="{saty}" stroke="#00d4ff" stroke-width="2"/>
  <line x1="{satx + 20}" y1="{saty}" x2="{satx + 34}" y2="{saty}" stroke="#00d4ff" stroke-width="2"/>
  {_label_bg(satx + 48, saty + 2, 68, 18)}
  <text x="{satx + 82}" y="{saty + 6}" text-anchor="middle" fill="#ffffff" font-size="12"
        font-family="{_FONT}">Satellite</text>

  <!-- Angles z and alpha at pierce point -->
  <path d="M {ix} {iy} L {ix + 24} {iy - 14} A 20 20 0 0 0 {ix + 12} {iy - 32}"
        fill="none" stroke="#fbbf24" stroke-width="1.6"/>
  {_label_bg(ix + 34, iy - 30, 16, 18)}
  <text x="{ix + 42}" y="{iy - 16}" fill="#fbbf24" font-size="13" font-style="italic"
        font-family="{_FONT}">z</text>

  <path d="M {ix} {iy} L {ix - 24} {iy + 12} A 20 20 0 0 1 {ix - 36} {iy + 30}"
        fill="none" stroke="#f472b6" stroke-width="1.6"/>
  {_label_bg(ix - 52, iy + 20, 20, 18)}
  <text x="{ix - 42}" y="{iy + 34}" fill="#f472b6" font-size="13" font-style="italic"
        font-family="{_FONT}">a</text>
</svg>"""


IPP_LEGEND_HTML = """
<div class="ipp-geom-legend">
  <div class="ipp-geom-legend-title">Diagram symbols</div>
  <table>
    <tr>
      <td class="sym"><span class="line" style="background:#f8fafc"></span>|r_p|</td>
      <td>Radius from geocenter to pierce point</td>
    </tr>
    <tr>
      <td class="sym"><span class="line" style="background:#f8fafc"></span>|r_s|</td>
      <td>Radius from geocenter to satellite</td>
    </tr>
    <tr>
      <td class="sym"><span class="line" style="background:#e2e8f0"></span>|r_s - r_p|</td>
      <td>Slant path above the ionospheric shell</td>
    </tr>
    <tr>
      <td class="sym"><span class="dot" style="background:#ff8c00"></span>IPP</td>
      <td>Ionospheric pierce point on the thin shell</td>
    </tr>
    <tr>
      <td class="sym"><span class="dot" style="background:#00ff88"></span>Station</td>
      <td>Permanent CORS receiver on Earth's surface</td>
    </tr>
    <tr>
      <td class="sym"><span class="line" style="background:#e2e8f0"></span>Ray</td>
      <td>GNSS signal path (satellite to station)</td>
    </tr>
    <tr>
      <td class="sym"><span class="line" style="background:#fbbf24"></span>z</td>
      <td>Zenith angle at IPP (incoming ray vs radial)</td>
    </tr>
    <tr>
      <td class="sym"><span class="line" style="background:#f472b6"></span>a</td>
      <td>Angle at IPP between radial and station ray</td>
    </tr>
    <tr>
      <td class="sym">E</td>
      <td>Elevation angle at the receiver</td>
    </tr>
    <tr>
      <td class="sym">psi_pp</td>
      <td>Earth-centre angle from station to IPP</td>
    </tr>
    <tr>
      <td class="sym">H_IPP</td>
      <td>Thin-shell height (~350 km)</td>
    </tr>
    <tr>
      <td class="sym">R_E</td>
      <td>Mean Earth radius (~6378 km)</td>
    </tr>
  </table>
</div>
"""


def _embed_svg(svg: str, css_class: str, alt: str) -> str:
    encoded = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    return (
        f'<img class="{css_class}" '
        f'src="data:image/svg+xml;base64,{encoded}" '
        f'alt="{alt}" />'
    )


def render_ipp_diagram_block() -> str:
    img = _embed_svg(_ipp_svg(), "ipp-geom-img", "Ionospheric pierce point geometry")
    return f"<div class='ipp-geom-card'>{img}</div>"


def render_ipp_diagram_streamlit(st) -> None:
    """Render via iframe — bypasses Streamlit HTML/SVG sanitization."""
    import streamlit.components.v1 as components

    svg = _ipp_svg()
    components.html(
        f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<style>
  html, body {{
    margin: 0; padding: 8px 6px; background: {_BG};
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
    border: 1px solid #1e3a5f; border-radius: 12px;
    box-sizing: border-box; min-height: 330px;
  }}
  svg {{ max-width: 100%; height: auto; display: block; }}
</style></head>
<body>{svg}</body></html>""",
        height=348,
        scrolling=False,
    )
