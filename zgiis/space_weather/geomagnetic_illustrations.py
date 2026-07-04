"""SVG illustrations for the Geomagnetic Storm Metrics Theory page."""

from __future__ import annotations

from typing import Any

_FONT = "Arial,Helvetica,sans-serif"
_BG = "#000000"
_WHITE = "#ffffff"
_W = 340
_H = 280

_ILLUSTRATIONS: dict[str, tuple[str, str]] = {}

STEP_META: dict[str, dict[str, str]] = {
    "1": {"num": "1", "short": "Sun → Earth", "accent": "#ffcc00"},
    "2": {"num": "2", "short": "Kp index", "accent": "#00ff88"},
    "3": {"num": "3", "short": "Dst (nT)", "accent": "#ff4444"},
    "4": {"num": "4", "short": "Ap index", "accent": "#a78bfa"},
    "5": {"num": "5", "short": "F10.7 flux", "accent": "#f59e0b"},
    "6": {"num": "6", "short": "Solar wind", "accent": "#168bd2"},
    "7": {"num": "7", "short": "Storm phases", "accent": "#f472b6"},
    "8": {"num": "8", "short": "Zimbabwe impact", "accent": "#00ff88"},
}

STEP_ORDER = ["1", "2", "3", "4", "5", "6", "7", "8"]


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
    return (
        f'<text x="{_W // 2}" y="{_H - 12}" text-anchor="middle" fill="{_WHITE}" '
        f'font-size="9" font-family="{_FONT}">{text}</text>'
    )


def _step1_svg() -> str:
    return _canvas(
        f"""
  <circle cx="52" cy="140" r="28" fill="#ffcc00" stroke="#ffffff" stroke-width="1.2"/>
  <text x="52" y="144" text-anchor="middle" fill="#000" font-size="10" font-weight="800" font-family="{_FONT}">Sun</text>
  <text x="52" y="178" text-anchor="middle" fill="#ffcc00" font-size="9" font-family="{_FONT}">CME / flare</text>
  <line x1="88" y1="132" x2="155" y2="128" stroke="#168bd2" stroke-width="2" marker-end="url(#gm-arr)"/>
  <line x1="88" y1="140" x2="155" y2="140" stroke="#168bd2" stroke-width="2.5"/>
  <line x1="88" y1="148" x2="155" y2="152" stroke="#168bd2" stroke-width="2"/>
  <text x="118" y="118" text-anchor="middle" fill="#168bd2" font-size="9" font-weight="700" font-family="{_FONT}">solar wind</text>
  <circle cx="248" cy="140" r="38" fill="#1e3a5f" stroke="#168bd2" stroke-width="1.8"/>
  <ellipse cx="248" cy="140" rx="52" ry="28" fill="none" stroke="#00ff88" stroke-width="1.2" stroke-dasharray="5,4"/>
  <text x="248" y="144" text-anchor="middle" fill="{_WHITE}" font-size="10" font-weight="700" font-family="{_FONT}">Earth</text>
  <text x="248" y="188" text-anchor="middle" fill="#00ff88" font-size="9" font-family="{_FONT}">magnetosphere</text>
  <defs>
    <marker id="gm-arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="#168bd2"/>
    </marker>
  </defs>
  {_footer("Energy from the Sun compresses Earth's magnetic field")}
"""
    )


def _step2_svg() -> str:
    bars = [(40, 180, 28), (90, 150, 58), (140, 120, 88), (190, 100, 108), (240, 85, 123), (290, 70, 138)]
    bar_svg = ""
    for i, (x, y, h) in enumerate(bars):
        color = "#00ff88" if h < 100 else "#ffcc00" if h < 120 else "#ff4444"
        bar_svg += f'<rect x="{x}" y="{y}" width="36" height="{h}" rx="4" fill="{color}" opacity="0.9"/>'
        bar_svg += f'<text x="{x + 18}" y="{y - 6}" text-anchor="middle" fill="{_WHITE}" font-size="9" font-family="{_FONT}">{3 + i}</text>'
    return _canvas(
        bar_svg
        + f"""
  <line x1="28" y1="100" x2="312" y2="100" stroke="#ff7a00" stroke-width="1.5" stroke-dasharray="6,4"/>
  <text x="312" y="96" text-anchor="end" fill="#ff7a00" font-size="9" font-weight="700" font-family="{_FONT}">Kp = 5 (G1 storm)</text>
  <text x="170" y="28" text-anchor="middle" fill="{_WHITE}" font-size="11" font-weight="800" font-family="{_FONT}">Planetary K-index (0–9)</text>
  <text x="48" y="252" fill="{_WHITE}" font-size="8" font-family="{_FONT}">quiet</text>
  <text x="268" y="252" fill="{_WHITE}" font-size="8" font-family="{_FONT}">storm</text>
  {_footer("Each 3-hour block gets a Kp value; ≥ 5 = geomagnetic storm")}
"""
    )


