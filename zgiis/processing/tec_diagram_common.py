"""Shared SVG helpers for Understanding TEC and Calculating VTEC illustrations."""

from __future__ import annotations

import math

_FONT = "Arial,Helvetica,sans-serif"
_BG = "#000000"
_WHITE = "#ffffff"
_W = 340
_H = 300


def canvas(
    inner: str,
    *,
    width: int = _W,
    height: int = _H,
    css_class: str = "vtec-illus-svg",
    defs: str = "",
) -> str:
    return (
        f'<svg class="{css_class}" viewBox="0 0 {width} {height}" '
        f'xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">'
        f'<rect width="{width}" height="{height}" fill="{_BG}"/>'
        f"{defs}{inner}</svg>"
    )


def footer(text: str, *, y: float | None = None, width: int = _W, lines: tuple[str, ...] = ()) -> str:
    if lines:
        box_y = (y or _H - 38) - 4
        ty1 = box_y + 13
        ty2 = box_y + 25
        return (
            f'<rect x="24" y="{box_y}" width="{width - 48}" height="32" rx="5" '
            f'fill="#111827" stroke="#244d73"/>'
            f'<text x="{width // 2}" y="{ty1}" text-anchor="middle" fill="{_WHITE}" '
            f'font-size="8" font-family="{_FONT}">{lines[0]}</text>'
            f'<text x="{width // 2}" y="{ty2}" text-anchor="middle" fill="{_WHITE}" '
            f'font-size="8" font-family="{_FONT}">{lines[1] if len(lines) > 1 else ""}</text>'
        )
    ty = (y or _H - 14)
    return (
        f'<text x="{width // 2}" y="{ty}" text-anchor="middle" fill="{_WHITE}" '
        f'font-size="9" font-family="{_FONT}">{text}</text>'
    )


def earth_scene(
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
        "sat_x": sat_x, "sat_y": sat_y, "sat_angle": sat_angle,
    }


def standard_defs(prefix: str = "td") -> str:
    return f"""
  <defs>
    <radialGradient id="{prefix}-earth" cx="35%" cy="32%" r="68%">
      <stop offset="0%" stop-color="#1a5a8a"/>
      <stop offset="55%" stop-color="#0d2847"/>
      <stop offset="100%" stop-color="#061018"/>
    </radialGradient>
    <radialGradient id="{prefix}-iono" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#168bd2" stop-opacity="0.45"/>
      <stop offset="100%" stop-color="#168bd2" stop-opacity="0.08"/>
    </radialGradient>
    <linearGradient id="{prefix}-ray" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#00ff88"/>
      <stop offset="45%" stop-color="#168bd2"/>
      <stop offset="100%" stop-color="#e2e8f0"/>
    </linearGradient>
    <marker id="{prefix}-arr" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#e2e8f0"/>
    </marker>
    <marker id="{prefix}-arr-g" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto">
      <path d="M0,0 L8,4 L0,8 Z" fill="#00ff88"/>
    </marker>
  </defs>"""


def star_field(count: int = 18, seed: int = 7, width: int = _W) -> str:
    parts: list[str] = []
    for i in range(count):
        x = (i * 37 + seed * 11) % (width - 20) + 10
        y = (i * 23 + seed * 5) % 90 + 8
        r = 0.6 + (i % 3) * 0.4
        op = 0.25 + (i % 4) * 0.12
        parts.append(f'<circle cx="{x}" cy="{y}" r="{r:.1f}" fill="#94a3b8" opacity="{op:.2f}"/>')
    return "".join(parts)


