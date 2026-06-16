"""IPP geometry diagram — matches Chapter 4 reference (Singh & Tiwari 2022)."""

from __future__ import annotations

import base64
import math

_FONT = "Arial,Helvetica,sans-serif"
_BG = "#000000"
_W = 520
_H = 400


def _pol(ox: float, oy: float, r: float, deg: float) -> tuple[float, float]:
    """Math angle (deg, 0=right, CCW positive) → SVG x,y."""
    a = math.radians(deg)
    return ox + r * math.cos(a), oy - r * math.sin(a)


def _mid(x1: float, y1: float, x2: float, y2: float) -> tuple[float, float]:
    return (x1 + x2) / 2, (y1 + y2) / 2


def _label_bg(x: float, y: float, w: float, h: float = 18.0) -> str:
    return (
        f'<rect x="{x - 5:.1f}" y="{y - 14:.1f}" width="{w:.1f}" height="{h:.1f}" '
        f'rx="4" fill="{_BG}" opacity="0.94"/>'
    )


def _callout(
    ax: float,
    ay: float,
    lx: float,
    ly: float,
    text: str,
    *,
    color: str = "#ffffff",
    italic: bool = False,
    bold: bool = False,
    font_size: int = 12,
    anchor: str = "middle",
) -> str:
    """Leader line from anchor point to offset label with background."""
    tw = max(len(text) * 7.2, 28)
    if anchor == "start":
        bg_x, tx = lx - 4, lx
    elif anchor == "end":
        bg_x, tx = lx - tw + 4, lx
    else:
        bg_x, tx = lx - tw / 2, lx
    style = "italic" if italic else "normal"
    weight = "bold" if bold else "normal"
    return f"""
  <line x1="{ax:.1f}" y1="{ay:.1f}" x2="{lx:.1f}" y2="{ly:.1f}"
        stroke="{color}" stroke-width="1" opacity="0.55"/>
  {_label_bg(bg_x, ly, tw)}
  <text x="{tx:.1f}" y="{ly:.1f}" text-anchor="{anchor}" fill="{color}" font-size="{font_size}"
        font-style="{style}" font-weight="{weight}" font-family="{_FONT}">{text}</text>"""


def _deg_at(x: float, y: float, ox: float, oy: float) -> float:
    """Math angle (deg) from origin to point in SVG coordinates."""
    return math.degrees(math.atan2(-(y - oy), x - ox))


