"""SVG illustrations for the Understanding TEC page."""

from __future__ import annotations

_FONT = "Arial,Helvetica,sans-serif"
_BG = "#000000"
_WHITE = "#ffffff"
_W = 340
_H = 300
_FOOTER_Y = _H - 30
_FOOTER_H = 24

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


def _canvas(inner: str, *, width: int = _W, height: int = _H) -> str:
    return (
        f'<svg class="vtec-illus-svg" viewBox="0 0 {width} {height}" '
        f'xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet">'
        f'<rect width="{width}" height="{height}" fill="{_BG}"/>'
        f"{inner}"
        f"</svg>"
    )


def _footer(text: str) -> str:
    ty = _FOOTER_Y + 15
    return (
        f'<rect x="24" y="{_FOOTER_Y}" width="{_W - 48}" height="{_FOOTER_H}" rx="5" '
        f'fill="#111827" stroke="#244d73"/>'
        f'<text x="{_W // 2}" y="{ty}" text-anchor="middle" fill="{_WHITE}" '
        f'font-size="8" font-family="{_FONT}">{text}</text>'
    )


def _footer_two(line1: str, line2: str) -> str:
    box_y = _H - 38
    return (
        f'<rect x="24" y="{box_y}" width="{_W - 48}" height="32" rx="5" '
        f'fill="#111827" stroke="#244d73"/>'
        f'<text x="{_W // 2}" y="{box_y + 13}" text-anchor="middle" fill="{_WHITE}" '
        f'font-size="8" font-family="{_FONT}">{line1}</text>'
        f'<text x="{_W // 2}" y="{box_y + 25}" text-anchor="middle" fill="{_WHITE}" '
        f'font-size="8" font-family="{_FONT}">{line2}</text>'
    )


def _step1_svg() -> str:
    return _canvas(
        f"""
  <polygon points="170,28 195,58 155,58" fill="#ffcc00" stroke="#fff"/>
  <text x="170" y="52" text-anchor="middle" fill="#000" font-size="8" font-weight="800" font-family="{_FONT}">GPS</text>
  <line x1="170" y1="58" x2="170" y2="95" stroke="#e2e8f0" stroke-width="2" stroke-dasharray="4,3"/>
  <rect x="55" y="95" width="230" height="42" rx="6" fill="rgba(22,139,210,0.25)" stroke="#168bd2"/>
  <text x="170" y="118" text-anchor="middle" fill="#168bd2" font-size="11" font-weight="800" font-family="{_FONT}">IONOSPHERE</text>
  <text x="170" y="132" text-anchor="middle" fill="{_WHITE}" font-size="8" font-family="{_FONT}">free electrons</text>
  <line x1="170" y1="137" x2="170" y2="195" stroke="#00ff88" stroke-width="2.5" marker-end="url(#ut-arr)"/>
  <rect x="118" y="198" width="104" height="36" rx="6" fill="#1e3a5f" stroke="#00ff88"/>
  <text x="170" y="220" text-anchor="middle" fill="#00ff88" font-size="9" font-weight="700" font-family="{_FONT}">Harare CORS</text>
  <defs><marker id="ut-arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#00ff88"/></marker></defs>
  {_footer("Signal must cross the ionosphere before the receiver")}
"""
    )


def _step2_svg() -> str:
    dots = ""
    for i, (x, y) in enumerate([(155, 130), (165, 145), (175, 138), (185, 152), (170, 160), (160, 168), (180, 170), (175, 182)]):
        dots += f'<circle cx="{x}" cy="{y}" r="3" fill="#f59e0b"/>'
    return _canvas(
        f"""
  <text x="60" y="40" fill="#ffcc00" font-size="10" font-weight="800" font-family="{_FONT}">Satellite *</text>
  <line x1="80" y1="48" x2="130" y2="120" stroke="#e2e8f0" stroke-width="1.5"/>
  {dots}
  <text x="60" y="218" fill="#00ff88" font-size="10" font-weight="800" font-family="{_FONT}">Receiver</text>
  {_footer_two("TEC = count all electrons along the path", "Each electron is like a grain of sand")}
"""
    )