def earth_disk(g: dict[str, float], *, label: str = "Earth", grad_id: str = "td-earth") -> str:
    ox, oy, re = g["ox"], g["oy"], g["re"]
    clip_id = f"{grad_id}-globe-clip"
    shade_id = f"{grad_id}-limb-shade"

    # Africa-centred land geometry keeps Zimbabwe's location visually relevant
    # while remaining legible at the small sizes used by the teaching diagrams.
    africa = (
        f"M {ox - re * .16:.1f} {oy - re * .53:.1f} "
        f"C {ox - re * .34:.1f} {oy - re * .42:.1f}, {ox - re * .38:.1f} {oy - re * .18:.1f}, {ox - re * .27:.1f} {oy - re * .03:.1f} "
        f"L {ox - re * .15:.1f} {oy + re * .08:.1f} L {ox - re * .08:.1f} {oy + re * .36:.1f} "
        f"L {ox + re * .08:.1f} {oy + re * .62:.1f} L {ox + re * .24:.1f} {oy + re * .34:.1f} "
        f"L {ox + re * .31:.1f} {oy + re * .04:.1f} L {ox + re * .18:.1f} {oy - re * .11:.1f} "
        f"L {ox + re * .31:.1f} {oy - re * .30:.1f} L {ox + re * .08:.1f} {oy - re * .48:.1f} Z"
    )
    europe_asia = (
        f"M {ox - re * .18:.1f} {oy - re * .56:.1f} "
        f"C {ox + re * .05:.1f} {oy - re * .78:.1f}, {ox + re * .43:.1f} {oy - re * .70:.1f}, {ox + re * .73:.1f} {oy - re * .44:.1f} "
        f"L {ox + re * .48:.1f} {oy - re * .22:.1f} L {ox + re * .25:.1f} {oy - re * .30:.1f} "
        f"L {ox + re * .10:.1f} {oy - re * .48:.1f} Z"
    )
    return f"""
  <defs>
    <clipPath id="{clip_id}"><circle cx="{ox}" cy="{oy}" r="{re}"/></clipPath>
    <radialGradient id="{shade_id}" cx="31%" cy="27%" r="76%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.20"/>
      <stop offset="48%" stop-color="#ffffff" stop-opacity="0.01"/>
      <stop offset="78%" stop-color="#020617" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.82"/>
    </radialGradient>
  </defs>
  <circle cx="{ox}" cy="{oy}" r="{re * 1.045:.1f}" fill="none" stroke="#38bdf8" stroke-width="2.8" opacity="0.26"/>
  <circle cx="{ox}" cy="{oy}" r="{re}" fill="url(#{grad_id})" stroke="#64748b" stroke-width="1.6"/>
  <g clip-path="url(#{clip_id})">
    <path d="{africa}" fill="#4d8b3d" stroke="#7cbf63" stroke-width="0.8"/>
    <path d="{europe_asia}" fill="#527f3d" stroke="#79ad5d" stroke-width="0.7"/>
    <ellipse cx="{ox + re * .35:.1f}" cy="{oy + re * .39:.1f}" rx="{re * .055:.1f}" ry="{re * .16:.1f}"
             transform="rotate(18 {ox + re * .35:.1f} {oy + re * .39:.1f})" fill="#538b43"/>
    <path d="M {ox - re * .55:.1f} {oy - re * .25:.1f} Q {ox - re * .05:.1f} {oy - re * .40:.1f} {ox + re * .50:.1f} {oy - re * .17:.1f}"
          fill="none" stroke="#ffffff" stroke-width="{max(1.2, re * .045):.1f}" stroke-linecap="round" opacity="0.34"/>
    <path d="M {ox - re * .42:.1f} {oy + re * .18:.1f} Q {ox - re * .02:.1f} {oy + re * .02:.1f} {ox + re * .42:.1f} {oy + re * .22:.1f}"
          fill="none" stroke="#e0f2fe" stroke-width="{max(1.0, re * .035):.1f}" stroke-linecap="round" opacity="0.25"/>
    <circle cx="{ox}" cy="{oy}" r="{re}" fill="url(#{shade_id})"/>
  </g>
  <ellipse cx="{ox - re * .28:.1f}" cy="{oy - re * .36:.1f}" rx="{re * .20:.1f}" ry="{re * .11:.1f}"
           fill="#ffffff" opacity="0.13" transform="rotate(-24 {ox - re * .28:.1f} {oy - re * .36:.1f})"/>
  <text x="{ox}" y="{oy + 4}" text-anchor="middle" fill="{_WHITE}" font-size="9"
        font-weight="700" font-family="{_FONT}" paint-order="stroke" stroke="#020617" stroke-width="2">{label}</text>"""


def troposphere_ring(g: dict[str, float]) -> str:
    ox, oy, re = g["ox"], g["oy"], g["re"]
    rt = re * 1.06
    return (
        f'<circle cx="{ox}" cy="{oy}" r="{rt:.1f}" fill="none" stroke="#475569" '
        f'stroke-width="3" opacity="0.35"/>'
    )