def _ipp_svg() -> str:
    """Textbook pierce-point geometry — spaced labels, E and psi_pp arcs."""
    ox, oy = 228.0, 292.0
    re = 76.0
    rs = 114.0
    sat_r = 176.0

    st_deg, ipp_deg, sat_deg = 162.0, 20.0, 30.0

    sx, sy = _pol(ox, oy, re, st_deg)
    ix, iy = _pol(ox, oy, rs, ipp_deg)
    satx, saty = _pol(ox, oy, sat_r, sat_deg)

    shell_lx, shell_ly = _pol(ox, oy, rs, 150.0)
    shell_rx, shell_ry = _pol(ox, oy, rs, 8.0)

    slant_mx, slant_my = _mid(satx, saty, ix, iy)
    rp_mx, rp_my = _mid(ox, oy, ix, iy)
    rs_mx, rs_my = _mid(ox, oy, satx, saty)

    # Elevation E: arc from local horizontal (left) to station→satellite ray
    horiz_deg = 180.0
    ray_deg = _deg_at(satx, saty, sx, sy)
    e_r = 26.0
    e1x, e1y = _pol(sx, sy, e_r, horiz_deg)
    e2x, e2y = _pol(sx, sy, e_r, ray_deg)
    e_mid = (horiz_deg + ray_deg) / 2 if ray_deg < horiz_deg else (horiz_deg + ray_deg + 360) / 2
    elx, ely = _pol(sx, sy, e_r + 16, e_mid)

    # psi_pp: small arc at geocenter between station and IPP radials
    pp_r = re * 0.48
    p1x, p1y = _pol(ox, oy, pp_r, st_deg)
    p2x, p2y = _pol(ox, oy, pp_r, ipp_deg)
    pmx, pmy = _pol(ox, oy, pp_r + 16, (st_deg + ipp_deg) / 2)

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {_W} {_H}" width="{_W}" height="{_H}">
  <rect width="{_W}" height="{_H}" fill="{_BG}"/>

  <!-- Earth -->
  <circle cx="{ox}" cy="{oy}" r="{re}" fill="#0a1e38" stroke="#e2e8f0" stroke-width="2"/>
  {_label_bg(ox - 34, oy + 10, 68)}
  <text x="{ox}" y="{oy + 10}" text-anchor="middle" fill="#ffffff" font-size="12"
        font-family="{_FONT}">Geocenter</text>

  <!-- Ionospheric shell -->
  <path d="M {shell_lx:.1f} {shell_ly:.1f} A {rs} {rs} 0 0 1 {shell_rx:.1f} {shell_ry:.1f}"
        fill="none" stroke="#168bd2" stroke-width="1.8" stroke-dasharray="8,5"/>
  {_label_bg(ox + rs - 18, 36, 132)}
  <text x="{ox + rs + 48}" y="36" text-anchor="middle" fill="#168bd2" font-size="12" font-weight="bold"
        font-family="{_FONT}">Ionospheric layer</text>

  <!-- Local vertical extension at IPP (for angle z) -->
  <line x1="{ix}" y1="{iy}" x2="{ix + 30:.1f}" y2="{iy - 58:.1f}"
        stroke="#64748b" stroke-width="1.2" stroke-dasharray="5,4"/>

  <!-- |r_p| radial -->
  <line x1="{ox}" y1="{oy}" x2="{ix}" y2="{iy}" stroke="#f8fafc" stroke-width="2.4"/>
  <polygon points="{ix - 5:.1f},{iy + 7:.1f} {ix + 9:.1f},{iy - 1:.1f} {ix - 2:.1f},{iy - 9:.1f}"
           fill="#ffffff"/>
  {_callout(rp_mx, rp_my, 168, 210, "|r_p|", color="#ffffff", italic=True)}

  <!-- |r_s| radial -->
  <line x1="{ox}" y1="{oy}" x2="{satx}" y2="{saty}" stroke="#f8fafc" stroke-width="2.4"/>
  <polygon points="{satx - 9:.1f},{saty + 5:.1f} {satx + 3:.1f},{saty - 1:.1f} {satx - 3:.1f},{saty - 9:.1f}"
           fill="#ffffff"/>
  {_callout(rs_mx, rs_my, 392, 118, "|r_s|", color="#ffffff", italic=True, anchor="middle")}

  <!-- GNSS signal path -->
  <line x1="{satx}" y1="{saty}" x2="{ix}" y2="{iy}" stroke="#e2e8f0" stroke-width="2.4"/>
  <line x1="{ix}" y1="{iy}" x2="{sx}" y2="{sy}" stroke="#e2e8f0" stroke-width="2.4"/>
  <polygon points="{sx + 6:.1f},{sy - 4:.1f} {sx - 2:.1f},{sy - 10:.1f} {sx - 6:.1f},{sy - 2:.1f}"
           fill="#e2e8f0"/>
  {_callout(slant_mx, slant_my, 418, 72, "|r_s − r_p|", color="#ffffff", italic=True, font_size=11, anchor="end")}

  <!-- Pierce point -->
  <circle cx="{ix}" cy="{iy}" r="7.5" fill="#ff8c00" stroke="#ffffff" stroke-width="1.2"/>
  {_callout(ix, iy, ix + 18, iy + 44, "Pierce point", color="#ff8c00", bold=True, anchor="start")}

  <!-- Permanent station -->
  <polygon points="{sx:.1f},{sy:.1f} {sx + 9:.1f},{sy + 14:.1f} {sx - 9:.1f},{sy + 14:.1f}"
           fill="#00ff88"/>
  {_callout(sx, sy, sx - 18, sy + 38, "Permanent station", color="#00ff88", bold=True, font_size=11, anchor="middle")}

  <!-- Satellite -->
  <circle cx="{satx}" cy="{saty}" r="9" fill="#244d73" stroke="#168bd2" stroke-width="1.8"/>
  <line x1="{satx - 22}" y1="{saty}" x2="{satx - 36}" y2="{saty}" stroke="#168bd2" stroke-width="2"/>
  <line x1="{satx + 22}" y1="{saty}" x2="{satx + 36}" y2="{saty}" stroke="#168bd2" stroke-width="2"/>
  {_callout(satx, saty, satx + 14, saty - 34, "Satellite", color="#ffffff", anchor="start")}

  <!-- Angle z (zenith at IPP) -->
  <path d="M {ix} {iy} L {ix + 26} {iy - 16} A 22 22 0 0 0 {ix + 14} {iy - 38}"
        fill="none" stroke="#fbbf24" stroke-width="1.8"/>
  {_label_bg(ix + 40, iy - 18, 16)}
  <text x="{ix + 48}" y="{iy - 4}" fill="#fbbf24" font-size="14" font-style="italic"
        font-family="{_FONT}">z</text>

  <!-- Angle a at IPP -->
  <path d="M {ix} {iy} L {ix - 28} {iy + 14} A 24 24 0 0 1 {ix - 44} {iy + 36}"
        fill="none" stroke="#f472b6" stroke-width="1.8"/>
  {_label_bg(ix - 54, iy + 24, 16)}
  <text x="{ix - 46}" y="{iy + 38}" fill="#f472b6" font-size="14" font-style="italic"
        font-family="{_FONT}">a</text>

  <!-- Elevation E at receiver -->
  <line x1="{e1x:.1f}" y1="{e1y:.1f}" x2="{sx:.1f}" y2="{sy:.1f}"
        stroke="#38bdf8" stroke-width="1.5" stroke-dasharray="4,3"/>
  <line x1="{sx:.1f}" y1="{sy:.1f}" x2="{e2x:.1f}" y2="{e2y:.1f}"
        stroke="#38bdf8" stroke-width="1.5"/>
  <path d="M {e1x:.1f} {e1y:.1f} A {e_r} {e_r} 0 0 1 {e2x:.1f} {e2y:.1f}"
        fill="none" stroke="#38bdf8" stroke-width="1.8"/>
  {_label_bg(elx - 8, ely - 4, 14)}
  <text x="{elx:.1f}" y="{ely:.1f}" fill="#38bdf8" font-size="14" font-style="italic"
        font-weight="700" font-family="{_FONT}">E</text>

  <!-- Earth-centre angle psi_pp -->
  <line x1="{ox}" y1="{oy}" x2="{p1x:.1f}" y2="{p1y:.1f}" stroke="#a78bfa" stroke-width="1.2" opacity="0.35"/>
  <line x1="{ox}" y1="{oy}" x2="{p2x:.1f}" y2="{p2y:.1f}" stroke="#a78bfa" stroke-width="1.2" opacity="0.35"/>
  <path d="M {p1x:.1f} {p1y:.1f} A {pp_r} {pp_r} 0 0 0 {p2x:.1f} {p2y:.1f}"
        fill="none" stroke="#a78bfa" stroke-width="1.8"/>
  {_label_bg(pmx - 22, pmy - 6, 44)}
  <text x="{pmx:.1f}" y="{pmy + 4}" text-anchor="middle" fill="#a78bfa" font-size="12"
        font-style="italic" font-weight="700" font-family="{_FONT}">ψ_pp</text>

  <!-- Shell height hint -->
  {_label_bg(ox + re + 6, oy - 10, 76)}
  <text x="{ox + re + 44}" y="{oy + 4}" text-anchor="middle" fill="#64748b" font-size="9"
        font-family="{_FONT}">H_IPP ~ 350 km</text>
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
      <td class="sym"><span class="line" style="background:#e2e8f0"></span>|r_s − r_p|</td>
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
      <td class="sym"><span class="line" style="background:#38bdf8"></span>E</td>
      <td>Elevation angle at the receiver</td>
    </tr>
    <tr>
      <td class="sym"><span class="line" style="background:#a78bfa"></span>ψ_pp</td>
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
    margin: 0; padding: 10px 8px; background: {_BG};
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
    border: 1px solid #244d73; border-radius: 12px;
    box-sizing: border-box; min-height: 390px;
  }}
  svg {{ max-width: 100%; height: auto; display: block; }}
</style></head>
<body>{svg}</body></html>""",
        height=408,
        scrolling=False,
    )