def _step3_svg() -> str:
    return _canvas(
        f"""
  <text x="170" y="36" text-anchor="middle" fill="{_WHITE}" font-size="11" font-weight="800" font-family="{_FONT}">More electrons → more delay</text>
  <rect x="48" y="55" width="244" height="36" rx="6" fill="#111827" stroke="#f59e0b"/>
  <text x="170" y="78" text-anchor="middle" fill="#f59e0b" font-size="10" font-family="{_FONT}">More electrons</text>
  <text x="170" y="108" text-anchor="middle" fill="{_WHITE}" font-size="14" font-family="{_FONT}">↓</text>
  <rect x="48" y="118" width="244" height="36" rx="6" fill="#111827" stroke="#ff8c00"/>
  <text x="170" y="141" text-anchor="middle" fill="#ff8c00" font-size="10" font-family="{_FONT}">More signal delay</text>
  <text x="170" y="168" text-anchor="middle" fill="{_WHITE}" font-size="14" font-family="{_FONT}">↓</text>
  <rect x="48" y="178" width="244" height="36" rx="6" fill="#111827" stroke="#ff4444"/>
  <text x="170" y="201" text-anchor="middle" fill="#ff4444" font-size="10" font-family="{_FONT}">Larger GPS error · RTK unstable</text>
  {_footer("TEC measures how disturbed the ionosphere is")}
"""
    )


def _step4_svg() -> str:
    return _canvas(
        f"""
  <text x="170" y="28" text-anchor="middle" fill="{_WHITE}" font-size="10" font-weight="800" font-family="{_FONT}">L1 vs L2 — different delay</text>
  <line x1="40" y1="200" x2="300" y2="80" stroke="#168bd2" stroke-width="3"/>
  <text x="305" y="78" fill="#168bd2" font-size="9" font-weight="700" font-family="{_FONT}">L1</text>
  <line x1="40" y1="200" x2="300" y2="110" stroke="#f59e0b" stroke-width="3"/>
  <text x="305" y="112" fill="#f59e0b" font-size="9" font-weight="700" font-family="{_FONT}">L2</text>
  <rect x="48" y="198" width="110" height="44" rx="6" fill="#111827" stroke="#168bd2"/>
  <text x="103" y="216" text-anchor="middle" fill="#168bd2" font-size="9" font-family="{_FONT}">L1 1575 MHz</text>
  <text x="103" y="232" text-anchor="middle" fill="{_WHITE}" font-size="8" font-family="{_FONT}">less delay</text>
  <rect x="182" y="198" width="110" height="44" rx="6" fill="#111827" stroke="#f59e0b"/>
  <text x="237" y="216" text-anchor="middle" fill="#f59e0b" font-size="9" font-family="{_FONT}">L2 1228 MHz</text>
  <text x="237" y="232" text-anchor="middle" fill="{_WHITE}" font-size="8" font-family="{_FONT}">more delay</text>
  {_footer("Comparing L1 and L2 reveals electron content")}
"""
    )


def _step5_svg() -> str:
    return _canvas(
        f"""
  <text x="170" y="32" text-anchor="middle" fill="#a78bfa" font-size="11" font-weight="800" font-family="{_FONT}">Appleton (simplified)</text>
  <rect x="48" y="55" width="244" height="52" rx="8" fill="#111827" stroke="#a78bfa"/>
  <text x="170" y="88" text-anchor="middle" fill="{_WHITE}" font-size="14" font-weight="700" font-family="{_FONT}">η ≈ 1 − 40.3·Nₑ/f²</text>
  <text x="170" y="130" text-anchor="middle" fill="{_WHITE}" font-size="9" font-family="{_FONT}">Nₑ = electron density · f = frequency</text>
  <text x="90" y="168" fill="#ff4444" font-size="9" font-family="{_FONT}">↑ Nₑ → more delay</text>
  <text x="200" y="168" fill="#00ff88" font-size="9" font-family="{_FONT}">↑ f → less effect</text>
  {_footer("Foundation of GNSS ionospheric research")}
"""
    )