def _step3_svg() -> str:
    return _canvas(
        f"""
  <circle cx="170" cy="145" r="55" fill="#1e3a5f" stroke="#168bd2" stroke-width="1.5"/>
  <circle cx="170" cy="145" r="38" fill="none" stroke="#ff4444" stroke-width="3" opacity="0.85"/>
  <path d="M 170 107 A 38 38 0 1 1 169.9 107" fill="none" stroke="#ff4444" stroke-width="4"
        stroke-linecap="round" marker-end="url(#dst-arr)"/>
  <text x="170" y="148" text-anchor="middle" fill="{_WHITE}" font-size="10" font-weight="700" font-family="{_FONT}">Earth</text>
  <text x="248" y="118" fill="#ff4444" font-size="10" font-weight="800" font-family="{_FONT}">Ring current</text>
  <text x="248" y="134" fill="#ff4444" font-size="9" font-family="{_FONT}">Dst more negative</text>
  <text x="248" y="150" fill="{_WHITE}" font-size="9" font-family="{_FONT}">= stronger storm</text>
  <rect x="28" y="210" width="284" height="44" rx="8" fill="#111827" stroke="#244d73"/>
  <text x="170" y="228" text-anchor="middle" fill="#ff4444" font-size="10" font-weight="700" font-family="{_FONT}">Dst ≤ −50 nT → storm threshold</text>
  <text x="170" y="244" text-anchor="middle" fill="{_WHITE}" font-size="9" font-family="{_FONT}">measured at equatorial stations (WDC Kyoto)</text>
  <defs>
    <marker id="dst-arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="#ff4444"/>
    </marker>
  </defs>
  {_footer("Dst tracks the ring-current intensity around Earth")}
"""
    )


def _step4_svg() -> str:
    return _canvas(
        f"""
  <text x="170" y="28" text-anchor="middle" fill="{_WHITE}" font-size="11" font-weight="800" font-family="{_FONT}">Daily Ap (planetary amplitude)</text>
  <path d="M 40 200 Q 90 80, 140 200 T 240 200 T 300 200" fill="none" stroke="#a78bfa" stroke-width="2.5"/>
  <line x1="40" y1="200" x2="300" y2="200" stroke="#64748b" stroke-width="1"/>
  <line x1="40" y1="110" x2="300" y2="110" stroke="#ff7a00" stroke-width="1.2" stroke-dasharray="5,4"/>
  <text x="302" y="114" fill="#ff7a00" font-size="8" font-family="{_FONT}">Ap=50</text>
  <line x1="140" y1="200" x2="140" y2="95" stroke="#a78bfa" stroke-width="1" stroke-dasharray="3,3"/>
  <text x="140" y="88" text-anchor="middle" fill="#a78bfa" font-size="9" font-weight="700" font-family="{_FONT}">daily max</text>
  <rect x="48" y="218" width="244" height="36" rx="6" fill="#111827" stroke="#244d73"/>
  <text x="170" y="240" text-anchor="middle" fill="#a78bfa" font-size="9" font-family="{_FONT}">Ap ≥ 50 → storm-level daily activity</text>
  {_footer("Ap summarises one full UTC day of geomagnetic disturbance")}
"""
    )


