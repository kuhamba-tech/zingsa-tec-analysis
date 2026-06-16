"""ZGIIS — TEC Anomaly Detection."""
from __future__ import annotations

import io
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

from zgiis.space_weather.fetch_indices import get_space_weather
from zgiis.theme import inject

st.set_page_config(page_title="ZGIIS — TEC Anomaly Detection", page_icon="🔬", layout="wide")
inject(st, page_id="tec_anomaly")


def _demo_df() -> pd.DataFrame:
    rng = np.random.default_rng(5)
    dates = pd.date_range("2021-01-01", "2024-12-31", freq="D")
    rows = []
    for d in dates:
        doy   = d.day_of_year
        year  = d.year
        solar_cycle = 8 + 6 * np.sin(2 * np.pi * (year - 2019) / 11)
        seasonal    = 3 * np.sin(2 * np.pi * doy / 365)
        storm_noise = rng.exponential(0.5)
        vtec = max(5, solar_cycle + seasonal + storm_noise + rng.normal(0, 1))
        rows.append({"date": d, "vtec": vtec, "stec": vtec * 1.5,
                     "station": "hara", "month": d.strftime("%Y-%m"),
                     "year": year, "doy": doy, "kp": rng.uniform(0, 8)})
    return pd.DataFrame(rows)


df: pd.DataFrame = st.session_state.get("zgiis_df", pd.DataFrame())
daily_df: pd.DataFrame = st.session_state.get("zgiis_daily", pd.DataFrame())
using_demo = df.empty
if using_demo:
    df = _demo_df()
    if daily_df.empty:
        daily_df = df.groupby("date").agg(
            mean_vtec=("vtec","mean"), max_vtec=("vtec","max"),
            min_vtec=("vtec","min"), samples=("vtec","size")
        ).reset_index()
    st.info("Showing demo data. Run **⚙️ Processing** to load your files.")

df["date"] = pd.to_datetime(df["date"])
if "year" not in df.columns:
    df["year"] = df["date"].dt.year
if "doy" not in df.columns:
    df["doy"] = df["date"].dt.day_of_year
if "month" not in df.columns:
    df["month"] = df["date"].dt.to_period("M").astype(str)

sw = get_space_weather()

with st.sidebar:
    st.markdown("### 🔬 TEC Anomaly Tools")
    anomaly_pct    = st.slider("Anomaly threshold (percentile)", 80, 99, 95)
    storm_kp       = st.slider("Storm Kp threshold", 3.0, 9.0, 5.0, 0.5)
    ref_year       = st.selectbox("Reference year (climatology)", sorted(df["year"].unique()), index=0)
    forecast_days  = st.selectbox("Forecast horizon (days)", [30, 60, 90], index=0)
    st.divider()
    st.page_link("Home.py", label="← Back to Home")

st.markdown("<div class='zgiis-title' style='font-size:1.7rem'>🔬 TEC Anomaly Detection</div>", unsafe_allow_html=True)
st.caption("TEC anomaly detection · storm analysis · diurnal/seasonal/solar-cycle tools")
st.markdown("---")

tab1, tab2, tab3, tab4, tab5, tab6, tab7 = st.tabs([
    "Anomaly Detection", "Storm Comparison", "Diurnal Variation",
    "Seasonal Variation", "Solar Cycle", "EIA Study", "TEC Prediction",
])