def _step6_svg() -> str:
    return _canvas(
        f"""
  <rect x="48" y="40" width="110" height="70" rx="6" fill="#111827" stroke="#168bd2"/>
  <text x="103" y="62" text-anchor="middle" fill="#168bd2" font-size="9" font-weight="700" font-family="{_FONT}">1 m³</text>
  <text x="103" y="82" text-anchor="middle" fill="{_WHITE}" font-size="8" font-family="{_FONT}">Ne density</text>
  <text x="103" y="98" text-anchor="middle" fill="{_WHITE}" font-size="8" font-family="{_FONT}">electrons/m³</text>
  <text x="170" y="78" text-anchor="middle" fill="{_WHITE}" font-size="16" font-family="{_FONT}">≠</text>
  <rect x="182" y="40" width="110" height="70" rx="6" fill="#111827" stroke="#00ff88"/>
  <text x="237" y="62" text-anchor="middle" fill="#00ff88" font-size="9" font-weight="700" font-family="{_FONT}">STEC</text>
  <text x="237" y="82" text-anchor="middle" fill="{_WHITE}" font-size="8" font-family="{_FONT}">integrate Ne</text>
  <text x="237" y="98" text-anchor="middle" fill="{_WHITE}" font-size="8" font-family="{_FONT}">along whole path</text>
  <line x1="170" y1="130" x2="170" y2="198" stroke="#e2e8f0" stroke-width="2"/>
  <text x="170" y="216" text-anchor="middle" fill="{_WHITE}" font-size="9" font-family="{_FONT}">∫ Ne ds along satellite → receiver</text>
  {_footer("TEC counts electrons along the slant path")}
"""
    )


def _step7_svg() -> str:
    return _canvas(
        f"""
  <line x1="80" y1="60" x2="260" y2="200" stroke="#00ff88" stroke-width="2.5"/>
  <text x="70" y="55" fill="#ffcc00" font-size="9" font-family="{_FONT}">SV</text>
  <text x="265" y="210" fill="#168bd2" font-size="9" font-family="{_FONT}">Rx</text>
  <text x="170" y="115" fill="#00ff88" font-size="10" font-weight="700" font-family="{_FONT}">Slant TEC</text>
  <text x="170" y="145" text-anchor="middle" fill="{_WHITE}" font-size="14" font-family="{_FONT}">↓ S(E)</text>
  <line x1="170" y1="155" x2="170" y2="205" stroke="#168bd2" stroke-width="2"/>
  <text x="170" y="225" text-anchor="middle" fill="#168bd2" font-size="10" font-weight="700" font-family="{_FONT}">Vertical TEC</text>
  {_footer("Mapping function converts slant to vertical TEC")}
"""
    )


def _step8_svg() -> str:
    return _canvas(
        f"""
  <rect x="32" y="45" width="130" height="90" rx="8" fill="#111827" stroke="#f472b6"/>
  <text x="97" y="68" text-anchor="middle" fill="#f472b6" font-size="10" font-weight="800" font-family="{_FONT}">Code</text>
  <text x="97" y="88" text-anchor="middle" fill="{_WHITE}" font-size="8" font-family="{_FONT}">START … STOP</text>
  <text x="97" y="118" text-anchor="middle" fill="{_WHITE}" font-size="9" font-family="{_FONT}">±30 cm – 1 m</text>
  <rect x="178" y="45" width="130" height="90" rx="8" fill="#111827" stroke="#00ff88"/>
  <text x="243" y="68" text-anchor="middle" fill="#00ff88" font-size="10" font-weight="800" font-family="{_FONT}">Carrier</text>
  <text x="243" y="88" text-anchor="middle" fill="{_WHITE}" font-size="8" font-family="{_FONT}">count wave cycles</text>
  <text x="243" y="118" text-anchor="middle" fill="{_WHITE}" font-size="9" font-family="{_FONT}">±2 mm (ambiguity)</text>
  <rect x="48" y="155" width="244" height="44" rx="6" fill="#111827" stroke="#ff8c00"/>
  <text x="170" y="182" text-anchor="middle" fill="#ff8c00" font-size="9" font-weight="700" font-family="{_FONT}">L1 − L2 → Geometry-Free TEC</text>
  {_footer("Carrier phase is precise; GF cancels most errors")}
"""
    )


