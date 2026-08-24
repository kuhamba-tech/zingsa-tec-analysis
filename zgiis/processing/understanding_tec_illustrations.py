"""SVG illustrations for the Understanding TEC page — realistic ionospheric geometry."""

from __future__ import annotations

import math

from zgiis.processing.tec_diagram_common import (
    _FONT,
    _H,
    _W,
    canvas,
    cors_receiver,
    earth_disk,
    earth_scene,
    elevation_arc,
    footer,
    gps_satellite,
    ionosphere_shell,
    ne_profile_chart,
    signal_ray,
    standard_defs,
    star_field,
    troposphere_ring,
    zimbabwe_outline,
)

_ILLUSTRATIONS: dict[str, tuple[str, str]] = {}

STEP_META: dict[str, dict[str, str]] = {
    "1": {"num": "1", "short": "CORS path", "accent": "#168bd2"},
    "2": {"num": "2", "short": "What is TEC?", "accent": "#00ff88"},
    "3": {"num": "3", "short": "Why care?", "accent": "#ff4444"},
    "4": {"num": "4", "short": "Two freqs", "accent": "#f59e0b"},
    "5": {"num": "5", "short": "Appleton", "accent": "#a78bfa"},
    "6": {"num": "6", "short": "Ne vs TEC", "accent": "#168bd2"},
    "7": {"num": "7", "short": "STEC → VTEC", "accent": "#00ff88"},
    "8": {"num": "8", "short": "Code vs phase", "accent": "#f472b6"},
    "9": {"num": "9", "short": "GF combo", "accent": "#ff8c00"},
    "10": {"num": "10", "short": "Zimbabwe map", "accent": "#168bd2"},
}

STEP_ORDER = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10"]


def _register(step_id: str, caption: str, svg: str) -> None:
    _ILLUSTRATIONS[step_id] = (caption, svg)


def _step1_svg() -> str:
    g = earth_scene(ox=110, oy=198, re=52, shell_r=82, station_angle=228, sat_angle=318, sat_dist=1.52)
    defs = standard_defs("ut1")
    return canvas(
        star_field(seed=3)
        + troposphere_ring(g)
        + ionosphere_shell(g, grad_id="ut1-iono")
        + earth_disk(g, label="Earth", grad_id="ut1-earth")
        + cors_receiver(g, label="Harare CORS")
        + gps_satellite(g, label="GPS SV", prefix="ut1")
        + signal_ray(g, color="url(#ut1-ray)", marker="ut1-arr")
        + elevation_arc(g)
        + f"""
  <rect x="228" y="118" width="98" height="40" rx="6" fill="rgba(251,191,36,0.18)" stroke="#fbbf24"/>
  <text x="277" y="136" text-anchor="middle" fill="#fbbf24" font-size="9" font-weight="700"
        font-family="{_FONT}">Extra delay</text>
  <text x="277" y="150" text-anchor="middle" fill="#ffffff" font-size="8" font-family="{_FONT}">in ionosphere</text>
  {footer("Radio signal crosses the ionospheric shell before the receiver")}
""",
        defs=defs,
    )


