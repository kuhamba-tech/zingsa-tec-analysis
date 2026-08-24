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
    land = (
        f'<ellipse cx="{ox - re * 0.15:.1f}" cy="{oy - re * 0.2:.1f}" '
        f'rx="{re * 0.35:.1f}" ry="{re * 0.28:.1f}" fill="#14532d" opacity="0.55"/>'
        f'<ellipse cx="{ox + re * 0.22:.1f}" cy="{oy + re * 0.08:.1f}" '
        f'rx="{re * 0.28:.1f}" ry="{re * 0.22:.1f}" fill="#166534" opacity="0.45"/>'
    )
    return f"""
  {land}
  <circle cx="{ox}" cy="{oy}" r="{re}" fill="url(#{grad_id})" stroke="#64748b" stroke-width="1.6"/>
  <circle cx="{ox - re * 0.28:.1f}" cy="{oy - re * 0.32:.1f}" r="{re * 0.18:.1f}"
          fill="#ffffff" opacity="0.08"/>
  <text x="{ox}" y="{oy + 4}" text-anchor="middle" fill="{_WHITE}" font-size="9"
        font-weight="700" font-family="{_FONT}">{label}</text>"""


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
  <circle cx="{ox}" cy="{oy}" r="{rs:.1f}" fill="url(#{grad_id})" stroke="#168bd2"
          stroke-width="1.2" stroke-dasharray="5,3" opacity="0.85"/>
  <circle cx="{ox}" cy="{oy}" r="{inner:.1f}" fill="{_BG}" opacity="0.0"/>
  <text x="{ox + rs * 0.55:.1f}" y="{oy - rs * 0.72:.1f}" fill="#168bd2" font-size="9"
        font-weight="700" font-family="{_FONT}">{label}</text>"""


def cors_receiver(g: dict[str, float], *, label: str = "CORS", color: str = "#00ff88") -> str:
    sx, sy = g["sx"], g["sy"]
    return f"""
  <rect x="{sx - 5:.1f}" y="{sy - 14:.1f}" width="10" height="10" rx="1.5" fill="{color}" stroke="#ffffff" stroke-width="0.8"/>
  <line x1="{sx:.1f}" y1="{sy - 4:.1f}" x2="{sx:.1f}" y2="{sy + 2:.1f}" stroke="{color}" stroke-width="2"/>
  <polygon points="{sx:.1f},{sy + 2:.1f} {sx + 6:.1f},{sy + 12:.1f} {sx - 6:.1f},{sy + 12:.1f}" fill="{color}"/>
  <text x="{sx - 52:.1f}" y="{sy - 2:.1f}" fill="{color}" font-size="9" font-weight="700"
        font-family="{_FONT}">{label}</text>"""


def gps_satellite(g: dict[str, float], *, label: str = "GPS", prefix: str = "td") -> str:
    sx, sy = g["sat_x"], g["sat_y"]
    return f"""
  <rect x="{sx - 14:.1f}" y="{sy - 5:.1f}" width="28" height="10" rx="2" fill="#1e3a5f" stroke="#168bd2" stroke-width="1.2"/>
  <rect x="{sx - 22:.1f}" y="{sy - 3:.1f}" width="8" height="6" fill="#168bd2" opacity="0.85"/>
  <rect x="{sx + 14:.1f}" y="{sy - 3:.1f}" width="8" height="6" fill="#168bd2" opacity="0.85"/>
  <circle cx="{sx:.1f}" cy="{sy:.1f}" r="3" fill="#ffcc00"/>
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
