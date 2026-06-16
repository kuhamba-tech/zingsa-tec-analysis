"""ZGIIS — CORS Network Hardware Specifications."""
from __future__ import annotations

import sys
from pathlib import Path

import streamlit as st

root = Path(__file__).resolve().parents[1]
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from zgiis.cors.signal_flow import equipment_image_uri, render_signal_flow
from zgiis.theme import inject

st.set_page_config(
    page_title="ZGIIS — CORS Hardware",
    page_icon="📡",
    layout="wide",
)
inject(st, page_id="cors_hardware")

# ── Hero banner ───────────────────────────────────────────────────────────────
st.markdown(
    """
    <div style='background:linear-gradient(135deg,#000000 0%,#000000 50%,#000000 100%);
                border:1px solid #244d73;border-left:5px solid #168bd2;border-radius:14px;
                padding:2rem 2.2rem;margin-bottom:1.5rem'>
      <div style='font-size:0.72rem;color:#168bd2;font-weight:800;letter-spacing:0.12em;
                  text-transform:uppercase;margin-bottom:0.4rem'>ZINGSA CORS NETWORK</div>
      <div style='font-size:2rem;font-weight:900;color:#ffffff;line-height:1.2;
                  margin-bottom:0.6rem'>📡 Station Hardware Specification</div>
      <div style='font-size:0.95rem;color:#ffffff;opacity:0.85;max-width:680px;line-height:1.6'>
        Each Zimbabwe CORS station is equipped with Leica geodetic-grade GNSS hardware
        providing centimetre-level positioning and continuous multi-constellation observation
        for ionospheric research and RTK/PPP correction services.
      </div>
    </div>
    """,
    unsafe_allow_html=True,
)

# ── Equipment cards ───────────────────────────────────────────────────────────
st.markdown(
    "<div style='font-size:0.72rem;color:#168bd2;font-weight:800;letter-spacing:0.12em;"
    "text-transform:uppercase;margin-bottom:1rem'>Station Equipment</div>",
    unsafe_allow_html=True,
)

hw_c1, hw_c2, hw_c3 = st.columns(3)

# ── Card helper ───────────────────────────────────────────────────────────────
def _hw_card(
    col,
    icon: str,
    model: str,
    category: str,
    accent: str,
    specs: list[tuple[str, str]],
    desc: str,
    *,
    image_names: tuple[str, ...] = (),
):
    with col:
        img_uri = equipment_image_uri(root, *image_names) if image_names else None
        if img_uri:
            visual = (
                f"<div style='text-align:center;margin-bottom:0.35rem;"
                f"background:linear-gradient(165deg,#f1f5f9,#e2e8f0);"
                f"border-radius:10px;padding:0.55rem;border:1px solid #334155'>"
                f"<img src='{img_uri}' alt='{model}' "
                f"style='width:100%;max-width:150px;height:110px;object-fit:contain;"
                f"display:block;margin:0 auto'/>"
                f"</div>"
            )
        else:
            visual = f"<div style='text-align:center;font-size:3.2rem;margin-bottom:0.4rem'>{icon}</div>"

        rows = "".join(
            f"<tr><td style='color:#ffffff;padding:0.28rem 0.5rem 0.28rem 0;font-size:0.75rem;"
            f"white-space:nowrap'>{k}</td>"
            f"<td style='color:#ffffff;padding:0.28rem 0;font-size:0.75rem;font-weight:600'>{v}</td></tr>"
            for k, v in specs
        )
        st.markdown(
            f"<div style='background:#000000;border:1px solid #244d73;"
            f"border-top:4px solid {accent};border-radius:12px;padding:1.4rem 1.3rem;"
            f"height:100%;display:flex;flex-direction:column;gap:0.8rem'>"
            f"<div style='text-align:center'>"
            f"{visual}"
            f"<div style='font-size:1.25rem;font-weight:900;color:#ffffff;line-height:1.2'>"
            f"{model}</div>"
            f"<div style='font-size:0.7rem;color:{accent};text-transform:uppercase;"
            f"letter-spacing:0.1em;font-weight:700;margin-top:0.2rem'>{category}</div>"
            f"</div>"
            f"<div style='border-top:1px solid #244d73'></div>"
            f"<div style='font-size:0.8rem;color:#ffffff;line-height:1.55'>{desc}</div>"
            f"<table style='border-collapse:collapse;width:100%;margin-top:0.3rem'>{rows}</table>"
            f"</div>",
            unsafe_allow_html=True,
        )

_hw_card(
    hw_c1,
    icon="🖥️",
    model="Leica GR50",
    category="GNSS Receiver",
    accent="#168bd2",
    image_names=("gr50", "receiver"),
    desc=(
        "Professional reference station receiver with SmartTrack+ technology. "
        "Supports all current and planned GNSS constellations with up to 555 channels "
        "for uninterrupted continuous operation."
    ),
    specs=[
        ("Constellations", "GPS · GLONASS · Galileo · BeiDou"),
        ("Channels",       "555 universal"),
        ("Frequencies",    "L1 · L2 · L5 / E1 · E5a · E5b"),
        ("Position acc.",  "H: 3 mm + 0.1 ppm / V: 3.5 mm"),
        ("Data rate",      "Up to 100 Hz"),
        ("Storage",        "8 GB internal flash"),
        ("Power",          "9 – 36 V DC · PoE"),
        ("Connectivity",   "Ethernet · RS232 · USB"),
    ],
)

