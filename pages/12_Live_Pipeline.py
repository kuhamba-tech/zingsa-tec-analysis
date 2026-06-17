"""
Live VTEC Pipeline — ZGIIS
Real-time monitoring dashboard for the NTRIP → STEC → VTEC → TimescaleDB pipeline.
"""
import logging
import os
import time
from datetime import datetime, timezone

import pandas as pd
import plotly.graph_objects as go
import streamlit as st

import zgiis.theme as theme
from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS

log = logging.getLogger(__name__)

st.set_page_config(
    page_title="Live Pipeline — ZGIIS",
    page_icon="📡",
    layout="wide",
)
theme.inject(st, page_id="live_pipeline")
st.markdown(
    """
    <style>
    .live-status-card {
        min-height: 142px;
        padding: 0.9rem 1rem;
        display: flex;
        flex-direction: column;
        justify-content: center;
        gap: 0.28rem;
    }
    .live-status-card .big-metric {
        font-size: clamp(1.65rem, 2vw, 2rem);
        line-height: 1.05;
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
        overflow-wrap: normal;
        word-break: normal;
        hyphens: none;
    }
    .live-status-card .metric-label {
        font-size: clamp(0.66rem, 0.85vw, 0.78rem);
        line-height: 1.25;
        white-space: normal;
        overflow: visible;
        text-overflow: clip;
        overflow-wrap: normal;
        word-break: normal;
        hyphens: none;
    }
    @media (max-width: 900px) {
        .live-status-card {
            min-height: 120px;
            padding: 0.75rem 0.85rem;
        }
        .live-status-card .big-metric {
            font-size: clamp(1.45rem, 5vw, 1.85rem);
        }
    }
    </style>
    """,
    unsafe_allow_html=True,
)

# ── Lazy-load heavy modules so the page always loads ─────────────────────────

@st.cache_resource(show_spinner=False)
def _get_db():
    try:
        from zgiis.db.timescale import TecDB
        return TecDB()
    except Exception as exc:
        return None


@st.cache_resource(show_spinner=False)
def _get_pipeline_manager():
    try:
        from zgiis.live.ntrip_stream import LiveNtripManager
        from zgiis.live.rtk_monitor import RTKMonitor
        return LiveNtripManager, RTKMonitor
    except Exception as exc:
        return None, None


def _ml_info():
    try:
        from zgiis.ml.cnn_gru import model_info
        return model_info()
    except Exception:
        return {}


# ── Page ──────────────────────────────────────────────────────────────────────

st.markdown("## 📡 Live VTEC Pipeline")
st.markdown(
    "Real-time ionospheric TEC from 24 Zimbabwe CORS stations · "
    "NTRIP → RTCM → STEC → VTEC → TimescaleDB → CNN-GRU Forecast"
)

db = _get_db()

# ── Pipeline architecture overview ───────────────────────────────────────────
with st.expander("Architecture", expanded=False):
    st.markdown("""
| Stage | Technology | Status |
|---|---|---|
| **24 CORS stations** | GPS L1/L2 · Galileo E1/E5 · BeiDou B1/B2 · GLONASS G1/G2 | Configured |
| **NTRIP caster** | pyrtcm · MSM4/MSM7 decode | Configured via secrets.toml |
| **STEC calculation** | L1−L2 phase difference · Gopi Book Eq 4.12 | Implemented |
| **STEC → VTEC** | Mapping function S(E) · Gopi Book Eq 4.17 | Implemented |
| **Storage** | TimescaleDB hypertable (SQLite fallback) | Active |
| **TEC map** | Near real-time Zimbabwe ionospheric map | This app |
| **CNN-GRU forecast** | Auto-trains daily on live VTEC stream | Model below |
""")

st.divider()

# ── Row 1: status cards ───────────────────────────────────────────────────────
c1, c2, c3, c4 = st.columns(4)

db_ok = db is not None
try:
    db_count = db.record_count() if db_ok else 0
except Exception:
    db_count = 0

try:
    from zgiis.api.ntrip_client import check_connection
    ntrip_status = check_connection()
    ntrip_ok = ntrip_status.get("connected", False)
    ntrip_label = "Connected" if ntrip_ok else "Offline"
except Exception:
    ntrip_ok = False
    ntrip_label = "Unavailable"

ml = _ml_info()
model_ok = ml.get("exists", False) and ml.get("torch_ok", False)

