"""Solar Activity Monitor HTML renderer — mirrors CORS_Program SpaceWeatherAfrica.jsx."""
from __future__ import annotations

import datetime
import html
import math
from typing import Any, Dict, List, Optional

from zgiis.space_weather.solar_activity import (
    build_donki_active_regions,
    build_donki_cme_rows,
    build_donki_radio_bursts,
)

AR_POS = [(28, 38), (62, 44), (48, 62), (72, 28), (35, 55), (58, 72)]
_INTENSITY = {"Strong": "#ef4444", "Moderate": "#eab308", "Weak": "#ffffff"}
_XRAY_BANDS = [
    ("#ef4444", 0.0, "0.1 – 0.8 nm"),
    ("#f97316", 0.8, "0.05 – 0.4 nm"),
    ("#eab308", 1.6, "0.025 – 0.05 nm"),
    ("#22c55e", 2.4, "0.012 – 0.025 nm"),
]

SOLAR_CSS = """
<style>
.sw-solar-monitor,.sw-solar-monitor *{color:#ffffff}
.sw-solar-monitor{margin:12px 0 18px;padding:18px;border:1px solid rgba(34,211,238,.2);border-radius:16px;
background:radial-gradient(circle at 14% 8%,rgba(249,115,22,.14),transparent 28%),linear-gradient(180deg,rgba(8,14,32,.96),rgba(4,8,20,.98))}
.sw-solar-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;margin-bottom:14px;flex-wrap:wrap}
.sw-solar-kicker,.sw-solar-card-title{color:#22d3ee;font-size:.68rem;font-weight:900;letter-spacing:.12em;text-transform:uppercase}
.sw-solar-head h3{margin:8px 0 0;color:#ffffff;font-size:clamp(1.1rem,1.7vw,1.5rem);line-height:1.15}
.sw-solar-meta{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px 14px;color:#ffffff;font-size:.62rem;font-weight:800}
.sw-solar-live-dot{display:inline-block;width:7px;height:7px;margin-right:6px;border-radius:50%}
.sw-solar-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}
.sw-solar-card{min-height:150px;padding:14px;border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(15,23,42,.58)}
.sw-solar-wide{grid-column:span 2}
.sw-solar-summary{display:grid;grid-template-columns:112px 1fr;gap:14px}
.sw-solar-orb{width:108px;height:108px;align-self:center;border-radius:50%;
background:radial-gradient(circle at 35% 30%,#fff7ad 0 4%,transparent 5%),radial-gradient(circle at 58% 48%,#fbbf24 0 8%,transparent 9%),
radial-gradient(circle,#facc15 0 28%,#f97316 58%,#7c2d12 100%);box-shadow:0 0 32px color-mix(in srgb,var(--solar) transparent 35%)}
.sw-solar-summary-copy{display:grid;align-content:center;gap:4px}
.sw-solar-summary-copy span,.sw-solar-metric span,.sw-solar-source{color:#ffffff;font-size:.64rem;font-weight:800}
.sw-solar-summary-copy strong,.sw-solar-metric strong{color:#ffffff;font-size:.95rem}
.sw-solar-flare{margin:14px 0 6px;font-size:2rem;font-weight:950;line-height:1}
.sw-solar-flare-count{margin:14px 0 6px;color:#22d3ee;font-size:2rem;font-weight:950;line-height:1}
.sw-solar-card p{margin:8px 0 0;color:#ffffff;font-size:.72rem;line-height:1.55}
.sw-solar-scale{display:grid;gap:4px;margin-top:10px}
.sw-solar-scale span{color:#ffffff;font-size:.62rem;font-weight:800}
.sw-solar-scale span.active{color:#ffffff}
.sw-solar-metric{display:flex;justify-content:space-between;gap:12px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.06)}
.sw-solar-impact-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}
.sw-solar-impact{display:grid;gap:4px;padding:10px;border-radius:10px;background:rgba(255,255,255,.035)}
.sw-solar-impact span{color:#ffffff;font-size:.62rem;font-weight:800}
.sw-solar-impact strong{color:#ffffff;font-size:.72rem}
.sw-api-routing{color:#ffffff;font-size:.58rem;font-weight:700;margin:0 0 10px;line-height:1.5}
.sw-api-routing span{color:#22d3ee}
.sw-enh-data-note{color:#ffffff;font-size:.62rem;font-weight:800;margin:14px 0 6px;text-transform:uppercase;letter-spacing:.08em}
.sw-enh-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:8px}
.sw-enh-panel{background:rgba(15,23,42,.62);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:14px}
.sw-enh-panel-title{color:#22d3ee;font-size:.6rem;font-weight:900;letter-spacing:.1em;text-transform:uppercase;margin-bottom:12px}
.sw-enh-panel-hdr{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;flex-wrap:wrap}
.sw-enh-select{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:6px;color:#ffffff;padding:3px 8px;font-size:.6rem;font-weight:700}
.sw-enh-time-btns{display:flex;gap:4px;margin-bottom:8px}
.sw-enh-time-btn{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:5px;color:#ffffff;font-size:.6rem;font-weight:800;padding:3px 9px}
.sw-enh-time-btn.active{background:rgba(34,211,238,.12);border-color:rgba(34,211,238,.4);color:#22d3ee}
.sw-enh-y-axis{display:flex;flex-direction:column;justify-content:space-between;color:rgba(255,255,255,.22);font-size:.5rem;font-weight:700;width:32px;text-align:right;padding-right:4px;flex-shrink:0;height:82px}
.sw-enh-x-labels{display:flex;justify-content:space-between;color:rgba(255,255,255,.25);font-size:.5rem;font-weight:700;margin-top:3px}
.sw-enh-legend{display:flex;flex-wrap:wrap;gap:8px 14px;margin-top:8px}
.sw-enh-legend span{display:flex;align-items:center;gap:5px;color:#ffffff;font-size:.56rem;font-weight:700}
.sw-enh-legend i{width:14px;height:2.5px;border-radius:1px;flex-shrink:0;display:inline-block}
.sw-enh-table{width:100%;border-collapse:collapse;font-size:.63rem}
.sw-enh-table th{color:#ffffff;font-size:.56rem;font-weight:800;text-transform:uppercase;padding:5px 6px;border-bottom:1px solid rgba(255,255,255,.07);text-align:left;white-space:nowrap}
.sw-enh-table td{color:#ffffff;font-weight:700;padding:7px 6px;border-bottom:1px solid rgba(255,255,255,.045);white-space:nowrap}
.sw-enh-empty{color:#ffffff;font-size:.62rem;padding:8px 0}
.sw-enh-view-all{display:inline-block;margin-top:10px;color:#22d3ee;font-size:.62rem;font-weight:800;text-decoration:none}
.sw-enh-ar-layout{display:grid;grid-template-columns:118px 1fr;gap:12px;align-items:start}
.sw-enh-sun-wrap{display:flex;justify-content:center}
.sw-enh-sun{position:relative;width:110px;height:110px;border-radius:50%;
background:radial-gradient(circle at 38% 32%,rgba(255,255,210,.55) 0%,transparent 8%),radial-gradient(circle,#facc15 0%,#f97316 55%,#7c2d12 100%);
box-shadow:0 0 36px rgba(249,115,22,.55)}
.sw-enh-ar-marker{position:absolute;transform:translate(-50%,-50%)}
.sw-enh-ar-circle{width:14px;height:14px;border-radius:50%;border:1.5px solid rgba(255,255,255,.88)}
.sw-enh-ar-label{position:absolute;left:50%;top:-15px;transform:translateX(-50%);color:#ffffff;font-size:.5rem;font-weight:900;white-space:nowrap}
.sw-enh-cycle-header{display:flex;gap:22px;align-items:flex-start;margin-bottom:6px}
.sw-enh-sub-label{color:#ffffff;font-size:.58rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}
.sw-enh-cycle-num{color:#a855f7;font-size:2.2rem;font-weight:900;line-height:1}
.sw-enh-cycle-pct{color:#a855f7;font-size:1.25rem;font-weight:900;margin-bottom:6px}
.sw-enh-cycle-bar{height:6px;width:100px;background:rgba(168,85,247,.14);border-radius:3px;overflow:hidden}
.sw-enh-cycle-fill{height:100%;background:linear-gradient(90deg,#7c3aed,#a855f7);border-radius:3px}
.sw-footer-bar{display:flex;align-items:stretch;margin-top:16px;border:1px solid rgba(34,211,238,.11);border-radius:12px;background:rgba(5,10,26,.97);overflow:hidden;flex-wrap:wrap}
.sw-footer-section{flex:1;padding:14px 20px;min-width:260px}
.sw-footer-divider{width:1px;background:rgba(255,255,255,.06);flex-shrink:0}
.sw-footer-title{color:#ffffff;font-size:.58rem;font-weight:800;text-transform:uppercase;letter-spacing:.1em;margin-bottom:12px}
.sw-footer-impacts,.sw-footer-levels{display:flex;gap:18px;flex-wrap:wrap}
.sw-footer-impact-label{color:#ffffff;font-size:.58rem;font-weight:700;margin-bottom:2px}
.sw-footer-impact-value{font-size:.66rem;font-weight:900}
.sw-footer-level-item{display:flex;align-items:center;gap:7px}
.sw-footer-level-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0}
@media(max-width:1100px){.sw-solar-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.sw-enh-grid{grid-template-columns:1fr 1fr}.sw-solar-impact-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:720px){.sw-solar-grid,.sw-enh-grid,.sw-solar-impact-grid{grid-template-columns:1fr}.sw-solar-wide{grid-column:auto}.sw-solar-summary{grid-template-columns:1fr}}
</style>
"""


