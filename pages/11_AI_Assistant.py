"""ZGIIS — AI Ionosphere Assistant (Ask TEC AI)."""
from __future__ import annotations

import os
import sys
from pathlib import Path

import pandas as pd
import streamlit as st

root = Path(__file__).resolve().parents[1]
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from zgiis.ai.assistant import chat
from zgiis.space_weather.fetch_indices import get_space_weather
from zgiis.theme import inject

st.set_page_config(page_title="ZGIIS — AI Assistant", page_icon="🤖", layout="wide")
inject(st)

# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("### 🤖 Ask TEC AI")
    api_key = st.text_input(
        "Anthropic API Key",
        value=os.environ.get("ANTHROPIC_API_KEY", ""),
        type="password",
        help="Set ANTHROPIC_API_KEY env var or paste it here.",
    )
    use_context = st.checkbox("Inject live TEC + space weather context", value=True)
    st.divider()
    st.markdown("**Suggested Questions**")
    suggested = [
        "What does a VTEC of 35 TECU mean for RTK accuracy?",
        "Why is TEC highest around 14:00 local time?",
        "How does a geomagnetic storm affect GNSS positioning?",
        "What is the Equatorial Ionospheric Anomaly?",
        "What Kp level causes RTK to fail?",
        "How does solar cycle 25 affect Zimbabwe TEC?",
        "What is cycle slip and how is it detected?",
        "Explain STEC vs VTEC and the mapping function.",
    ]
    for q in suggested:
        if st.button(q, key=f"sugg_{q[:30]}", use_container_width=True):
            st.session_state.setdefault("zgiis_chat", [])
            st.session_state["zgiis_chat"].append({"role": "user", "content": q})
            st.session_state["_pending_send"] = True
    st.divider()
    if st.button("🗑️ Clear chat history"):
        st.session_state["zgiis_chat"] = []
    st.divider()
    st.page_link("Home.py", label="← Back to Home")

# ── Header ────────────────────────────────────────────────────────────────────
st.markdown("<div class='zgiis-title' style='font-size:1.7rem'>🤖 Ask TEC AI</div>", unsafe_allow_html=True)
st.caption("Powered by Anthropic Claude — your expert GNSS ionosphere assistant")
st.markdown("---")

# ── Context panel ─────────────────────────────────────────────────────────────
if use_context:
    sw = get_space_weather()
    df: pd.DataFrame = st.session_state.get("zgiis_df", pd.DataFrame())
    tec_summary = None
    if not df.empty and "vtec" in df.columns:
        tec_summary = {
            "station":  df["station"].iloc[0] if "station" in df.columns else "N/A",
            "mean_vtec": float(df["vtec"].mean()),
            "max_vtec":  float(df["vtec"].max()),
            "samples":   len(df),
        }
    ctx_parts = []
    if tec_summary:
        ctx_parts.append(
            f"📡 TEC data: station={tec_summary['station']}, "
            f"mean VTEC={tec_summary['mean_vtec']:.1f} TECU, "
            f"max={tec_summary['max_vtec']:.1f} TECU"
        )
    ctx_parts.append(
        f"☀️ Space weather: Kp={sw['kp']}, {sw['kp_condition']}, "
        f"F10.7={sw['f107']} sfu, GNSS risk={sw['gnss_risk']}"
    )
    c1, c2 = st.columns(2)
    with c1:
        st.markdown(
            f"<div class='zgiis-card zgiis-card-ok'>"
            f"<div style='font-size:0.78rem;color:#ffffff;text-transform:uppercase;"
            f"letter-spacing:0.07em;margin-bottom:0.2rem'>Context injected into AI</div>"
            f"<div style='font-size:0.8rem;color:#ffffff;margin-top:4px'>"
            + "<br>".join(ctx_parts) +
            f"</div></div>",
            unsafe_allow_html=True,
        )
    with c2:
        st.markdown(
            "<div class='zgiis-card'>"
            "<div style='font-size:0.78rem;color:#ffffff;text-transform:uppercase;"
            "letter-spacing:0.07em;margin-bottom:0.2rem'>About Ask TEC AI</div>"
            "<div style='font-size:0.8rem;color:#ffffff;margin-top:4px'>"
            "Expert answers on TEC anomalies · space weather effects · "
            "GNSS accuracy · ionospheric physics · Zimbabwe CORS network · "
            "RINEX processing · RTK/PPP performance.</div>"
            "</div>",
            unsafe_allow_html=True,
        )
else:
    sw = {}
    tec_summary = None

st.markdown("---")

# ── Chat interface ────────────────────────────────────────────────────────────
if "zgiis_chat" not in st.session_state:
    st.session_state["zgiis_chat"] = []

messages: list[dict] = st.session_state["zgiis_chat"]

# Welcome message
if not messages:
    st.markdown(
        "<div class='zgiis-card zgiis-card-accent'>"
        "<b>👋 Welcome to Ask TEC AI!</b><br>"
        "<div style='font-size:0.85rem;color:#ffffff;margin-top:4px'>"
        "I'm your ZGIIS ionosphere expert. Ask me anything about TEC, space weather, "
        "GNSS positioning, RINEX files, the Zimbabwe CORS network, or the Equatorial "
        "Ionospheric Anomaly. Use the suggested questions in the sidebar to get started.</div>"
        "</div>",
        unsafe_allow_html=True,
    )

# Render chat history
for msg in messages:
    if msg["role"] == "user":
        with st.chat_message("user"):
            st.markdown(msg["content"])
    else:
        with st.chat_message("assistant", avatar="🛰️"):
            st.markdown(msg["content"])

# Input box
user_input = st.chat_input("Ask about TEC, space weather, GNSS accuracy, Zimbabwe ionosphere...")

# Handle sidebar suggestion buttons
if st.session_state.pop("_pending_send", False) and messages and messages[-1]["role"] == "user":
    user_input = None  # let the block below handle it via the last message

if user_input:
    messages.append({"role": "user", "content": user_input})
    with st.chat_message("user"):
        st.markdown(user_input)

# Generate response if last message is from user
if messages and messages[-1]["role"] == "user":
    with st.chat_message("assistant", avatar="🛰️"):
        with st.spinner("Thinking..."):
            response = chat(
                messages=messages,
                tec_summary=tec_summary if use_context else None,
                sw=sw if use_context else None,
                api_key=api_key or None,
            )
        st.markdown(response)
    messages.append({"role": "assistant", "content": response})
    st.session_state["zgiis_chat"] = messages

# ── Quick export of chat ──────────────────────────────────────────────────────
if messages:
    st.markdown("---")
    transcript = "\n\n".join(
        f"{'USER' if m['role']=='user' else 'TEC AI'}: {m['content']}"
        for m in messages
    )
    st.download_button(
        "⬇ Export chat transcript",
        transcript.encode(),
        "tec_ai_chat.txt",
        "text/plain",
    )