def _step5_svg() -> str:
    return _canvas(
        f"""
  <circle cx="80" cy="120" r="32" fill="#ffcc00" stroke="#ffffff" stroke-width="1"/>
  <line x1="80" y1="88" x2="80" y2="52" stroke="#f59e0b" stroke-width="2"/>
  <line x1="60" y1="100" x2="35" y2="85" stroke="#f59e0b" stroke-width="1.5"/>
  <line x1="100" y1="100" x2="125" y2="85" stroke="#f59e0b" stroke-width="1.5"/>
  <text x="80" y="124" text-anchor="middle" fill="#000" font-size="9" font-weight="800" font-family="{_FONT}">Sun</text>
  <text x="170" y="72" fill="#f59e0b" font-size="10" font-weight="800" font-family="{_FONT}">F10.7 solar radio flux</text>
  <text x="170" y="92" fill="{_WHITE}" font-size="9" font-family="{_FONT}">2800 MHz · units: sfu</text>
  <text x="170" y="112" fill="{_WHITE}" font-size="9" font-family="{_FONT}">(10⁻²² W m⁻² Hz⁻¹)</text>
  <rect x="48" y="168" width="244" height="88" rx="8" fill="#111827" stroke="#f59e0b"/>
  <text x="170" y="192" text-anchor="middle" fill="{_WHITE}" font-size="9" font-family="{_FONT}">Low F10.7 (~70 sfu) → quiet Sun</text>
  <text x="170" y="212" text-anchor="middle" fill="{_WHITE}" font-size="9" font-family="{_FONT}">High F10.7 (~200 sfu) → active Sun</text>
  <text x="170" y="236" text-anchor="middle" fill="#f59e0b" font-size="9" font-weight="700" font-family="{_FONT}">Does not prove a storm today — watch Kp/Dst</text>
  {_footer("F10.7 tracks long-term solar activity and ionospheric background")}
"""
    )


def _step6_svg() -> str:
    return _canvas(
        f"""
  <circle cx="52" cy="130" r="22" fill="#ffcc00"/>
  <line x1="78" y1="125" x2="145" y2="125" stroke="#168bd2" stroke-width="2.5" marker-end="url(#sw-arr)"/>
  <line x1="78" y1="135" x2="145" y2="135" stroke="#168bd2" stroke-width="2"/>
  <circle cx="248" cy="130" r="34" fill="#1e3a5f" stroke="#168bd2"/>
  <text x="248" y="134" text-anchor="middle" fill="{_WHITE}" font-size="9" font-family="{_FONT}">Earth</text>
  <rect x="155" y="168" width="130" height="88" rx="8" fill="#111827" stroke="#168bd2"/>
  <text x="220" y="190" text-anchor="middle" fill="#168bd2" font-size="10" font-weight="800" font-family="{_FONT}">Solar wind</text>
  <text x="220" y="210" text-anchor="middle" fill="{_WHITE}" font-size="9" font-family="{_FONT}">Speed (km/s)</text>
  <text x="220" y="228" text-anchor="middle" fill="{_WHITE}" font-size="9" font-family="{_FONT}">IMF Bz (nT)</text>
  <text x="220" y="246" text-anchor="middle" fill="#ff4444" font-size="9" font-family="{_FONT}">Bz south → storm coupling</text>
  <defs>
    <marker id="sw-arr" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
      <path d="M0,0 L6,3 L0,6 Z" fill="#168bd2"/>
    </marker>
  </defs>
  {_footer("Fast wind + southward Bz energises the magnetosphere")}
"""
    )