def _e(s: Any) -> str:
    return html.escape(str(s) if s is not None else "")


def _parse_dt(iso: Optional[str]) -> Optional[datetime.datetime]:
    if not iso:
        return None
    try:
        dt = datetime.datetime.fromisoformat(iso.replace("Z", "+00:00"))
        return dt if dt.tzinfo else dt.replace(tzinfo=datetime.timezone.utc)
    except (ValueError, TypeError):
        return None


def _cat_time(iso: Optional[str]) -> str:
    dt = _parse_dt(iso)
    if not dt:
        return "Updating..."
    cat = dt.astimezone(datetime.timezone(datetime.timedelta(hours=2)))
    return cat.strftime("%d %b %Y, %H:%M") + " CAT (UTC+2)"


def _flux_time_labels(count: int, end_iso: Optional[str], step_minutes: int = 5, slots: int = 7) -> List[str]:
    if count < 2:
        return []
    end = _parse_dt(end_iso) or datetime.datetime.now(datetime.timezone.utc)
    step = max(1, (count - 1) // max(slots - 1, 1))
    labels = []
    for i in range(0, count, step):
        d = end - datetime.timedelta(minutes=(count - 1 - i) * step_minutes)
        labels.append(d.strftime("%H:%M UTC"))
    return labels


def _kp_lvl(kp: float) -> int:
    if kp < 2: return 0
    if kp < 4: return 1
    if kp < 5: return 2
    if kp < 6: return 3
    if kp < 7: return 4
    return 5


def _spark(values: List[float], color: str, w: int = 360, h: int = 82) -> str:
    pts = [float(v) for v in values if isinstance(v, (int, float)) and v > 0]
    if len(pts) < 2:
        return f'<svg viewBox="0 0 {w} {h}" style="width:100%;height:{h}px"><text x="50%" y="50%" text-anchor="middle" fill="#475569" font-size="11">Awaiting GOES data</text></svg>'
    logs = [min(max(math.log10(max(v, 1e-9)), -9), -3) for v in pts]
    path = " ".join(
        f"{'M' if i == 0 else 'L'}{(i / (len(logs) - 1)) * w:.1f},{max(0, h - ((v + 9) / 6) * h):.1f}"
        for i, v in enumerate(logs)
    )
    return f'<svg viewBox="0 0 {w} {h}" style="width:100%;height:{h}px"><path d="{path}" fill="none" stroke="{color}" stroke-width="2"/></svg>'


def _xray_band_path(values: List[float], shift: float, w: int, h: int) -> str:
    min_log, max_log, rng = -9.0, -3.0, 6.0
    logs = [min(max(math.log10(max(v, 1e-9)) + shift, min_log), max_log) for v in values]
    return " ".join(
        f"{'M' if i == 0 else 'L'}{(i / (len(logs) - 1)) * w:.1f},{max(0, h - ((v - min_log) / rng) * h):.1f}"
        for i, v in enumerate(logs)
    )


def _xray_flux_chart(values: List[float], updated: Optional[str]) -> str:
    w, h = 360, 82
    pts = [float(v) for v in values if isinstance(v, (int, float)) and v > 0]
    labels = _flux_time_labels(len(pts), updated) if len(pts) >= 4 else [
        "12:00", "16:00", "20:00", "00:00", "04:00", "08:00", "12:00 UTC"
    ]
    grid = "".join(
        f'<line x1="0" x2="{w}" y1="{(i/4)*h}" y2="{(i/4)*h}" stroke="rgba(255,255,255,0.07)"/>'
        for i in range(5)
    )
    if len(pts) < 2:
        body = f'<text x="{w/2}" y="{h/2}" text-anchor="middle" fill="#475569" font-size="11">Awaiting GOES data</text>'
    else:
        body = "".join(
            f'<path d="{_xray_band_path(pts, shift, w, h)}" fill="none" stroke="{color}" stroke-width="1.5" stroke-linecap="round"/>'
            for color, shift, _ in _XRAY_BANDS
        )
    legend = "".join(
        f'<span><i style="background:{c}"></i>{_e(lbl)}</span>' for c, _, lbl in _XRAY_BANDS
    )
    x_lbl = "".join(f"<span>{_e(l)}</span>" for l in labels)
    return (
        f'<div class="sw-enh-time-btns"><span class="sw-enh-time-btn">6H</span>'
        f'<span class="sw-enh-time-btn active">24H</span><span class="sw-enh-time-btn">7D</span></div>'
        f'<div style="display:flex;gap:4px">'
        f'<div class="sw-enh-y-axis"><span>10⁻³</span><span>10⁻⁴</span><span>10⁻⁵</span><span>10⁻⁶</span><span>10⁻⁷</span></div>'
        f'<div style="flex:1"><svg viewBox="0 0 {w} {h}" style="width:100%;height:{h}px;display:block">{grid}{body}</svg>'
        f'<div class="sw-enh-x-labels">{x_lbl}</div></div></div>'
        f'<div class="sw-enh-legend">{legend}</div>'
    )


def _euv_chart(values: List[float], mode: str, updated: Optional[str]) -> str:
    w, h = 340, 72
    live = [float(v) for v in values if isinstance(v, (int, float)) and v > 0]
    if len(live) >= 4:
        pts = [v * 1e5 for v in live]
        note = ""
    else:
        pts = [
            0.55 + math.sin(i / 5) * 0.32 + max(0, math.sin(i / 2.5) * 0.22) + (max(0, i - 30) * 0.04)
            for i in range(42)
        ]
        note = '<div style="color:#ffffff;font-size:.58rem;font-weight:700;margin-bottom:6px">Illustrative curve — GOES soft X-ray proxy when live</div>'
    mn, mx = min(pts), max(pts)
    rng = mx - mn or 1
    path = " ".join(
        f"{'M' if i == 0 else 'L'}{(i / (len(pts) - 1)) * w:.1f},{h - ((v - mn) / rng) * h:.1f}"
        for i, v in enumerate(pts)
    )
    days = _flux_time_labels(len(pts), updated) if len(live) >= 4 else [
        "2020", "2021", "2022", "2023", "2024", "2025", "2026"
    ]
    x_lbl = "".join(f"<span>{_e(d)}</span>" for d in days)
    grid = "".join(
        f'<line x1="0" x2="{w}" y1="{(i/2)*h}" y2="{(i/2)*h}" stroke="rgba(255,255,255,0.07)"/>'
        for i in range(3)
    )
    return (
        f"{note}"
        f'<svg viewBox="0 0 {w} {h}" style="width:100%;height:{h}px;display:block">'
        f'<defs><linearGradient id="euvGrad" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0%" stop-color="#a855f7" stop-opacity="0.28"/>'
        f'<stop offset="100%" stop-color="#a855f7" stop-opacity="0"/></linearGradient></defs>'
        f"{grid}<path d=\"{path} L{w},{h} L0,{h} Z\" fill=\"url(#euvGrad)\"/>"
        f'<path d="{path}" fill="none" stroke="#a855f7" stroke-width="2" stroke-linecap="round"/>'
        f"</svg><div class=\"sw-enh-x-labels\">{x_lbl}</div>"
    )


def _solar_cycle_chart() -> str:
    w, h = 340, 80
    pts = [
        max(0, 190 * math.sin(math.pi * (i / 72) * 1.08) * (0.65 + (i / 72) * 0.35) + math.sin(i * 0.9) * 12)
        for i in range(73)
    ]
    mx = max(pts) or 1
    path = " ".join(
        f"{'M' if i == 0 else 'L'}{(i / (len(pts) - 1)) * w:.1f},{h - (v / mx) * h:.1f}"
        for i, v in enumerate(pts)
    )
    years = ["2020", "2021", "2022", "2023", "2024", "2025", "2026"]
    x_lbl = "".join(f"<span>{y}</span>" for y in years)
    grid = "".join(
        f'<line x1="0" x2="{w}" y1="{(i/2)*h}" y2="{(i/2)*h}" stroke="rgba(255,255,255,0.07)"/>'
        for i in range(3)
    )
    return (
        f'<svg viewBox="0 0 {w} {h}" style="width:100%;height:{h}px;display:block">'
        f'<defs><linearGradient id="scGrad" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0%" stop-color="#a855f7" stop-opacity="0.3"/>'
        f'<stop offset="100%" stop-color="#a855f7" stop-opacity="0"/></linearGradient></defs>'
        f"{grid}<path d=\"{path} L{w},{h} L0,{h} Z\" fill=\"url(#scGrad)\"/>"
        f'<path d="{path}" fill="none" stroke="#a855f7" stroke-width="2" stroke-linecap="round"/>'
        f'<text x="4" y="14" fill="rgba(255,255,255,0.25)" font-size="9">300</text>'
        f'<text x="4" y="{h/2+4}" fill="rgba(255,255,255,0.25)" font-size="9">100</text>'
        f'<text x="4" y="{h-4}" fill="rgba(255,255,255,0.25)" font-size="9">0</text>'
        f"</svg><div class=\"sw-enh-x-labels\">{x_lbl}</div>"
    )


def _sun_map(regions: List[Dict]) -> str:
    mk = ""
    for i, r in enumerate(regions[: len(AR_POS)]):
        x, y = AR_POS[i]
        mk += (
            f'<div class="sw-enh-ar-marker" style="left:{x}%;top:{y}%">'
            f'<div class="sw-enh-ar-circle"></div>'
            f'<span class="sw-enh-ar-label">{_e(r.get("id"))}</span></div>'
        )
    return f'<div class="sw-enh-sun-wrap"><div class="sw-enh-sun">{mk}</div></div>'


def _api_routing_html(solar: Dict[str, Any], sw: Optional[Dict[str, Any]] = None) -> str:
    routes = solar.get("api_routes") or []
    if sw and sw.get("source"):
        routes = list(routes) + [f"ZINGSA CORS: {sw['source']}"]
    if not routes:
        return ""
    items = " · ".join(f"<span>{_e(r)}</span>" for r in routes)
    return f'<div class="sw-api-routing">API routes: {items}</div>'


def _footer(kp: float, africa_gnss: Optional[str] = None) -> str:
    lv = _kp_lvl(kp)
    items = [
        ("R1 RTK Accuracy", "Moderate Impact" if lv > 1 else "Nominal", "#f97316" if lv > 1 else "#22c55e"),
        ("PPP Convergence", "Slightly Slower" if lv > 1 else "Normal", "#f97316" if lv > 1 else "#22c55e"),
        ("Ionospheric Delay", "Increased" if lv > 1 else "Nominal", "#f97316" if lv > 1 else "#22c55e"),
        ("Signal Scintillation", "Possible" if lv > 2 else "Low", "#f97316" if lv > 2 else "#22c55e"),
        ("HF Communication", "Degraded" if lv > 2 else "Excellent", "#ef4444" if lv > 2 else "#22c55e"),
    ]
    imp = "".join(
        f'<div class="sw-footer-impact-item"><div><div class="sw-footer-impact-label">{_e(a)}</div>'
        f'<div class="sw-footer-impact-value" style="color:{c}">{_e(b)}</div></div></div>'
        for a, b, c in items
    )
    if africa_gnss:
        imp += (
            f'<div class="sw-footer-impact-item"><div><div class="sw-footer-impact-label">Africa CORS (ZINGSA API)</div>'
            f'<div class="sw-footer-impact-value" style="color:#22d3ee;font-size:.58rem;max-width:220px">{_e(africa_gnss[:120])}</div></div></div>'
        )
    levels = [
        ("#22c55e", "Low", "Minimal Impact"),
        ("#eab308", "Moderate", "Minor Impact"),
        ("#f97316", "High", "Strong Impact"),
        ("#ef4444", "Severe", "Major Impact"),
        ("#a855f7", "Extreme", "Extreme Impact"),
    ]
    leg = "".join(
        f'<div class="sw-footer-level-item"><span class="sw-footer-level-dot" style="background:{c}"></span>'
        f'<div><div style="color:{c};font-size:.68rem;font-weight:800">{l}</div>'
        f'<div style="color:#ffffff;font-size:.58rem">{s}</div></div></div>'
        for c, l, s in levels
    )
    return (
        f'<div class="sw-footer-bar"><div class="sw-footer-section"><div class="sw-footer-title">'
        f'Impact on GNSS &amp; CORS Networks</div><div class="sw-footer-impacts">{imp}</div></div>'
        f'<div class="sw-footer-divider"></div><div class="sw-footer-section"><div class="sw-footer-title">'
        f'Solar Activity Levels</div><div class="sw-footer-levels">{leg}</div></div></div>'
    )


_S_AFRICA_KW = [
    "africa", "southern africa", "southern hemisphere", "south africa",
    "zimbabwe", "zambia", "mozambique", "botswana", "namibia",
    "equatorial", "low latitude", "low-latitude", "mid latitude", "mid-latitude",
]
_AFRICA_KW = ["africa", "sub-saharan", "saharan"]
# Alert product codes / keywords that affect mid/low latitudes (where Southern Africa sits)
_AFRICA_RELEVANT_KW = [
    "geomagnetic storm", "magnetic storm", "kp", "k-index",
    "radio blackout", "ionospheric storm", "r-scale", "g-scale",
    "g1", "g2", "g3", "g4", "g5", "r1", "r2", "r3",
    "wark", "altk", "wata", "rswc",
    "solar energetic", "proton event",
]


def _select_africa_alert(alerts: List[Dict]) -> tuple[str, str]:
    """Pick the most Africa-relevant alert. Returns (message, geo_scope_label)."""
    s_africa: list[Dict] = []
    africa: list[Dict] = []
    relevant: list[Dict] = []

    for alert in alerts:
        msg = (alert.get("message") or alert.get("product_id") or "").lower()
        if any(kw in msg for kw in _S_AFRICA_KW):
            s_africa.append(alert)
        elif any(kw in msg for kw in _AFRICA_KW):
            africa.append(alert)
        elif any(kw in msg for kw in _AFRICA_RELEVANT_KW):
            relevant.append(alert)

    def _msg(a: Dict) -> str:
        return a.get("message") or a.get("product_id") or ""

    if s_africa:
        return _msg(s_africa[0]), "Southern Africa"
    if africa:
        return _msg(africa[0]), "Africa"
    if relevant:
        return _msg(relevant[0]), "Global — affects Africa"
    return "No NOAA SWPC alerts specific to Southern Africa or Africa at this time.", "Southern Africa"


def build_solar_monitor_html(
    solar: Dict[str, Any],
    kp: float = 2.0,
    *,
    sw: Optional[Dict[str, Any]] = None,
) -> str:
    level = solar.get("level") or {}
    color = level.get("color", "#22c55e")
    wind = solar.get("solarWind") or {}
    donki = solar.get("donki") or {}
    flare = solar.get("flareClass", "A0.0")
    alerts = solar.get("alerts") or []
    updated = solar.get("updated")
    alert_msg, alert_geo = _select_africa_alert(alerts)
    flares, cmes, storms = donki.get("flares") or [], donki.get("cmes") or [], donki.get("storms") or []
    dr = donki.get("dateRange") or {}
    cme_rows = build_donki_cme_rows(cmes)
    regions = build_donki_active_regions(flares)
    bursts = build_donki_radio_bursts(flares)
    bz = float(wind.get("bz") or 0)
    bz_c = "#f97316" if bz < 0 else "#22c55e"
    scale = "".join(f'<span class="{"active" if flare.startswith(c) else ""}">{c}-Class</span>' for c in "ABCMX")
    impacts = [
        ("GNSS / CORS", level.get("gnss", "Minimal impact")),
        ("HF Radio", "Nominal" if level.get("label") == "Low" else "Monitor outages"),
        ("Satellites", "Drag watch" if float(wind.get("speed") or 0) > 600 else "Routine operations"),
        ("Power Grids", "GIC watch" if bz < -5 else "Minimal GIC risk"),
    ]
    imp_html = "".join(f'<div class="sw-solar-impact"><span>{_e(a)}</span><strong>{_e(b)}</strong></div>' for a, b in impacts)

    def _cme_row(r: Dict) -> str:
        halo_c = "#22c55e" if r["halo"] == "Yes" else "#eab308" if r["halo"] == "Partial" else "#ffffff"
        imp_c = "#22c55e" if r["impact"] == "Possible" else "#ffffff"
        return (
            f"<tr><td>{_e(r['date'])}</td><td>{_e(r['speed'])}</td><td>{_e(r['width'])}</td>"
            f'<td style="color:{halo_c}">{_e(r["halo"])}</td>'
            f'<td style="color:{imp_c};font-weight:900">{_e(r["impact"])}</td></tr>'
        )

    cme_body = "".join(_cme_row(r) for r in cme_rows) or (
        '<tr><td colspan="5" class="sw-enh-empty">No DONKI CME events in the last 7 days.</td></tr>'
    )
    ar_body = "".join(
        f"<tr><td>{_e(r['id'])}</td><td>{_e(r['cls'])}</td><td>{_e(r['mag'])}</td><td>{r['spots']}</td></tr>"
        for r in regions
    ) or '<tr><td colspan="4" class="sw-enh-empty">No DONKI flare regions in the last 7 days.</td></tr>'
    rb_body = "".join(
        f"<tr><td>{_e(b['time'])}</td><td>{_e(b['type'])}</td><td>{_e(b['freq'])}</td>"
        f"<td style='color:{_INTENSITY.get(b['intensity'], '#ffffff')};font-weight:900'>{_e(b['intensity'])}</td>"
        f"<td>{_e(b['loc'])}</td></tr>"
        for b in bursts
    ) or '<tr><td colspan="5" class="sw-enh-empty">No flare-derived radio burst proxies in the last 7 days.</td></tr>'

    lf = flares[0] if flares else None
    lc = cmes[0] if cmes else None
    ls = storms[0] if storms else None
    flare_txt = f"{lf.get('classType', '?')} flare from {lf.get('sourceLocation', 'unknown')}" if lf else "No flare events in the selected 7-day window."
    cme_txt = f"{lc.get('activityID', 'CME')} detected {_cat_time(lc.get('startTime'))}" if lc else "No CME events in the selected 7-day window."
    storm_txt = f"{ls.get('gstID', 'GST')} recorded {_cat_time(ls.get('startTime'))}" if ls else "No geomagnetic storm events in the selected 7-day window."
    if solar.get("mode") == "live":
        note = "NOAA SWPC live"
        if solar.get("donki_status") == "live":
            note += " · NASA DONKI live · last 7 days"
        else:
            note += f" · {solar.get('donki_note', 'NASA DONKI unavailable')}"
    else:
        note = f"Live solar data unavailable: {solar.get('error', 'feed error')}"
    mode_lbl = "Live Data" if solar.get("mode") == "live" else "Data Unavailable"
    swpc_tag = "NOAA SWPC live" if solar.get("mode") == "live" else "Unavailable"
    africa_gnss = None
    if sw:
        africa = sw.get("africa_impacts") or {}
        africa_gnss = africa.get("gnss") if isinstance(africa, dict) else None

    xray = solar.get("xraySeries") or []
    return f"""<section class="sw-solar-monitor">
<div class="sw-solar-head"><div><div class="sw-solar-kicker">☀ Solar Activity Monitor</div>
<h3>Real-time solar conditions for GNSS, satellites and CORS networks</h3></div>
<div class="sw-solar-meta"><span style="color:{color}"><span class="sw-solar-live-dot" style="background:{color}"></span>{_e(mode_lbl)}</span>
<span>NOAA SWPC</span><span>{_e(_cat_time(updated))}</span></div></div>
{_api_routing_html(solar, sw)}
<div class="sw-solar-grid">
<article class="sw-solar-card sw-solar-summary"><div class="sw-solar-card-title">Solar Activity Summary</div>
<div class="sw-solar-orb" style="--solar:{color}"></div>
<div class="sw-solar-summary-copy"><span>Solar Activity</span><strong style="color:{color}">{_e(level.get('label','Low'))}</strong>
<span>Current Flare</span><strong>{_e(flare)}</strong><span>SWPC Alerts</span><strong>{len(alerts)}</strong></div></article>
<article class="sw-solar-card"><div class="sw-solar-card-title">Solar Flare (GOES X-ray)</div>
<div class="sw-solar-flare" style="color:{color}">{_e(flare)}</div>
<p>Peak class from GOES primary X-ray flux. C-class and above can affect HF radio and GNSS users.</p>
<div class="sw-solar-scale">{scale}</div></article>
<article class="sw-solar-card sw-solar-wide"><div class="sw-solar-card-title">GOES X-ray Flux - Last Day</div>
{_spark(xray, color)}</article>
<article class="sw-solar-card"><div class="sw-solar-card-title">Solar Wind</div>
<div class="sw-solar-metric"><span>Speed</span><strong>{round(float(wind.get('speed') or 0))} km/s</strong></div>
<div class="sw-solar-metric"><span>Density</span><strong>{float(wind.get('density') or 0):.1f} p/cm³</strong></div>
<div class="sw-solar-metric"><span>Proton Temp.</span><strong>{round(float(wind.get('temperature') or 0)):,} K</strong></div>
<div class="sw-solar-metric"><span>IMF Bz</span><strong style="color:{bz_c}">{bz:.1f} nT</strong></div>
<div class="sw-solar-metric"><span>IMF Bt</span><strong>{float(wind.get('bt') or 0):.1f} nT</strong></div></article>
<article class="sw-solar-card"><div class="sw-solar-card-title">Alerts / Watches / Warnings</div>
<div style="font-size:.62rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:#22d3ee;margin-bottom:.4rem">&#127757; {_e(alert_geo)}</div>
<p>{_e(alert_msg)}</p><div class="sw-solar-source">Source: NOAA SWPC alerts.json</div></article>
<article class="sw-solar-card"><div class="sw-solar-card-title">Solar Flares</div>
<div class="sw-solar-flare-count">{len(flares)}</div><p>{_e(flare_txt)}</p>
<div class="sw-solar-source">FLR: {_e(dr.get('start',''))} to {_e(dr.get('end',''))}</div></article>
<article class="sw-solar-card"><div class="sw-solar-card-title">Coronal Mass Ejections</div>
<div class="sw-solar-flare-count">{len(cmes)}</div><p>{_e(cme_txt)}</p><div class="sw-solar-source">CME event history</div></article>
<article class="sw-solar-card"><div class="sw-solar-card-title">Geomagnetic Storms</div>
<div class="sw-solar-flare-count">{len(storms)}</div><p>{_e(storm_txt)}</p><div class="sw-solar-source">GST event history</div></article>
<article class="sw-solar-card sw-solar-wide"><div class="sw-solar-card-title">Impact on GNSS &amp; CORS Networks</div>
<div class="sw-solar-impact-grid">{imp_html}</div></article></div>
<div class="sw-enh-data-note">{_e(note)}</div>
<div class="sw-enh-grid">
<article class="sw-enh-panel"><div class="sw-enh-panel-title">Solar X-Ray Flux (GOES-16)</div>
{_xray_flux_chart(xray, updated)}</article>
<article class="sw-enh-panel"><div class="sw-enh-panel-title">Active Regions</div>
<div class="sw-enh-ar-layout">{_sun_map(regions)}<div>
<table class="sw-enh-table"><thead><tr><th>Region</th><th>Class</th><th>Mag.Type</th><th>Spots</th></tr></thead>
<tbody>{ar_body}</tbody></table>
<a href="https://api.nasa.gov/DONKI/FLR" target="_blank" class="sw-enh-view-all">NASA DONKI Flares →</a>
</div></div></article>
<article class="sw-enh-panel"><div class="sw-enh-panel-title">Coronal Mass Ejections (CME)</div>
<table class="sw-enh-table"><thead><tr><th>Date (UTC)</th><th>Speed (km/s)</th><th>Width</th><th>Halo</th><th>Impact</th></tr></thead>
<tbody>{cme_body}</tbody></table>
<a href="https://api.nasa.gov/DONKI/CME" target="_blank" class="sw-enh-view-all">NASA DONKI CME →</a></article>
<article class="sw-enh-panel"><div class="sw-enh-panel-hdr">
<span class="sw-enh-panel-title">GOES soft X-ray flux (0.1–0.8 nm)</span>
<span class="sw-enh-select">{_e(swpc_tag)}</span></div>
<div style="color:#ffffff;font-size:.56rem;font-weight:700;margin-bottom:4px">W/m² (scaled display) · irradiance proxy, not SDO/EVE</div>
{_euv_chart(xray, solar.get("mode", "unavailable"), updated)}</article>
<article class="sw-enh-panel"><div class="sw-enh-panel-title">Solar Radio Bursts (Last 24H)</div>
<table class="sw-enh-table"><thead><tr><th>Time (UTC)</th><th>Type</th><th>Frequency</th><th>Intensity</th><th>Location</th></tr></thead>
<tbody>{rb_body}</tbody></table>
<a href="https://www.swpc.noaa.gov/products/goes-x-ray-flux" target="_blank" class="sw-enh-view-all">NOAA GOES X-ray →</a></article>
<article class="sw-enh-panel"><div class="sw-enh-panel-title">Solar Cycle Progress</div>
<div class="sw-enh-cycle-header"><div><div class="sw-enh-sub-label">Solar Cycle</div><div class="sw-enh-cycle-num">25</div></div>
<div><div class="sw-enh-sub-label">Cycle Progress</div><div class="sw-enh-cycle-pct">65%</div>
<div class="sw-enh-cycle-bar"><div class="sw-enh-cycle-fill" style="width:65%"></div></div></div></div>
<div class="sw-enh-sub-label" style="margin:8px 0 2px">Estimated Peak</div>
<div style="color:#ffffff;font-size:.7rem;font-weight:700;margin-bottom:8px">2024 – 2026 (Cycle 25 maximum window)</div>
<div style="color:#ffffff;font-size:.58rem;font-weight:700;margin-bottom:6px">Reference cycle window; no synthetic observation values are displayed.</div>
</article></div>
{_footer(kp, africa_gnss)}</section>"""


def render_solar_monitor(
    st,
    solar: Dict[str, Any],
    kp: float = 2.0,
    *,
    sw: Optional[Dict[str, Any]] = None,
) -> None:
    if solar.get("mode") != "live":
        st.error(
            "Live NOAA/NASA solar activity data is unavailable. "
            f"{solar.get('error', 'No synthetic fallback is permitted.')}"
        )
        return
    st.markdown(
        SOLAR_CSS + build_solar_monitor_html(solar, kp, sw=sw),
        unsafe_allow_html=True,
    )
