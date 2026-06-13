"""ZGIIS — Satellite PRN Explorer."""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

root = Path(__file__).resolve().parents[1]
if str(root) not in sys.path:
    sys.path.insert(0, str(root))

from zgiis.theme import inject

st.set_page_config(page_title="ZGIIS — PRN Explorer", page_icon="🛸", layout="wide")
inject(st)

# ── Constellation definitions ─────────────────────────────────────────────────
CONSTELLATIONS = {
    "GPS":     {"prefix": "G", "max_prn": 32,  "color": "#00d4ff"},
    "Galileo": {"prefix": "E", "max_prn": 36,  "color": "#00ff88"},
    "BeiDou":  {"prefix": "C", "max_prn": 63,  "color": "#ff8c00"},
    "GLONASS": {"prefix": "R", "max_prn": 24,  "color": "#cc44ff"},
}


def _generate_prn_list(prefix: str, max_prn: int) -> list[str]:
    return [f"{prefix}{i:02d}" for i in range(1, max_prn + 1)]


def _demo_prn_df() -> pd.DataFrame:
    """Generate demo per-satellite TEC data."""
    rng = np.random.default_rng(99)
    rows = []
    hours = np.arange(0, 24, 0.5)
    for const, cfg in CONSTELLATIONS.items():
        for prn_n in range(1, min(cfg["max_prn"] + 1, 10)):
            prn = f"{cfg['prefix']}{prn_n:02d}"
            for h in hours:
                elev  = max(5, 45 + 35 * np.sin(2 * np.pi * (h - 6) / 12) + rng.normal(0, 8))
                az    = (h / 24 * 360 + prn_n * 30) % 360
                stec  = max(2, 22 + 8 * np.cos(np.deg2rad(90 - elev)) + rng.normal(0, 1.5))
                vtec  = stec * np.sin(np.deg2rad(elev)) / 1.2
                qual  = min(100, max(0, 85 + (elev - 30) / 2 + rng.normal(0, 5)))
                rows.append({
                    "time_hours": h, "prn": prn, "constellation": const,
                    "elevation": elev, "azimuth": az,
                    "stec": stec, "vtec": vtec, "quality_pct": qual,
                })
    return pd.DataFrame(rows)


# ── Load data ─────────────────────────────────────────────────────────────────
df = st.session_state.get("zgiis_df", pd.DataFrame())
using_demo = df.empty or "elevation" not in df.columns
if using_demo:
    df = _demo_prn_df()
    st.info("Showing demo PRN data. Run **⚙️ Processing** to load your RINEX files.")

if "constellation" not in df.columns:
    df["constellation"] = "GPS"
if "quality_pct" not in df.columns:
    df["quality_pct"] = 80.0
if "azimuth" not in df.columns:
    df["azimuth"] = 0.0

# ── Sidebar ───────────────────────────────────────────────────────────────────
with st.sidebar:
    st.markdown("### 🛸 PRN Explorer Controls")
    sel_const = st.multiselect(
        "Constellation", list(CONSTELLATIONS.keys()),
        default=["GPS", "Galileo"],
    )
    filtered_prns_available = sorted(df[df["constellation"].isin(sel_const)]["prn"].dropna().unique()) if sel_const else []
    sel_prns = st.multiselect("Satellite PRNs", filtered_prns_available,
                              default=filtered_prns_available[:6])
    elev_thresh = st.slider("Elevation mask (°)", 0, 45, 10)
    st.divider()
    st.page_link("Home.py", label="← Back to Home")

st.markdown("<div class='zgiis-title' style='font-size:1.7rem'>🛸 Satellite PRN Explorer</div>", unsafe_allow_html=True)
st.caption("GPS · Galileo · BeiDou · GLONASS — per-satellite TEC and geometry analysis")
st.markdown("---")