def _step7_svg() -> str:
    return _canvas(
        f"""
  <text x="170" y="24" text-anchor="middle" fill="{_WHITE}" font-size="11" font-weight="800" font-family="{_FONT}">Typical geomagnetic storm timeline</text>
  <line x1="40" y1="200" x2="300" y2="200" stroke="#64748b" stroke-width="1"/>
  <circle cx="70" cy="200" r="5" fill="#00ff88"/>
  <text x="70" y="222" text-anchor="middle" fill="#00ff88" font-size="8" font-family="{_FONT}">quiet</text>
  <circle cx="120" cy="200" r="5" fill="#ffcc00"/>
  <text x="120" y="222" text-anchor="middle" fill="#ffcc00" font-size="8" font-family="{_FONT}">SSC</text>
  <circle cx="190" cy="200" r="5" fill="#ff4444"/>
  <text x="190" y="222" text-anchor="middle" fill="#ff4444" font-size="8" font-family="{_FONT}">main phase</text>
  <circle cx="270" cy="200" r="5" fill="#168bd2"/>
  <text x="270" y="222" text-anchor="middle" fill="#168bd2" font-size="8" font-family="{_FONT}">recovery</text>
  <path d="M 40 160 Q 120 155, 190 90 T 300 150" fill="none" stroke="#00ff88" stroke-width="2"/>
  <text x="48" y="148" fill="#00ff88" font-size="8" font-family="{_FONT}">Kp ↑</text>
  <path d="M 40 175 Q 120 170, 190 115 T 300 165" fill="none" stroke="#ff4444" stroke-width="2"/>
  <text x="48" y="168" fill="#ff4444" font-size="8" font-family="{_FONT}">Dst ↓</text>
  <rect x="48" y="238" width="244" height="28" rx="6" fill="#111827" stroke="#244d73"/>
  <text x="170" y="256" text-anchor="middle" fill="{_WHITE}" font-size="9" font-family="{_FONT}">Compare all indices on the same time window</text>
  {_footer("Kp rises first; Dst reaches minimum in the main phase")}
"""
    )


def _step8_svg() -> str:
    return _canvas(
        f"""
  <path d="M 120 220 L 140 180 L 170 170 L 210 175 L 230 200 L 200 230 L 150 235 Z"
        fill="#1e3a5f" stroke="#00ff88" stroke-width="1.5"/>
  <text x="175" y="205" text-anchor="middle" fill="#00ff88" font-size="9" font-weight="700" font-family="{_FONT}">Zimbabwe</text>
  <rect x="148" y="148" width="54" height="28" rx="4" fill="#111827" stroke="#168bd2"/>
  <text x="175" y="166" text-anchor="middle" fill="#168bd2" font-size="8" font-family="{_FONT}">ZETDC GIC</text>
  <circle cx="95" cy="155" r="10" fill="none" stroke="#a78bfa" stroke-width="1.5"/>
  <text x="95" y="158" text-anchor="middle" fill="#a78bfa" font-size="7" font-family="{_FONT}">GNSS</text>
  <ellipse cx="175" cy="125" rx="70" ry="18" fill="none" stroke="#f59e0b" stroke-width="1.2" stroke-dasharray="4,3"/>
  <text x="175" y="108" text-anchor="middle" fill="#f59e0b" font-size="8" font-family="{_FONT}">ionosphere / TEC</text>
  <rect x="28" y="248" width="284" height="22" rx="4" fill="#111827" stroke="#244d73"/>
  <text x="170" y="262" text-anchor="middle" fill="{_WHITE}" font-size="8" font-family="{_FONT}">Storms affect power grid, navigation &amp; radio</text>
  {_footer("ZINGSA monitors indices to protect national infrastructure")}
"""
    )


_register("1", "Solar eruptions release plasma that travels as the solar wind toward Earth.", _step1_svg())
_register("2", "Kp summarises global geomagnetic activity in 3-hour blocks — storm level starts at 5.", _step2_svg())
_register("3", "A stronger westward ring current makes Dst more negative during the storm main phase.", _step3_svg())
_register("4", "Ap is the daily average of 8 three-hour Kp amplitudes — one number per UTC day.", _step4_svg())
_register("5", "F10.7 measures 10.7 cm solar radio flux — a proxy for sunspots and long-term solar activity.", _step5_svg())
_register("6", "Solar wind speed and southward IMF Bz control how much energy enters the magnetosphere.", _step6_svg())
_register("7", "During a storm: sudden commencement → main phase (Kp up, Dst down) → recovery.", _step7_svg())
_register("8", "Geomagnetic storms disturb Zimbabwe's grid (GIC), GNSS positioning, and ionospheric TEC.", _step8_svg())


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
        {
            "num": STEP_META[step_id]["num"],
            "short": STEP_META[step_id]["short"],
            "accent": STEP_META[step_id]["accent"],
        }
        for step_id in STEP_ORDER
    ]