def _step9_svg() -> str:
    return _canvas(
        f"""
  <text x="170" y="28" text-anchor="middle" fill="{_WHITE}" font-size="10" font-weight="800" font-family="{_FONT}">Calibration removes biases</text>
  <rect x="48" y="45" width="244" height="32" rx="6" fill="#111827" stroke="#ff4444"/>
  <text x="170" y="66" text-anchor="middle" fill="#ff4444" font-size="9" font-family="{_FONT}">Measured 26 TECU (raw)</text>
  <text x="170" y="92" text-anchor="middle" fill="{_WHITE}" font-size="12" font-family="{_FONT}">− biases − ambiguity</text>
  <rect x="48" y="102" width="244" height="32" rx="6" fill="#111827" stroke="#00ff88"/>
  <text x="170" y="123" text-anchor="middle" fill="#00ff88" font-size="9" font-family="{_FONT}">True TEC ≈ 20 TECU</text>
  <path d="M 60 160 L 120 160 L 140 140 L 160 200 L 180 130 L 200 170 L 280 170" fill="none" stroke="#168bd2" stroke-width="2"/>
  <circle cx="200" cy="130" r="6" fill="#ff4444"/>
  <text x="210" y="128" fill="#ff4444" font-size="8" font-family="{_FONT}">cycle slip</text>
  {_footer("Detect jumps from scintillation or solar flares")}
"""
    )


def _step10_svg() -> str:
    return _canvas(
        f"""
  <path d="M 120 220 L 140 180 L 170 170 L 210 175 L 230 200 L 200 230 L 150 235 Z" fill="#1e3a5f" stroke="#168bd2"/>
  <text x="175" y="205" text-anchor="middle" fill="#168bd2" font-size="9" font-weight="700" font-family="{_FONT}">Zimbabwe</text>
  <circle cx="130" cy="190" r="8" fill="#00ff88" opacity="0.9"/>
  <circle cx="175" cy="185" r="8" fill="#00ff88" opacity="0.9"/>
  <circle cx="200" cy="200" r="8" fill="#f59e0b" opacity="0.9"/>
  <circle cx="160" cy="210" r="8" fill="#ff4444" opacity="0.9"/>
  <text x="48" y="48" fill="{_WHITE}" font-size="9" font-weight="700" font-family="{_FONT}">GPS 1 · 2 · 3 · 4</text>
  <text x="48" y="68" fill="{_WHITE}" font-size="8" font-family="{_FONT}">each SV → one slant TEC</text>
  {_footer_two("→ VTEC map on ZGIIS dashboard", "Many satellites build the ionosphere picture")}
"""
    )


_register("1", "GPS at ~20,200 km — the signal crosses the ionosphere before Harare CORS.", _step1_svg())
_register("2", "TEC counts every electron along the path — like grains of sand between satellite and receiver.", _step2_svg())
_register("3", "More electrons mean more delay and larger positioning errors during storms.", _step3_svg())
_register("4", "L2 slows more than L1 in the ionosphere — the difference reveals TEC.", _step4_svg())
_register("5", "The simplified Appleton equation links electron density and frequency to delay.", _step5_svg())
_register("6", "Electron density is per m³; TEC integrates density along the entire signal path.", _step6_svg())
_register("7", "Slant TEC along the oblique path is mapped to vertical TEC for comparison.", _step7_svg())
_register("8", "Code is noisy; carrier phase is precise — L1−L2 geometry-free isolates TEC.", _step8_svg())
_register("9", "Receiver and satellite biases must be removed; cycle slips look like sudden jumps.", _step9_svg())
_register("10", "Many GPS satellites over Zimbabwe → the VTEC map on your dashboard.", _step10_svg())


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