def _step2_svg() -> str:
    g = earth_scene(ox=108, oy=200, re=48, shell_r=76, station_angle=235, sat_angle=310, sat_dist=1.45)
    defs = standard_defs("ut2")
    dots = ""
    for i, t in enumerate([0.18, 0.28, 0.38, 0.48, 0.58, 0.68, 0.78, 0.88]):
        px = g["sat_x"] + (g["sx"] - g["sat_x"]) * t
        py = g["sat_y"] + (g["sy"] - g["sat_y"]) * t
        dots += f'<circle cx="{px:.1f}" cy="{py:.1f}" r="2.8" fill="#f59e0b" opacity="0.9"/>'
    return canvas(
        ionosphere_shell(g, grad_id="ut2-iono", label="Electrons along path")
        + earth_disk(g, grad_id="ut2-earth")
        + cors_receiver(g, label="Receiver")
        + gps_satellite(g, prefix="ut2")
        + f'<line x1="{g["sat_x"]:.1f}" y1="{g["sat_y"]:.1f}" x2="{g["sx"]:.1f}" y2="{g["sy"]:.1f}" stroke="#64748b" stroke-width="1.5" stroke-dasharray="4,3"/>'
        + dots
        + f"""
  <rect x="200" y="36" width="120" height="54" rx="8" fill="#111827" stroke="#00ff88"/>
  <text x="260" y="56" text-anchor="middle" fill="#00ff88" font-size="10" font-weight="800"
        font-family="{_FONT}">STEC</text>
  <text x="260" y="72" text-anchor="middle" fill="#ffffff" font-size="8" font-family="{_FONT}">= ∫ Ne dl</text>
  <text x="260" y="84" text-anchor="middle" fill="#94a3b8" font-size="7" font-family="{_FONT}">1 TECU = 10¹⁶ e⁻ m⁻²</text>
  {footer("Count every electron in a 1 m² column along the ray", lines=("Each dot ≈ free electron contribution",))}
""",
        defs=defs,
    )


def _step3_svg() -> str:
    return canvas(
        f"""
  <text x="170" y="28" text-anchor="middle" fill="#ffffff" font-size="10" font-weight="800"
        font-family="{_FONT}">TEC vs positioning impact</text>
  <rect x="44" y="44" width="252" height="130" rx="8" fill="#000000" stroke="#244d73"/>
  <line x1="56" y1="158" x2="284" y2="158" stroke="#475569"/>
  <line x1="56" y1="56" x2="56" y2="158" stroke="#475569"/>
  <text x="28" y="108" fill="#ffffff" font-size="8" font-family="{_FONT}" transform="rotate(-90 28 108)">Error</text>
  <text x="170" y="178" text-anchor="middle" fill="#ffffff" font-size="8" font-family="{_FONT}">VTEC (TECU)</text>
  <path d="M 56 150 Q 120 148 170 120 T 284 58" fill="none" stroke="#ff4444" stroke-width="2.4"/>
  <circle cx="170" cy="120" r="4" fill="#ff8c00"/>
  <circle cx="230" cy="78" r="4" fill="#ff4444"/>
  <text x="238" y="82" fill="#ff4444" font-size="8" font-family="{_FONT}">Storm</text>
  <rect x="62" y="188" width="216" height="28" rx="6" fill="#111827" stroke="#f59e0b"/>
  <text x="170" y="206" text-anchor="middle" fill="#f59e0b" font-size="9" font-family="{_FONT}">More electrons → more delay → RTK / PPP degrade</text>
  {footer("Geomagnetic storms can push TEC high enough to disturb GNSS")}
""",
    )


def _step4_svg() -> str:
    g = earth_scene(ox=100, oy=205, re=46, shell_r=72, station_angle=240, sat_angle=305, sat_dist=1.42)
    defs = standard_defs("ut4")
    sx, sy, rx, ry = g["sat_x"], g["sat_y"], g["sx"], g["sy"]
    return canvas(
        ionosphere_shell(g, grad_id="ut4-iono")
        + earth_disk(g, grad_id="ut4-earth")
        + cors_receiver(g)
        + gps_satellite(g, prefix="ut4")
        + f"""
  <line x1="{sx:.1f}" y1="{sy:.1f}" x2="{rx:.1f}" y2="{ry:.1f}"
        stroke="#168bd2" stroke-width="2.6" marker-end="url(#ut4-arr)"/>
  <line x1="{sx - 6:.1f}" y1="{sy + 4:.1f}" x2="{rx - 6:.1f}" y2="{ry + 4:.1f}"
        stroke="#f59e0b" stroke-width="2.6" marker-end="url(#ut4-arr)"/>
  <text x="248" y="42" fill="#168bd2" font-size="9" font-weight="700" font-family="{_FONT}">L1 1575 MHz</text>
  <text x="248" y="58" fill="#f59e0b" font-size="9" font-weight="700" font-family="{_FONT}">L2 1228 MHz</text>
  <text x="248" y="78" fill="#ffffff" font-size="8" font-family="{_FONT}">Lower frequency</text>
  <text x="248" y="92" fill="#ffffff" font-size="8" font-family="{_FONT}">→ more ionospheric delay</text>
  {footer("L1 − L2 difference isolates the dispersive ionospheric term")}
""",
        defs=defs,
    )