_hw_card(
    hw_c2,
    icon="🔵",
    model="Leica AR10",
    category="Geodetic Antenna",
    accent="#00ff88",
    image_names=("ar10", "antenna"),
    desc=(
        "High-performance geodetic choke-ring-free antenna. "
        "Hemispherical radome protects the element while maintaining "
        "phase centre stability across all tracked frequencies."
    ),
    specs=[
        ("Type",            "Geodetic, multi-frequency"),
        ("Constellations",  "GPS · GLONASS · Galileo · BeiDou"),
        ("Frequencies",     "L1 · L2 · L5"),
        ("Phase centre",    "< 1 mm repeatability"),
        ("Gain",            "> 0 dBic at 10° elevation"),
        ("Axial ratio",     "< 3 dB (zenith)"),
        ("Cable",           "TNC female connector"),
        ("Protection",      "IP67 rated"),
    ],
)

_hw_card(
    hw_c3,
    icon="🟢",
    model="Leica AR20",
    category="Choke Ring Antenna",
    accent="#ff8c00",
    image_names=("ar20", "antenna"),
    desc=(
        "Geodetic choke ring antenna providing superior multipath rejection. "
        "The concentric ring ground plane suppresses low-elevation multipath signals, "
        "critical for reference station accuracy in the equatorial ionosphere."
    ),
    specs=[
        ("Type",            "Choke ring, geodetic"),
        ("Constellations",  "GPS · GLONASS · Galileo"),
        ("Frequencies",     "L1 · L2 · L5"),
        ("Multipath rej.",  "< -40 dB (ground plane)"),
        ("Phase centre",    "< 0.5 mm stability"),
        ("Elevation mask",  "0° – 90°"),
        ("Cable",           "TNC female connector"),
        ("Protection",      "IP67 rated"),
    ],
)

st.markdown("<div style='margin-top:1.4rem'></div>", unsafe_allow_html=True)

# ── Station architecture diagram ──────────────────────────────────────────────
st.markdown("---")
st.markdown(
    "<div style='font-size:0.72rem;color:#168bd2;font-weight:800;letter-spacing:0.12em;"
    "text-transform:uppercase;margin-bottom:1rem'>Typical Station Architecture</div>",
    unsafe_allow_html=True,
)

render_signal_flow(st, root)

st.markdown("<div style='margin-top:1.2rem'></div>", unsafe_allow_html=True)


def _req_card(col, title: str, accent: str, lines: list[str]) -> None:
    body = "<br>".join(lines)
    with col:
        st.markdown(
            f"<div style='background:#000000;border-left:3px solid {accent};"
            f"border-radius:6px;padding:0.85rem 1rem;height:100%'>"
            f"<div style='font-size:0.72rem;color:{accent};font-weight:700;"
            f"text-transform:uppercase;letter-spacing:0.06em'>{title}</div>"
            f"<div style='font-size:0.82rem;color:#ffffff;margin-top:0.35rem;line-height:1.5'>"
            f"{body}</div></div>",
            unsafe_allow_html=True,
        )


st.markdown(
    "<div style='background:#000000;border:1px solid #244d73;border-radius:12px;"
    "padding:1.5rem;margin-bottom:0.5rem'>"
    "<div style='color:#168bd2;font-weight:800;font-size:0.78rem;letter-spacing:0.08em;"
    "text-transform:uppercase;margin-bottom:1rem'>Station Requirements</div>",
    unsafe_allow_html=True,
)
req_c1, req_c2, req_c3, req_c4 = st.columns(4)
_req_card(req_c1, "Power", "#168bd2", [
    "220 V AC with UPS backup",
    "PoE option for GR50 (802.3af)",
])
_req_card(req_c2, "Connectivity", "#00ff88", [
    "Ethernet / fibre to CORS server",
    "4G/LTE fallback modem",
])
_req_card(req_c3, "Mounting", "#ff8c00", [
    "Reinforced concrete pillar",
    "Forced-centring tribrach",
])
_req_card(req_c4, "Data Output", "#a78bfa", [
    "RINEX 2 / 3 · CMN",
    "RTCM 3.x via NTRIP",
])
st.markdown("</div>", unsafe_allow_html=True)

# ── Summary metrics strip ─────────────────────────────────────────────────────
st.markdown("---")
st.markdown(
    "<div style='font-size:0.72rem;color:#168bd2;font-weight:800;letter-spacing:0.12em;"
    "text-transform:uppercase;margin-bottom:1rem'>Network Capability Summary</div>",
    unsafe_allow_html=True,
)

mc1, mc2, mc3, mc4, mc5 = st.columns(5)
for _col, _icon, _val, _lbl, _clr in [
    (mc1, "🛰️", "4",         "GNSS\nConstellations", "#168bd2"),
    (mc2, "📶", "555",        "Tracking\nChannels",   "#00ff88"),
    (mc3, "⚡", "100 Hz",    "Max Data\nRate",        "#ff8c00"),
    (mc4, "📏", "3 mm",      "Position\nAccuracy",    "#a78bfa"),
    (mc5, "🔒", "IP67",      "Weather\nProtection",   "#f472b6"),
]:
    with _col:
        st.markdown(
            f"<div style='background:#000000;border:1px solid #244d73;"
            f"border-top:3px solid {_clr};border-radius:10px;padding:1rem;"
            f"text-align:center'>"
            f"<div style='font-size:1.6rem'>{_icon}</div>"
            f"<div style='font-size:1.5rem;font-weight:900;color:{_clr};line-height:1.1'>{_val}</div>"
            f"<div style='font-size:0.68rem;color:#ffffff;text-transform:uppercase;"
            f"letter-spacing:0.07em;margin-top:0.3rem;white-space:pre-line'>{_lbl}</div>"
            f"</div>",
            unsafe_allow_html=True,
        )

st.markdown("<div style='margin-bottom:1rem'></div>", unsafe_allow_html=True)
st.caption("Equipment: Leica Geosystems · ZINGSA Zimbabwe National CORS Network · ZGIIS v1.0")