with c1:
    color = "#00cc55" if ntrip_ok else "#ff4444"
    st.markdown(
        f'<div class="zgiis-card live-status-card zgiis-card-{"ok" if ntrip_ok else "alert"}">'
        f'<div class="metric-label">NTRIP Caster</div>'
        f'<div class="big-metric" style="color:{color}">{ntrip_label}</div>'
        f'</div>',
        unsafe_allow_html=True,
    )

with c2:
    color = "#00cc55" if db_ok else "#ff8c00"
    label = "TimescaleDB" if (db_ok and os.getenv("TSDB_DSN")) else ("SQLite" if db_ok else "N/A")
    st.markdown(
        f'<div class="zgiis-card live-status-card zgiis-card-{"ok" if db_ok else "warn"}">'
        f'<div class="metric-label">Storage</div>'
        f'<div class="big-metric" style="color:{color}">{label}</div>'
        f'<div class="metric-label">{db_count:,} records</div>'
        f'</div>',
        unsafe_allow_html=True,
    )

with c3:
    color = "#00cc55" if model_ok else "#ff8c00"
    model_label = "Ready" if model_ok else ("No model" if ml.get("torch_ok") else "PyTorch N/A")
    st.markdown(
        f'<div class="zgiis-card live-status-card zgiis-card-{"ok" if model_ok else "warn"}">'
        f'<div class="metric-label">CNN-GRU Model</div>'
        f'<div class="big-metric" style="color:{color}">{model_label}</div>'
        f'<div class="metric-label">Forecast horizon: {ml.get("forecast_h", 6)} h</div>'
        f'</div>',
        unsafe_allow_html=True,
    )

with c4:
    n_stations = len(ZIMBABWE_CORS_STATIONS)
    st.markdown(
        f'<div class="zgiis-card live-status-card zgiis-card-accent">'
        f'<div class="metric-label">Configured Stations</div>'
        f'<div class="big-metric">{n_stations}</div>'
        f'<div class="metric-label">static registry only</div>'
        f'</div>',
        unsafe_allow_html=True,
    )

st.divider()

# ── Row 2: recent VTEC time series + forecast ─────────────────────────────────
col_ts, col_fc = st.columns([3, 2])

with col_ts:
    st.markdown("#### Live VTEC — last 2 hours")
    if db_ok:
        try:
            df_live = db.query_recent(hours=2)
            if not df_live.empty:
                df_live["time"] = pd.to_datetime(df_live["time"], utc=True)
                fig = go.Figure()
                for station, grp in df_live.groupby("station"):
                    ts_mean = (
                        grp.set_index("time")["vtec_tecu"]
                        .resample("5min").mean()
                        .dropna()
                    )
                    fig.add_trace(go.Scatter(
                        x=ts_mean.index, y=ts_mean.values,
                        mode="lines", name=station.upper(),
                        line=dict(width=1.5),
                    ))
                fig.update_layout(
                    paper_bgcolor="rgba(0,0,0,0)",
                    plot_bgcolor="rgba(0,0,0,0)",
                    font=dict(color="#ffffff"),
                    margin=dict(l=0, r=0, t=0, b=0),
                    xaxis=dict(showgrid=False, color="#ffffff"),
                    yaxis=dict(
                        title="VTEC (TECU)",
                        showgrid=True,
                        gridcolor="rgba(255,255,255,0.08)",
                        color="#ffffff",
                    ),
                    legend=dict(font=dict(size=10)),
                    height=280,
                )
                st.plotly_chart(fig, use_container_width=True, config={"displayModeBar": False})
            else:
                st.info("No live observations yet. Start the NTRIP stream to ingest data.")
        except Exception as exc:
            st.warning(f"Could not load live VTEC: {exc}")
    else:
        st.info("Database not available.")