# ── Tab 1: Anomaly Detection ───────────────────────────────────────────────────
with tab1:
    st.subheader("TEC Anomaly Detection")
    if not daily_df.empty and "mean_vtec" in daily_df.columns:
        adf = daily_df.copy()
    else:
        adf = df.groupby("date")["vtec"].mean().reset_index()
        adf.columns = ["date", "mean_vtec"]

    threshold = adf["mean_vtec"].quantile(anomaly_pct / 100)
    adf["anomaly"] = adf["mean_vtec"] >= threshold

    fig = go.Figure()
    fig.add_scatter(x=adf["date"], y=adf["mean_vtec"], mode="lines",
                    line=dict(color="#168bd2", width=1.5), name="VTEC")
    fig.add_scatter(
        x=adf[adf["anomaly"]]["date"], y=adf[adf["anomaly"]]["mean_vtec"],
        mode="markers", marker=dict(size=9, color="#ff4444", symbol="star"),
        name=f"Anomaly >{anomaly_pct}th pct",
    )
    fig.add_hline(y=threshold, line_dash="dash", line_color="#ff8c00",
                  annotation_text=f"{anomaly_pct}th pct: {threshold:.2f} TECU",
                  annotation_font_color="#ff8c00")
    fig.update_layout(paper_bgcolor="#000000", plot_bgcolor="#000000",
                      font_color="#ffffff", yaxis=dict(gridcolor="#244d73"),
                      xaxis=dict(gridcolor="#244d73"), height=360,
                      legend=dict(bgcolor="#000000", bordercolor="#244d73"))
    st.plotly_chart(fig, use_container_width=True)

    anomaly_days = adf[adf["anomaly"]]
    st.markdown(f"**{len(anomaly_days)} anomaly days detected** (VTEC ≥ {threshold:.2f} TECU)")
    if not anomaly_days.empty:
        st.dataframe(anomaly_days.sort_values("mean_vtec", ascending=False), use_container_width=True)
    st.download_button("⬇ Export anomaly CSV",
                       anomaly_days.to_csv(index=False).encode(), "anomalies.csv", "text/csv")

# ── Tab 2: Storm Comparison ────────────────────────────────────────────────────
with tab2:
    st.subheader("Storm Day vs Quiet Day TEC Comparison")
    if "kp" not in df.columns:
        df["kp"] = np.random.default_rng(3).uniform(0, 6, len(df))

    storm_mask = df["kp"] >= storm_kp
    quiet_mask = df["kp"] < 3.0

    storm_days_df = df[storm_mask].groupby("doy")["vtec"].mean().reset_index()
    quiet_days_df = df[quiet_mask].groupby("doy")["vtec"].mean().reset_index()

    # Convert DOY → calendar date anchored to ref_year so x-axis shows months
    _base = pd.Timestamp(year=int(ref_year), month=1, day=1)
    storm_days_df["date"] = storm_days_df["doy"].apply(
        lambda d: _base + pd.Timedelta(days=int(d) - 1)
    )
    quiet_days_df["date"] = quiet_days_df["doy"].apply(
        lambda d: _base + pd.Timedelta(days=int(d) - 1)
    )

    fig_sc = go.Figure()
    fig_sc.add_scatter(
        x=quiet_days_df["date"], y=quiet_days_df["vtec"],
        mode="lines", name="Quiet (Kp<3)", line=dict(color="#00ff88"),
        hovertemplate="<b>%{x|%d %B}</b><br>VTEC: %{y:.2f} TECU<extra>Quiet (Kp<3)</extra>",
    )
    fig_sc.add_scatter(
        x=storm_days_df["date"], y=storm_days_df["vtec"],
        mode="lines", name=f"Storm (Kp≥{storm_kp})", line=dict(color="#ff4444"),
        hovertemplate="<b>%{x|%d %B}</b><br>VTEC: %{y:.2f} TECU<extra>Storm (Kp≥" + str(storm_kp) + ")</extra>",
    )
    fig_sc.update_layout(
        title=f"Storm vs Quiet Day VTEC by Month ({ref_year})",
        paper_bgcolor="#000000", plot_bgcolor="#000000",
        font_color="#ffffff",
        yaxis=dict(title="VTEC (TECU)", gridcolor="#244d73"),
        xaxis=dict(
            title="Month",
            gridcolor="#244d73",
            tickformat="%b",
            dtick="M1",
            ticklabelmode="period",
        ),
        height=360, legend=dict(bgcolor="#000000", bordercolor="#244d73"),
    )
    st.plotly_chart(fig_sc, use_container_width=True)
    st.metric("Storm days count", int(storm_mask.sum()))
    st.metric("Quiet days count", int(quiet_mask.sum()))