def _step5_svg() -> str:
    return canvas(
        ne_profile_chart(x0=36, y0=52, w=130, h=150)
        + f"""
  <rect x="188" y="52" width="116" height="150" rx="8" fill="#111827" stroke="#a78bfa"/>
  <text x="246" y="76" text-anchor="middle" fill="#a78bfa" font-size="10" font-weight="800"
        font-family="{_FONT}">Appleton</text>
  <text x="246" y="98" text-anchor="middle" fill="#ffffff" font-size="11" font-weight="700"
        font-family="{_FONT}">η ≈ 1 − 40.3·Nₑ/f²</text>
  <text x="246" y="122" text-anchor="middle" fill="#ffffff" font-size="8" font-family="{_FONT}">Higher Ne → slower signal</text>
  <text x="246" y="138" text-anchor="middle" fill="#ffffff" font-size="8" font-family="{_FONT}">Higher f → less delay</text>
  <line x1="200" y1="158" x2="292" y2="158" stroke="#475569"/>
  <path d="M 200 182 Q 246 148 292 168" fill="none" stroke="#00ff88" stroke-width="2"/>
  <text x="246" y="196" text-anchor="middle" fill="#94a3b8" font-size="7" font-family="{_FONT}">Ne peaks ~300–400 km (F-layer)</text>
  {footer("Dual-frequency GNSS exploits this frequency dependence")}
""",
    )


def _step6_svg() -> str:
    g = earth_scene(ox=230, oy=205, re=38, shell_r=58, station_angle=225, sat_angle=305, sat_dist=1.4)
    defs = standard_defs("ut6")
    return canvas(
        ne_profile_chart(x0=28, y0=48, w=108, h=140)
        + f"""
  <text x="82" y="38" text-anchor="middle" fill="#f59e0b" font-size="9" font-weight="700"
        font-family="{_FONT}">Ne(h) local</text>
  <rect x="152" y="42" width="168" height="168" rx="8" fill="#000000" stroke="#244d73"/>
  """
        + ionosphere_shell(g, grad_id="ut6-iono")
        + earth_disk(g, grad_id="ut6-earth", label="")
        + cors_receiver(g, label="Rx")
        + gps_satellite(g, prefix="ut6")
        + signal_ray(g, color="#00ff88", marker="ut6-arr-g", highlight_iono=True)
        + f"""
  <text x="236" y="36" text-anchor="middle" fill="#00ff88" font-size="9" font-weight="700"
        font-family="{_FONT}">STEC = ∫ Ne dl</text>
  <text x="236" y="222" text-anchor="middle" fill="#ffffff" font-size="8" font-family="{_FONT}">Density at one height ≠ total along ray</text>
  {footer("TEC integrates electron density along the entire slant path")}
""",
        defs=defs,
    )