def ionosphere_shell(g: dict[str, float], *, grad_id: str = "td-iono", label: str = "Ionosphere ~350 km") -> str:
    ox, oy, re, rs = g["ox"], g["oy"], g["re"], g["shell_r"]
    inner = re * 1.04
    return f"""
  <circle cx="{ox}" cy="{oy}" r="{rs * .91:.1f}" fill="none" stroke="#38bdf8"
          stroke-width="8" opacity="0.045"/>
  <circle cx="{ox}" cy="{oy}" r="{rs:.1f}" fill="url(#{grad_id})" stroke="#168bd2"
          stroke-width="1.2" stroke-dasharray="5,3" opacity="0.85"/>
  <circle cx="{ox}" cy="{oy}" r="{rs * 1.035:.1f}" fill="none" stroke="#38bdf8"
          stroke-width="2.4" opacity="0.10"/>
  <circle cx="{ox}" cy="{oy}" r="{inner:.1f}" fill="{_BG}" opacity="0.0"/>
  <text x="{ox + rs * 0.55:.1f}" y="{oy - rs * 0.72:.1f}" fill="#168bd2" font-size="9"
        font-weight="700" font-family="{_FONT}">{label}</text>"""


def cors_receiver(g: dict[str, float], *, label: str = "CORS", color: str = "#00ff88") -> str:
    sx, sy = g["sx"], g["sy"]
    return f"""
  <ellipse cx="{sx:.1f}" cy="{sy - 12:.1f}" rx="7" ry="3.4" fill="#e2e8f0" stroke="{color}" stroke-width="1"
           transform="rotate(-18 {sx:.1f} {sy - 12:.1f})"/>
  <path d="M {sx - 5.8:.1f} {sy - 13.5:.1f} Q {sx:.1f} {sy - 7.5:.1f} {sx + 5.8:.1f} {sy - 10.5:.1f}"
        fill="none" stroke="#94a3b8" stroke-width="1"/>
  <circle cx="{sx + 2.2:.1f}" cy="{sy - 13.8:.1f}" r="1.5" fill="{color}"/>
  <line x1="{sx:.1f}" y1="{sy - 8:.1f}" x2="{sx:.1f}" y2="{sy + 3:.1f}" stroke="#cbd5e1" stroke-width="1.8"/>
  <polygon points="{sx:.1f},{sy + 1:.1f} {sx + 6:.1f},{sy + 12:.1f} {sx - 6:.1f},{sy + 12:.1f}" fill="{color}" opacity="0.92"/>
  <text x="{sx - 52:.1f}" y="{sy - 2:.1f}" fill="{color}" font-size="9" font-weight="700"
        font-family="{_FONT}">{label}</text>"""


def gps_satellite(g: dict[str, float], *, label: str = "GPS", prefix: str = "td") -> str:
    sx, sy = g["sat_x"], g["sat_y"]
    return f"""
  <g transform="rotate(-12 {sx:.1f} {sy:.1f})">
    <rect x="{sx - 28:.1f}" y="{sy - 5:.1f}" width="17" height="10" rx="1" fill="#0b4f86" stroke="#38bdf8" stroke-width="0.8"/>
    <path d="M {sx - 22.3:.1f} {sy - 5:.1f} V {sy + 5:.1f} M {sx - 16.7:.1f} {sy - 5:.1f} V {sy + 5:.1f} M {sx - 28:.1f} {sy:.1f} H {sx - 11:.1f}"
          stroke="#7dd3fc" stroke-width="0.45" opacity="0.8"/>
    <rect x="{sx + 11:.1f}" y="{sy - 5:.1f}" width="17" height="10" rx="1" fill="#0b4f86" stroke="#38bdf8" stroke-width="0.8"/>
    <path d="M {sx + 16.7:.1f} {sy - 5:.1f} V {sy + 5:.1f} M {sx + 22.3:.1f} {sy - 5:.1f} V {sy + 5:.1f} M {sx + 11:.1f} {sy:.1f} H {sx + 28:.1f}"
          stroke="#7dd3fc" stroke-width="0.45" opacity="0.8"/>
    <rect x="{sx - 9:.1f}" y="{sy - 7:.1f}" width="18" height="14" rx="3" fill="#b7791f" stroke="#fde68a" stroke-width="1"/>
    <rect x="{sx - 5.5:.1f}" y="{sy - 4:.1f}" width="11" height="8" rx="1.5" fill="#d6a33a" opacity="0.9"/>
    <ellipse cx="{sx:.1f}" cy="{sy + 8.5:.1f}" rx="7" ry="2.8" fill="#cbd5e1" stroke="#ffffff" stroke-width="0.7"/>
    <line x1="{sx:.1f}" y1="{sy + 5:.1f}" x2="{sx:.1f}" y2="{sy + 8:.1f}" stroke="#f8fafc" stroke-width="1"/>
  </g>
  <text x="{sx + 26:.1f}" y="{sy + 4:.1f}" fill="{_WHITE}" font-size="9" font-weight="700"
        font-family="{_FONT}">{label}</text>
  <text x="{sx + 26:.1f}" y="{sy + 14:.1f}" fill="#94a3b8" font-size="7" font-family="{_FONT}">~20,200 km</text>"""