with col_fc:
    st.markdown("#### CNN-GRU Forecast (next 6 h)")
    if db_ok and model_ok:
        try:
            from zgiis.ml.trainer import forecast as cnn_forecast
            fc = cnn_forecast(db)
            if fc is not None:
                fig2 = go.Figure()
                # Historical context (last 3 h)
                hist = db.mean_vtec_timeseries(hours=3)
                if not hist.empty:
                    fig2.add_trace(go.Scatter(
                        x=hist.index, y=hist.values,
                        name="Observed", line=dict(color="#168bd2", width=2),
                    ))
                fig2.add_trace(go.Scatter(
                    x=fc.index, y=fc.values,
                    name="Forecast", line=dict(color="#f59e0b", width=2, dash="dash"),
                ))
                fig2.update_layout(
                    paper_bgcolor="rgba(0,0,0,0)",
                    plot_bgcolor="rgba(0,0,0,0)",
                    font=dict(color="#ffffff"),
                    margin=dict(l=0, r=0, t=0, b=0),
                    xaxis=dict(showgrid=False, color="#ffffff"),
                    yaxis=dict(
                        title="VTEC (TECU)",
                        showgrid=True,
                        gridcolor="rgba(255,255,255,0.08)",
                        color="#ffffff",
                    ),
                    legend=dict(font=dict(size=10)),
                    height=280,
                )
                st.plotly_chart(fig2, use_container_width=True, config={"displayModeBar": False})
            else:
                st.info("Forecast unavailable — insufficient history (need 24 h of data).")
        except Exception as exc:
            st.warning(f"Forecast error: {exc}")
    elif not model_ok and ml.get("torch_ok"):
        st.info("No trained model yet. Use **Train Model** below once 30 days of data are collected.")
    elif not ml.get("torch_ok"):
        st.info("CNN-GRU forecasting requires PyTorch. See **requirements-streamlit.txt** for installation instructions.")
    else:
        st.info("Database required for forecast.")

st.divider()

# ── Row 3: station VTEC grid ──────────────────────────────────────────────────
st.markdown("#### Recent Station VTEC")
st.caption("Uses only local TimescaleDB/SQLite pipeline records from this live pipeline.")

try:
    if db_ok:
        summary = db.station_summary(hours=1.0)
    else:
        summary = pd.DataFrame()
except Exception:
    summary = pd.DataFrame()

all_stations = ZIMBABWE_CORS_STATIONS
cols = st.columns(6)
for i, s in enumerate(all_stations):
    sid  = s.code
    name = s.name
    if not summary.empty and sid in summary["station"].values:
        row  = summary[summary["station"] == sid].iloc[0]
        vtec = f"{row['mean_vtec']:.1f}"
        color = "#00cc55"
    else:
        vtec  = "N/A"
        color = "#444466"
    with cols[i % 6]:
        st.markdown(
            f'<div class="zgiis-card" style="min-height:72px;padding:0.6rem 0.8rem;">'
            f'<div class="metric-label" style="font-size:0.65rem">{sid.upper()}</div>'
            f'<div style="color:{color};font-size:1.1rem;font-weight:800">{vtec}</div>'
            f'<div class="metric-label" style="font-size:0.58rem">{name[:16]}</div>'
            f'</div>',
            unsafe_allow_html=True,
        )

st.divider()

# ── Row 4: CNN-GRU training controls ─────────────────────────────────────────
with st.expander("CNN-GRU Model Training", expanded=False):
    st.markdown(
        "The model trains daily on 30 days of 15-min mean VTEC from TimescaleDB. "
        "Fine-tunes from existing weights when available."
    )
    col_info, col_btn = st.columns([3, 1])
    with col_info:
        if ml:
            st.markdown(f"""
- **Sequence length**: {ml.get('seq_len', 96)} steps (24 h)
- **Forecast horizon**: {ml.get('horizon', 24)} steps ({ml.get('forecast_h', 6)} h)
- **Architecture**: Conv1D(32) → Conv1D(64) → GRU(128×2) → Dense
- **Model file**: `{ml.get('path', 'N/A')}`
""")
    with col_btn:
        if st.button("Train Now", type="primary", disabled=not (db_ok and ml.get("torch_ok"))):
            with st.spinner("Training CNN-GRU… this may take a few minutes"):
                try:
                    from zgiis.ml.trainer import train as ml_train
                    result = ml_train(db, epochs=30)
                    if "error" in result:
                        st.error(result["error"])
                    else:
                        st.success(
                            f"Training complete — final loss: {result['final_loss']:.5f} "
                            f"over {result.get('n_windows', '?')} windows"
                        )
                        st.rerun()
                except Exception as exc:
                    st.error(f"Training failed: {exc}")

st.divider()

# ── Footer note ───────────────────────────────────────────────────────────────
st.markdown(
    "<small style='color:#888'>Live data requires NTRIP credentials in "
    "<code>.streamlit/secrets.toml</code> and a TimescaleDB instance "
    "(set <code>TSDB_DSN=postgresql://...</code> env-var). "
    "Without these, the page shows SQLite-backed historical data.</small>",
    unsafe_allow_html=True,
)