# ── Constellation summary cards ───────────────────────────────────────────────
cols = st.columns(4)
for i, (cname, ccfg) in enumerate(CONSTELLATIONS.items()):
    with cols[i]:
        prns_in_data = df[df["constellation"] == cname]["prn"].nunique()
        st.markdown(
            f"<div class='zgiis-card' style='border-left:3px solid {ccfg['color']}'>"
            f"<div style='font-weight:700;color:{ccfg['color']}'>{cname}</div>"
            f"<div class='big-metric' style='font-size:1.5rem'>{prns_in_data}</div>"
            f"<div class='metric-label'>satellites in data</div>"
            f"<div style='font-size:0.75rem;color:#446688;margin-top:3px'>"
            f"{ccfg['prefix']}01–{ccfg['prefix']}{ccfg['max_prn']:02d}</div>"
            f"</div>",
            unsafe_allow_html=True,
        )

st.markdown("---")

# ── Filter ────────────────────────────────────────────────────────────────────
fdf = df.copy()
if sel_const:
    fdf = fdf[fdf["constellation"].isin(sel_const)]
if sel_prns:
    fdf = fdf[fdf["prn"].isin(sel_prns)]
fdf = fdf[fdf["elevation"] >= elev_thresh]

if fdf.empty:
    st.warning("No data after filtering.")
    st.stop()

tab1, tab2, tab3, tab4 = st.tabs(["VTEC by PRN", "Sky Plot", "Elevation vs TEC", "Quality Analysis"])

# ── Tab 1: VTEC time series per PRN ──────────────────────────────────────────
with tab1:
    time_col = "time_hours" if "time_hours" in fdf.columns else "date"
    fig = px.line(
        fdf, x=time_col, y="vtec", color="prn",
        labels={"vtec": "VTEC (TECU)", time_col: "Time (h)" if time_col == "time_hours" else "Date"},
        title="VTEC Time Series by Satellite PRN",
    )
    fig.update_layout(paper_bgcolor="#060d1a", plot_bgcolor="#0d1b2a",
                      font_color="#b0c8e8", yaxis=dict(gridcolor="#1e3a5f"),
                      xaxis=dict(gridcolor="#1e3a5f"), height=380,
                      legend=dict(bgcolor="#0d1b2a", bordercolor="#1e3a5f"))
    st.plotly_chart(fig, use_container_width=True)

    # PRN summary table
    prn_summary = (
        fdf.groupby(["constellation", "prn"])
        .agg(mean_vtec=("vtec","mean"), max_vtec=("vtec","max"),
             mean_stec=("stec","mean"), mean_elev=("elevation","mean"),
             mean_qual=("quality_pct","mean"), obs=("vtec","count"))
        .reset_index()
        .round(2)
        .sort_values(["constellation","prn"])
    )
    st.dataframe(prn_summary, use_container_width=True)

# ── Tab 2: Sky plot (polar) ───────────────────────────────────────────────────
with tab2:
    st.caption("Satellite tracks on the sky dome — azimuth × elevation")
    fig_sky = go.Figure()
    for prn, grp in fdf.groupby("prn"):
        const = grp["constellation"].iloc[0]
        color = CONSTELLATIONS.get(const, {}).get("color", "#88aacc")
        r = 90 - grp["elevation"]  # distance from zenith
        fig_sky.add_trace(go.Scatterpolar(
            r=r, theta=grp["azimuth"],
            mode="markers+lines",
            marker=dict(size=5, color=color, opacity=0.8),
            line=dict(color=color, width=1, dash="dot"),
            name=prn,
            hovertemplate=f"{prn}<br>El: %{{r:.1f}}° Az: %{{theta:.1f}}°<extra></extra>",
        ))
    fig_sky.update_layout(
        polar=dict(
            bgcolor="#0d1b2a",
            radialaxis=dict(range=[0, 90], tickvals=[0,30,60,90],
                            ticktext=["90°","60°","30°","0°"],
                            gridcolor="#1e3a5f", color="#6888aa"),
            angularaxis=dict(direction="clockwise", rotation=90,
                             gridcolor="#1e3a5f", color="#6888aa",
                             tickvals=[0,45,90,135,180,225,270,315],
                             ticktext=["N","NE","E","SE","S","SW","W","NW"]),
        ),
        paper_bgcolor="#060d1a",
        font_color="#b0c8e8",
        showlegend=True,
        legend=dict(bgcolor="#0d1b2a", bordercolor="#1e3a5f"),
        height=480,
        title="Sky Plot — Satellite Tracks",
    )
    st.plotly_chart(fig_sky, use_container_width=True)