def signal_ray(
    g: dict[str, float],
    *,
    color: str = "url(#td-ray)",
    width: float = 2.4,
    marker: str = "td-arr",
    highlight_iono: bool = True,
) -> str:
    sx, sy = g["sat_x"], g["sat_y"]
    rx, ry = g["sx"], g["sy"]
    ix, iy = g["shell_x"], g["shell_y"]
    iono = ""
    if highlight_iono:
        mx, my = (sx + rx) / 2, (sy + ry) / 2
        iono = (
            f'<line x1="{mx - 8:.1f}" y1="{my - 8:.1f}" x2="{mx + 8:.1f}" y2="{my + 8:.1f}" '
            f'stroke="#fbbf24" stroke-width="14" stroke-linecap="round" opacity="0.35"/>'
        )
    return f"""
  {iono}
  <line x1="{sx:.1f}" y1="{sy:.1f}" x2="{rx:.1f}" y2="{ry:.1f}"
        stroke="{color}" stroke-width="{width}" marker-end="url(#{marker})"/>
  <circle cx="{ix:.1f}" cy="{iy:.1f}" r="4" fill="#fbbf24" stroke="#ffffff" stroke-width="0.8"/>"""


def elevation_arc(g: dict[str, float], *, radius: float = 22) -> str:
    sx, sy = g["sx"], g["sy"]
    ex = sx + radius * math.cos(math.radians(g["sat_angle"]))
    ey = sy + radius * math.sin(math.radians(g["sat_angle"]))
    return f"""
  <path d="M {sx:.1f} {sy - radius:.1f} A {radius} {radius} 0 0 1 {ex:.1f} {ey:.1f}"
        fill="none" stroke="#fbbf24" stroke-width="1.6"/>
  <text x="{sx + radius * 0.55:.1f}" y="{sy - radius * 0.35:.1f}" fill="#fbbf24" font-size="10"
        font-style="italic" font-weight="700" font-family="{_FONT}">E</text>"""


def ne_profile_chart(*, x0: float = 48, y0: float = 48, w: float = 120, h: float = 160) -> str:
    x1, y1 = x0 + w, y0 + h
    path = f"M {x0 + 8:.0f} {y1 - 8:.0f} Q {x0 + w * 0.35:.0f} {y0 + h * 0.55:.0f} {x0 + w * 0.55:.0f} {y0 + 18:.0f} T {x1 - 10:.0f} {y0 + 12:.0f}"
    return f"""
  <rect x="{x0 - 6}" y="{y0 - 6}" width="{w + 12}" height="{h + 12}" rx="6" fill="#000000" stroke="#244d73"/>
  <line x1="{x0}" y1="{y1}" x2="{x1}" y2="{y1}" stroke="#475569"/>
  <line x1="{x0}" y1="{y0}" x2="{x0}" y2="{y1}" stroke="#475569"/>
  <path d="{path}" fill="none" stroke="#f59e0b" stroke-width="2.2"/>
  <text x="{x0 - 2}" y="{(y0 + y1) / 2:.0f}" fill="{_WHITE}" font-size="8" font-family="{_FONT}"
        transform="rotate(-90 {x0 - 2} {(y0 + y1) / 2:.0f})">Ne</text>
  <text x="{(x0 + x1) / 2:.0f}" y="{y1 + 14}" text-anchor="middle" fill="{_WHITE}" font-size="8"
        font-family="{_FONT}">Altitude</text>"""


def zimbabwe_outline(*, cx: float = 175, cy: float = 200, scale: float = 1.0) -> str:
    pts = [
        (0, -38), (18, -42), (32, -28), (38, -8), (42, 12), (36, 32), (18, 42),
        (-4, 38), (-22, 28), (-34, 8), (-36, -12), (-24, -32),
    ]
    scaled = " ".join(f"{cx + x * scale:.1f},{cy + y * scale:.1f}" for x, y in pts)
    return f"""
  <polygon points="{scaled}" fill="#1e3a5f" stroke="#168bd2" stroke-width="1.8"/>
  <text x="{cx:.1f}" y="{cy + 4:.1f}" text-anchor="middle" fill="#168bd2" font-size="10"
        font-weight="700" font-family="{_FONT}">Zimbabwe</text>"""