# ── Tab 3: Diurnal Variation ───────────────────────────────────────────────────
with tab3:
    st.subheader("Diurnal TEC Variation")
    if "time_hours" in df.columns:
        df["hour"] = df["time_hours"].astype(int) % 24
    elif "timestamp" in df.columns:
        df["hour"] = pd.to_datetime(df["timestamp"]).dt.hour
    else:
        df["hour"] = np.random.randint(0, 24, len(df))

    diurnal = df.groupby("hour")["vtec"].agg(["mean","std"]).reset_index()
    diurnal.columns = ["hour", "mean_vtec", "std_vtec"]

    fig_d = go.Figure()
    fig_d.add_scatter(
        x=list(diurnal["hour"]) + list(diurnal["hour"])[::-1],
        y=list(diurnal["mean_vtec"] + diurnal["std_vtec"]) +
          list(diurnal["mean_vtec"] - diurnal["std_vtec"])[::-1],
        fill="toself", fillcolor="rgba(0,212,255,0.12)",
        line_color="rgba(255,255,255,0)", name="±1σ",
    )
    fig_d.add_scatter(x=diurnal["hour"], y=diurnal["mean_vtec"],
                      mode="lines+markers", line=dict(color="#168bd2", width=2.5),
                      marker=dict(size=8), name="Mean VTEC")
    fig_d.update_layout(
        title="24-hour VTEC Variation (UTC)",
        paper_bgcolor="#000000", plot_bgcolor="#000000",
        font_color="#ffffff",
        yaxis=dict(title="VTEC (TECU)", gridcolor="#244d73"),
        xaxis=dict(title="Hour (UTC)", dtick=2, gridcolor="#244d73"),
        height=360, legend=dict(bgcolor="#000000", bordercolor="#244d73"),
    )
    st.plotly_chart(fig_d, use_container_width=True)
    st.caption("Local time (LT) = UTC + 2h for Zimbabwe. Peak TEC typically at ~14:00 LT.")

# ── Tab 4: Seasonal Variation ──────────────────────────────────────────────────
with tab4:
    st.subheader("Seasonal TEC Variation")
    df["season_month"] = df["date"].dt.month
    df["season_label"] = pd.cut(
        df["season_month"], bins=[0,3,6,9,12],
        labels=["Jan–Mar\n(Summer)", "Apr–Jun\n(Autumn)", "Jul–Sep\n(Winter)", "Oct–Dec\n(Spring)"],
    )
    seasonal = df.groupby("season_label", observed=True)["vtec"].agg(["mean","max","min","std"]).reset_index()
    seasonal.columns = ["Season", "Mean", "Max", "Min", "Std"]

    fig_sea = go.Figure()
    fig_sea.add_bar(x=seasonal["Season"], y=seasonal["Mean"], name="Mean VTEC",
                    marker_color="#168bd2", error_y=dict(type="data", array=seasonal["Std"].tolist()))
    fig_sea.update_layout(
        title="Seasonal Mean VTEC (southern hemisphere seasons)",
        paper_bgcolor="#000000", plot_bgcolor="#000000",
        font_color="#ffffff", yaxis=dict(title="VTEC (TECU)", gridcolor="#244d73"),
        xaxis=dict(gridcolor="#244d73"), height=340,
    )
    st.plotly_chart(fig_sea, use_container_width=True)
    st.dataframe(seasonal, use_container_width=True)

# ── Tab 5: Solar Cycle ─────────────────────────────────────────────────────────
with tab5:
    st.subheader("Solar Cycle TEC Analysis")
    yearly = df.groupby("year")["vtec"].agg(["mean","max","min"]).reset_index()
    yearly.columns = ["year", "mean_vtec", "max_vtec", "min_vtec"]

    fig_yr = go.Figure()
    fig_yr.add_scatter(x=yearly["year"], y=yearly["mean_vtec"], mode="lines+markers",
                       line=dict(color="#168bd2", width=2.5), name="Mean VTEC")
    fig_yr.add_scatter(x=yearly["year"], y=yearly["max_vtec"], mode="lines",
                       line=dict(color="#ff4444", dash="dot"), name="Max VTEC")
    fig_yr.add_scatter(x=yearly["year"], y=yearly["min_vtec"], mode="lines",
                       line=dict(color="#00ff88", dash="dot"), name="Min VTEC")
    fig_yr.update_layout(
        title="Annual TEC Trend — Solar Cycle Influence",
        paper_bgcolor="#000000", plot_bgcolor="#000000",
        font_color="#ffffff", yaxis=dict(title="VTEC (TECU)", gridcolor="#244d73"),
        xaxis=dict(title="Year", dtick=1, gridcolor="#244d73"),
        height=360, legend=dict(bgcolor="#000000", bordercolor="#244d73"),
    )
    st.plotly_chart(fig_yr, use_container_width=True)

    f107 = sw.get("f107", 142.5)
    st.markdown(
        f"<div class='zgiis-card zgiis-card-accent'>"
        f"<b>Current F10.7: {f107} sfu</b><br>"
        f"<div style='font-size:0.82rem;color:#ffffff;margin-top:4px'>"
        f"We are in Solar Cycle 25 (began Dec 2019). "
        f"Predicted peak: 2025–2026. Elevated F10.7 correlates with higher TEC, "
        f"increased equatorial fountain effect, and stronger EIA over Zimbabwe.</div></div>",
        unsafe_allow_html=True,
    )