def _step7_svg() -> str:
    g = earth_scene(ox=108, oy=210, re=50, shell_r=78, station_angle=232, sat_angle=308, sat_dist=1.5)
    defs = standard_defs("ut7")
    vert_top = g["oy"] - g["shell_r"] * 0.72
    return canvas(
        troposphere_ring(g)
        + ionosphere_shell(g, grad_id="ut7-iono")
        + earth_disk(g, grad_id="ut7-earth")
        + cors_receiver(g, label="CORS")
        + gps_satellite(g, prefix="ut7")
        + f"""
  <line x1="{g['sat_x']:.1f}" y1="{g['sat_y']:.1f}" x2="{g['sx']:.1f}" y2="{g['sy']:.1f}"
        stroke="#f59e0b" stroke-width="2.8" marker-end="url(#ut7-arr)"/>
  <line x1="{g['sx']:.1f}" y1="{g['sy']:.1f}" x2="{g['sx']:.1f}" y2="{vert_top:.1f}"
        stroke="#00ff88" stroke-width="2.2" stroke-dasharray="6,4"/>
  <text x="{g['sx'] - 72:.1f}" y="{vert_top + 24:.1f}" fill="#00ff88" font-size="9" font-weight="700"
        font-family="{_FONT}">VTEC</text>
  <text x="{(g['sat_x'] + g['sx']) / 2:.1f}" y="{(g['sat_y'] + g['sy']) / 2 - 10:.1f}" text-anchor="middle"
        fill="#f59e0b" font-size="9" font-weight="700" font-family="{_FONT}">STEC</text>
  <rect x="228" y="36" width="98" height="48" rx="8" fill="#111827" stroke="#168bd2"/>
  <text x="277" y="58" text-anchor="middle" fill="#168bd2" font-size="11" font-weight="800"
        font-family="{_FONT}">VTEC = STEC / S(E)</text>
  <text x="277" y="74" text-anchor="middle" fill="#ffffff" font-size="8" font-family="{_FONT}">S(E) ≥ 1 mapping fn</text>
  {footer("Low elevation lengthens slant path — map to vertical for comparison")}
""",
        defs=defs,
    )


def _step8_svg() -> str:
    return canvas(
        f"""
  <rect x="24" y="36" width="138" height="108" rx="10" fill="#111827" stroke="#f472b6"/>
  <text x="93" y="58" text-anchor="middle" fill="#f472b6" font-size="10" font-weight="800"
        font-family="{_FONT}">Code (C1/C2)</text>
  <rect x="36" y="68" width="18" height="28" fill="#f472b6" opacity="0.9"/>
  <rect x="58" y="68" width="18" height="28" fill="#f472b6" opacity="0.9"/>
  <rect x="80" y="68" width="18" height="28" fill="#f472b6" opacity="0.9"/>
  <rect x="102" y="68" width="18" height="28" fill="#f472b6" opacity="0.9"/>
  <text x="93" y="118" text-anchor="middle" fill="#ffffff" font-size="8" font-family="{_FONT}">±30 cm – 1 m noise</text>

  <rect x="178" y="36" width="138" height="108" rx="10" fill="#111827" stroke="#00ff88"/>
  <text x="247" y="58" text-anchor="middle" fill="#00ff88" font-size="10" font-weight="800"
        font-family="{_FONT}">Carrier phase</text>
  <path d="M 188 92 Q 210 78 232 92 T 276 92 T 300 92" fill="none" stroke="#00ff88" stroke-width="2.2"/>
  <text x="247" y="118" text-anchor="middle" fill="#ffffff" font-size="8" font-family="{_FONT}">±2 mm (integer ambiguity)</text>

  <rect x="48" y="162" width="244" height="44" rx="8" fill="#111827" stroke="#ff8c00"/>
  <text x="170" y="188" text-anchor="middle" fill="#ff8c00" font-size="10" font-weight="700"
        font-family="{_FONT}">Geometry-free L1 − L2 → TEC</text>
  {footer("Combine precise phase with absolute code via levelling")}
""",
    )


def _step9_svg() -> str:
    return canvas(
        f"""
  <rect x="48" y="40" width="244" height="36" rx="6" fill="#111827" stroke="#ff4444"/>
  <text x="170" y="62" text-anchor="middle" fill="#ff4444" font-size="10" font-family="{_FONT}">Raw GF TEC ≈ 26 TECU</text>
  <text x="170" y="92" text-anchor="middle" fill="#ffffff" font-size="14" font-family="{_FONT}">− DCB − ambiguity</text>
  <rect x="48" y="102" width="244" height="36" rx="6" fill="#111827" stroke="#00ff88"/>
  <text x="170" y="124" text-anchor="middle" fill="#00ff88" font-size="10" font-family="{_FONT}">Calibrated TEC ≈ 20 TECU</text>
  <rect x="44" y="152" width="252" height="88" rx="8" fill="#000000" stroke="#244d73"/>
  <path d="M 56 210 L 120 200 L 180 198 L 200 148 L 220 205 L 280 202" fill="none" stroke="#168bd2" stroke-width="2.2"/>
  <circle cx="200" cy="148" r="7" fill="none" stroke="#ef4444" stroke-width="2"/>
  <text x="212" y="144" fill="#ef4444" font-size="8" font-weight="700" font-family="{_FONT}">slip</text>
  <text x="170" y="178" text-anchor="middle" fill="#94a3b8" font-size="8" font-family="{_FONT}">Phase arc with cycle slip</text>
  {footer("Biases and slips must be removed before mapping to VTEC")}
""",
    )