# ── Tab 3: Elevation vs TEC scatter ──────────────────────────────────────────
with tab3:
    fig_elev = px.scatter(
        fdf, x="elevation", y="stec", color="prn", opacity=0.6,
        labels={"elevation": "Elevation (°)", "stec": "STEC (TECU)"},
        title="Slant TEC vs Elevation — mapping function visible as hyperbolic trend",
    )
    fig_elev.update_layout(paper_bgcolor="#060d1a", plot_bgcolor="#0d1b2a",
                           font_color="#b0c8e8", yaxis=dict(gridcolor="#1e3a5f"),
                           xaxis=dict(gridcolor="#1e3a5f"), height=380,
                           legend=dict(bgcolor="#0d1b2a", bordercolor="#1e3a5f"))
    st.plotly_chart(fig_elev, use_container_width=True)

    fig_vtec_el = px.scatter(
        fdf, x="elevation", y="vtec", color="constellation", opacity=0.6,
        labels={"elevation": "Elevation (°)", "vtec": "VTEC (TECU)"},
        title="Vertical TEC vs Elevation (should flatten with good mapping)",
        color_discrete_map={c: CONSTELLATIONS[c]["color"] for c in CONSTELLATIONS},
    )
    fig_vtec_el.update_layout(paper_bgcolor="#060d1a", plot_bgcolor="#0d1b2a",
                              font_color="#b0c8e8", yaxis=dict(gridcolor="#1e3a5f"),
                              xaxis=dict(gridcolor="#1e3a5f"), height=320,
                              legend=dict(bgcolor="#0d1b2a", bordercolor="#1e3a5f"))
    st.plotly_chart(fig_vtec_el, use_container_width=True)

# ── Tab 4: TEC arc quality ────────────────────────────────────────────────────
with tab4:
    qual_summary = (
        fdf.groupby(["constellation","prn"])["quality_pct"]
        .mean().reset_index()
        .rename(columns={"quality_pct": "arc_quality_pct"})
        .sort_values("arc_quality_pct", ascending=True)
    )
    fig_q = px.bar(
        qual_summary, x="arc_quality_pct", y="prn", orientation="h",
        color="arc_quality_pct",
        color_continuous_scale=[[0,"#ff4444"],[0.5,"#ff8c00"],[1,"#00ff88"]],
        labels={"arc_quality_pct": "Arc Quality (%)", "prn": "Satellite PRN"},
        title="TEC Arc Quality by Satellite",
    )
    fig_q.update_layout(paper_bgcolor="#060d1a", plot_bgcolor="#0d1b2a",
                        font_color="#b0c8e8", yaxis=dict(gridcolor="#1e3a5f"),
                        xaxis=dict(gridcolor="#1e3a5f", range=[0, 100]),
                        height=max(300, 20 * len(qual_summary)),
                        coloraxis_showscale=False)
    st.plotly_chart(fig_q, use_container_width=True)

    threshold = st.slider("Low-quality threshold (%)", 50, 90, 70)
    low_q = qual_summary[qual_summary["arc_quality_pct"] < threshold]
    if not low_q.empty:
        st.markdown(
            f"<div class='warn-box'>⚠️ {len(low_q)} satellites below {threshold}% quality threshold: "
            f"{', '.join(low_q['prn'].tolist())}</div>",
            unsafe_allow_html=True,
        )
    else:
        st.markdown(f"<div class='ok-box'>✓ All satellites above {threshold}% quality threshold.</div>",
                    unsafe_allow_html=True)