# ── Tab 6: EIA Study ──────────────────────────────────────────────────────────
with tab6:
    st.subheader("Equatorial Ionospheric Anomaly (EIA) Study")
    st.markdown(
        "<div class='zgiis-card zgiis-card-accent'>"
        "<b>About the EIA over Zimbabwe</b><br>"
        "<div style='font-size:0.84rem;color:#ffffff;margin-top:5px'>"
        "Zimbabwe (~15°–23°S, 26°–33°E) lies in the southern EIA trough-to-crest transition zone. "
        "The EIA is driven by the equatorial fountain effect: daytime E×B plasma drift lifts plasma "
        "at the magnetic equator, which then diffuses along field lines to ±15–20° magnetic latitude — "
        "creating TEC 'crests' on either side of the equator. The geographic equator (~0°N) is tilted "
        "~11° from the magnetic equator over Africa, so the southern EIA crest can reach into "
        "Zimbabwe during high solar activity. This causes rapid TEC gradients that challenge "
        "long-baseline RTK and can trigger scintillation.</div></div>",
        unsafe_allow_html=True,
    )

    st.subheader("Latitude Profile (illustrative)")
    lats_eia = np.linspace(-30, 10, 100)
    eia_tec = (
        22
        + 8 * np.exp(-((lats_eia + 15) ** 2) / 20)
        + 8 * np.exp(-((lats_eia - 10) ** 2) / 20)
        - 4 * np.exp(-(lats_eia ** 2) / 5)
    )
    fig_eia = go.Figure(go.Scatter(
        x=lats_eia, y=eia_tec, mode="lines",
        line=dict(color="#168bd2", width=2.5), fill="tozeroy",
        fillcolor="rgba(0,212,255,0.08)",
    ))
    fig_eia.add_vrect(x0=-22.5, x1=-15.5, fillcolor="rgba(0,255,136,0.07)",
                      line_width=0, annotation_text="Zimbabwe", annotation_position="top left",
                      annotation_font_color="#00ff88")
    fig_eia.update_layout(
        title="Typical EIA VTEC Latitudinal Profile (Africa sector, daytime)",
        paper_bgcolor="#000000", plot_bgcolor="#000000", font_color="#ffffff",
        yaxis=dict(title="VTEC (TECU)", gridcolor="#244d73"),
        xaxis=dict(title="Geographic Latitude (°)", gridcolor="#244d73"),
        height=340,
    )
    st.plotly_chart(fig_eia, use_container_width=True)
    st.caption("During solar maximum, the southern EIA crest can extend to ~20°S, directly affecting Zimbabwe CORS stations.")