def _step10_svg() -> str:
    stations = [(155, 185), (178, 172), (200, 195), (165, 210), (215, 188)]
    dots = "".join(
        f'<circle cx="{x}" cy="{y}" r="5" fill="#00ff88" stroke="#ffffff" stroke-width="0.8"/>'
        for x, y in stations
    )
    rays = ""
    for i, (x, y) in enumerate(stations):
        ang = 280 + i * 14
        rad = math.radians(ang)
        ex = x + 38 * math.cos(rad)
        ey = y + 38 * math.sin(rad)
        rays += f'<line x1="{x}" y1="{y}" x2="{ex:.1f}" y2="{ey:.1f}" stroke="#168bd2" stroke-width="1" opacity="0.55"/>'

    return canvas(
        star_field(count=12, seed=11)
        + zimbabwe_outline(cx=178, cy=198, scale=1.05)
        + rays
        + dots
        + f"""
  <rect x="36" y="36" width="128" height="52" rx="8" fill="#111827" stroke="#168bd2"/>
  <text x="100" y="56" text-anchor="middle" fill="#168bd2" font-size="9" font-weight="800"
        font-family="{_FONT}">25 CORS stations</text>
  <text x="100" y="72" text-anchor="middle" fill="#ffffff" font-size="8" font-family="{_FONT}">Many GPS rays</text>
  <text x="100" y="84" text-anchor="middle" fill="#ffffff" font-size="8" font-family="{_FONT}">→ regional VTEC map</text>
  {footer("Combined per-satellite VTEC builds the ZGIIS dashboard heatmap", lines=("Green = CORS site · Blue rays = satellite tracks",))}
""",
    )



_register("1", "GPS at ~20,200 km — signal crosses the ionospheric shell before Harare CORS.", _step1_svg())
_register("2", "STEC integrates every electron along the ray through the ionosphere.", _step2_svg())
_register("3", "Higher TEC during storms increases GNSS range error and RTK instability.", _step3_svg())
_register("4", "L2 is delayed more than L1 — the difference reveals electron content.", _step4_svg())
_register("5", "Electron density peaks in the F-layer; Appleton links Ne and frequency to delay.", _step5_svg())
_register("6", "Local Ne(h) is not TEC — integration along the full slant path gives STEC.", _step6_svg())
_register("7", "Mapping function S(E) converts oblique slant TEC to vertical VTEC.", _step7_svg())
_register("8", "Code is noisy but absolute; carrier phase is precise — combine via geometry-free.", _step8_svg())
_register("9", "DCB calibration and cycle-slip repair produce trustworthy TEC arcs.", _step9_svg())
_register("10", "Many satellites over Zimbabwe CORS → the VTEC map on your dashboard.", _step10_svg())


def get_illustration(step_id: str) -> dict[str, str]:
    if step_id not in _ILLUSTRATIONS:
        raise KeyError(f"Unknown illustration step: {step_id!r}")
    caption, svg = _ILLUSTRATIONS[step_id]
    meta = STEP_META.get(step_id, {})
    return {
        "step_id": step_id,
        "caption": caption,
        "svg": svg,
        "num": meta.get("num", step_id),
        "short": meta.get("short", ""),
        "accent": meta.get("accent", "#168bd2"),
    }


def get_journey_pills() -> list[dict[str, str]]:
    return [
        {"num": STEP_META[s]["num"], "short": STEP_META[s]["short"], "accent": STEP_META[s]["accent"]}
        for s in STEP_ORDER
    ]