# ── Tab 7: TEC Prediction ─────────────────────────────────────────────────────
with tab7:
    from scipy.optimize import curve_fit

    st.subheader(f"TEC Prediction — {forecast_days}-day Forecast")
    st.caption(
        "Seasonal + linear trend model fitted to historical daily VTEC. "
        "Confidence band = ±1 std of fit residuals."
    )

    # Build daily series
    if not daily_df.empty and "mean_vtec" in daily_df.columns:
        pred_df = daily_df[["date", "mean_vtec"]].copy()
    else:
        pred_df = df.groupby("date")["vtec"].mean().reset_index()
        pred_df.columns = ["date", "mean_vtec"]
    pred_df = pred_df.sort_values("date").dropna()

    if len(pred_df) < 30:
        st.warning("Not enough history for a reliable forecast (need ≥ 30 days).")
    else:
        t0 = pred_df["date"].min()
        t_num = (pred_df["date"] - t0).dt.days.values.astype(float)
        y_obs = pred_df["mean_vtec"].values

        def _model(t, a, b, c1, d1, c2, d2):
            return (
                a + b * t
                + c1 * np.sin(2 * np.pi * t / 365.25)
                + d1 * np.cos(2 * np.pi * t / 365.25)
                + c2 * np.sin(4 * np.pi * t / 365.25)
                + d2 * np.cos(4 * np.pi * t / 365.25)
            )

        try:
            popt, _ = curve_fit(_model, t_num, y_obs, maxfev=10000)
        except RuntimeError:
            popt = np.polyfit(t_num, y_obs, 1)[::-1].tolist() + [0, 0, 0, 0]

        y_fit   = _model(t_num, *popt)
        residuals = y_obs - y_fit
        sigma   = residuals.std()

        # Future horizon
        t_future = np.arange(t_num[-1] + 1, t_num[-1] + forecast_days + 1)
        dates_future = pd.date_range(pred_df["date"].max() + pd.Timedelta(days=1), periods=forecast_days)
        y_pred  = _model(t_future, *popt)

        fig_pred = go.Figure()

        # Historical
        fig_pred.add_scatter(
            x=pred_df["date"], y=y_obs,
            mode="lines", name="Observed VTEC",
            line=dict(color="#168bd2", width=1.5),
        )
        # Fitted
        fig_pred.add_scatter(
            x=pred_df["date"], y=y_fit,
            mode="lines", name="Model fit",
            line=dict(color="#ffffff", width=1, dash="dot"),
        )
        # Forecast ribbon
        fig_pred.add_scatter(
            x=list(dates_future) + list(dates_future)[::-1],
            y=list(y_pred + sigma) + list(y_pred - sigma)[::-1],
            fill="toself", fillcolor="rgba(255,165,0,0.15)",
            line_color="rgba(0,0,0,0)", name="±1σ band", showlegend=True,
        )
        # Forecast line
        fig_pred.add_scatter(
            x=dates_future, y=y_pred,
            mode="lines", name=f"{forecast_days}-day forecast",
            line=dict(color="#ff8c00", width=2.5),
        )
        # Vertical divider
        fig_pred.add_vline(
            x=pred_df["date"].max().timestamp() * 1000,
            line_dash="dash", line_color="#888888",
            annotation_text="Forecast →", annotation_font_color="#888888",
        )
        fig_pred.update_layout(
            paper_bgcolor="#000000", plot_bgcolor="#000000",
            font_color="#ffffff",
            yaxis=dict(title="VTEC (TECU)", gridcolor="#244d73"),
            xaxis=dict(title="Date", gridcolor="#244d73"),
            height=380,
            legend=dict(bgcolor="#000000", bordercolor="#244d73"),
        )
        st.plotly_chart(fig_pred, use_container_width=True)

        # Summary metrics
        m1, m2, m3 = st.columns(3)
        m1.metric("Forecast mean VTEC", f"{y_pred.mean():.2f} TECU")
        m2.metric("Forecast peak VTEC", f"{y_pred.max():.2f} TECU")
        m3.metric("Model fit σ (residuals)", f"±{sigma:.2f} TECU")

        # Export forecast
        fc_out = pd.DataFrame({"date": dates_future, "predicted_vtec": y_pred,
                               "upper_1sigma": y_pred + sigma, "lower_1sigma": y_pred - sigma})
        st.download_button(
            "⬇ Export forecast CSV",
            fc_out.to_csv(index=False).encode(),
            f"tec_forecast_{forecast_days}d.csv", "text/csv",
        )

        if using_demo:
            st.caption("⚠ Forecast is based on demo data. Load real RINEX files via Processing for operational predictions.")

# ── Export section ─────────────────────────────────────────────────────────────
st.markdown("---")
st.subheader("Exports")
ex1, ex2, ex3 = st.columns(3)

with ex1:
    st.download_button("⬇ Full dataset CSV",
                       df.to_csv(index=False).encode(), "research_full.csv", "text/csv")
with ex2:
    if not daily_df.empty:
        st.download_button("⬇ Daily summary CSV",
                           daily_df.to_csv(index=False).encode(), "research_daily.csv", "text/csv")

with ex3:
    try:
        from zgiis.reports.pdf_report import generate_report
        station_name = df["station"].iloc[0] if "station" in df.columns else "N/A"
        period = f"{df['date'].min().date()} – {df['date'].max().date()}"
        pdf_bytes = generate_report(
            station=station_name, period=period,
            daily_df=daily_df if not daily_df.empty else None,
            monthly_df=None, sw_info=sw,
        )
        st.download_button("⬇ PDF Report", pdf_bytes, "zgiis_report.pdf", "application/pdf")
    except Exception as exc:
        st.caption(f"PDF export unavailable: {exc}")
