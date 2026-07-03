"""Space weather report builder — aggregates logged dashboard archive data."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd

REPORT_WINDOWS: dict[str, dict[str, Any]] = {
    "hourly": {"hours": 1.0, "label": "Hourly Report (Last 1 Hour)", "resample": None},
    "daily": {"hours": 24.0, "label": "Daily Report (Today)", "resample": "15min"},
    "weekly": {"hours": 168.0, "label": "Weekly Report (This Week)", "resample": "1h"},
    "monthly": {"hours": 720.0, "label": "Monthly Report (This Month)", "resample": "3h"},
    "yearly": {"hours": 8760.0, "label": "Yearly Report (This Year)", "resample": "1D"},
}


def _trend(series: pd.Series) -> str:
    s = series.dropna()
    if len(s) < 4:
        return "stable"
    mid = len(s) // 2
    first = float(s.iloc[:mid].mean())
    second = float(s.iloc[mid:].mean())
    if second > first * 1.05:
        return "rising"
    if second < first * 0.95:
        return "falling"
    return "stable"


def _impact_level(kp: float | None, dst: float | None, s4: float | None, gnss: str | None) -> dict[str, str]:
    score = 0
    if kp is not None and kp >= 5:
        score += 2
    elif kp is not None and kp >= 4:
        score += 1
    if dst is not None and dst <= -100:
        score += 2
    elif dst is not None and dst <= -50:
        score += 1
    if s4 is not None and s4 >= 0.5:
        score += 2
    elif s4 is not None and s4 >= 0.3:
        score += 1
    if gnss and gnss.lower() in ("high", "severe", "extreme"):
        score += 2
    elif gnss and gnss.lower() in ("moderate", "medium"):
        score += 1

    if score >= 4:
        return {"label": "HIGH IMPACT", "color": "#ff4444", "risk": "High"}
    if score >= 2:
        return {"label": "MODERATE IMPACT", "color": "#ff8c00", "risk": "Moderate"}
    if score >= 1:
        return {"label": "LOW IMPACT", "color": "#00ff88", "risk": "Low"}
    return {"label": "LOW IMPACT", "color": "#00ff88", "risk": "Low"}


def _interpret_kp(v: float | None) -> str:
    if v is None:
        return "No Kp data in window"
    if v >= 5:
        return "Geomagnetic storm conditions"
    if v >= 4:
        return "Active geomagnetic conditions"
    if v >= 3:
        return "Unsettled geomagnetic field"
    return "Quiet geomagnetic conditions"


def _interpret_dst(v: float | None) -> str:
    if v is None:
        return "No Dst data in window"
    if v <= -100:
        return "Intense ring-current activity"
    if v <= -50:
        return "Moderate storm-time depression"
    if v <= -30:
        return "Weak disturbance"
    return "Quiet magnetospheric conditions"


def _interpret_wind(v: float | None) -> str:
    if v is None:
        return "No solar-wind data"
    if v >= 650:
        return "Storm-level solar wind"
    if v >= 550:
        return "Elevated solar-wind speed"
    if v >= 450:
        return "Typical solar-wind speed"
    return "Slow solar wind"


def _interpret_f107(v: float | None) -> str:
    if v is None:
        return "No F10.7 data"
    if v >= 170:
        return "High solar flux — elevated TEC driver"
    if v >= 130:
        return "Moderate solar activity"
    return "Low to moderate solar flux"


def _interpret_tec(v: float | None) -> str:
    if v is None:
        return "No archived TEC in window"
    if v >= 60:
        return "Very high ionospheric electron content"
    if v >= 40:
        return "Elevated TEC — monitor GNSS"
    if v >= 25:
        return "Moderate TEC levels"
    return "Typical TEC for quiet conditions"


def _interpret_s4(v: float | None) -> str:
    if v is None:
        return "No scintillation data"
    if v >= 0.5:
        return "Strong scintillation — GNSS degradation likely"
    if v >= 0.3:
        return "Moderate scintillation possible"
    if v >= 0.15:
        return "Weak scintillation"
    return "Minimal scintillation"


def _executive_summary(df: pd.DataFrame, impact: dict[str, str]) -> str:
    if df.empty:
        return (
            "Insufficient logged dashboard data for this reporting window. "
            "Keep the backend running so the space-weather logger can archive samples, then regenerate."
        )
    kp = df["kp"].dropna()
    dst = df["dst"].dropna()
    s4 = df["s4"].dropna()
    parts = [
        f"Automated analysis of the selected interval indicates {impact['label'].lower()} on GNSS and power-grid monitoring."
    ]
    if not kp.empty:
        parts.append(f"Kp reached {float(kp.max()):.1f} (mean {float(kp.mean()):.1f}).")
    if not dst.empty:
        parts.append(f"Dst ranged from {float(dst.min()):.0f} to {float(dst.max()):.0f} nT.")
    if not s4.empty:
        parts.append(f"Scintillation S4 peaked at {float(s4.max()):.3f}.")
    parts.append("All values are derived from the logged archive — nothing is simulated.")
    return " ".join(parts)


def build_space_weather_report(
    period: str,
    *,
    hours: float | None = None,
    uptime_rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    meta = REPORT_WINDOWS.get(period, REPORT_WINDOWS["daily"])
    win_hours = float(hours if hours is not None else meta["hours"])
    now = datetime.now(tz=timezone.utc)
    window_start = now - timedelta(hours=win_hours)

    from zgiis.db.space_weather_db import SpaceWeatherDB

    df = SpaceWeatherDB().query_dataframe(hours=win_hours, resample=meta.get("resample"))
    if df.empty:
        return {
            "period": period,
            "period_label": meta["label"],
            "window_start": window_start.isoformat(),
            "window_end": now.isoformat(),
            "generated_utc": now.replace(microsecond=0).isoformat() + "Z",
            "sample_count": 0,
            "impact": _impact_level(None, None, None, None),
            "executive_summary": _executive_summary(df, _impact_level(None, None, None, None)),
            "parameters": [],
            "gnss_stations": [],
            "overall_availability_pct": None,
            "risk_score": None,
            "risk_message": "No logged samples in this window.",
            "charts": {"kp": [], "dst": [], "tec": [], "labels": []},
        }

    latest = df.iloc[-1]
    kp_cur = _float(latest.get("kp"))
    dst_cur = _float(latest.get("dst"))
    wind_cur = _float(latest.get("plasma_speed"))
    f107_cur = _float(latest.get("f107"))
    tec_cur = _float(latest.get("mean_vtec"))
    s4_cur = _float(latest.get("s4"))
    gnss_cur = str(latest.get("gnss_risk") or "")

    impact = _impact_level(kp_cur, dst_cur, s4_cur, gnss_cur)

    parameters = [
        {"name": "Kp Index", "current": kp_cur, "trend": _trend(df["kp"]), "interpretation": _interpret_kp(kp_cur)},
        {"name": "Dst Index", "current": dst_cur, "trend": _trend(df["dst"]), "interpretation": _interpret_dst(dst_cur)},
        {"name": "Solar Wind Speed", "current": wind_cur, "unit": "km/s", "trend": _trend(df["plasma_speed"]), "interpretation": _interpret_wind(wind_cur)},
        {"name": "Solar Flux (F10.7)", "current": f107_cur, "unit": "sfu", "trend": _trend(df["f107"]), "interpretation": _interpret_f107(f107_cur)},
        {"name": "TEC (Network Mean)", "current": tec_cur, "unit": "TECU", "trend": _trend(df["mean_vtec"]), "interpretation": _interpret_tec(tec_cur)},
        {"name": "Scintillation (S4)", "current": s4_cur, "trend": _trend(df["s4"]), "interpretation": _interpret_s4(s4_cur)},
    ]

    gnss_stations: list[dict[str, Any]] = []
    avail_vals: list[float] = []
    for row in (uptime_rows or [])[:8]:
        online = float(row.get("online_pct") or 0)
        avail_vals.append(online)
        gnss_stations.append({
            "station_code": row.get("station_code"),
            "station_name": row.get("station_name"),
            "availability_pct": round(online, 1),
            "rtk_note": _rtk_note(online, s4_cur),
        })

    overall_avail = round(sum(avail_vals) / len(avail_vals), 1) if avail_vals else None
    risk_score = _float(latest.get("gnss_risk_score"))
    if risk_score is None and s4_cur is not None:
        risk_score = min(100.0, max(0.0, s4_cur * 200))

    labels = []
    kp_chart, dst_chart, tec_chart = [], [], []
    step = max(1, len(df) // 24)
    for i, (_, r) in enumerate(df.iterrows()):
        if i % step != 0 and i != len(df) - 1:
            continue
        t = r["time"]
        labels.append(t.strftime("%H:%M") if hasattr(t, "strftime") else str(t)[11:16])
        kp_chart.append(_float(r.get("kp")))
        dst_chart.append(_float(r.get("dst")))
        tec_chart.append(_float(r.get("mean_vtec")))

    return {
        "period": period,
        "period_label": meta["label"],
        "window_start": window_start.isoformat(),
        "window_end": now.isoformat(),
        "generated_utc": now.replace(microsecond=0).isoformat() + "Z",
        "sample_count": int(len(df)),
        "impact": impact,
        "executive_summary": _executive_summary(df, impact),
        "parameters": parameters,
        "gnss_stations": gnss_stations,
        "overall_availability_pct": overall_avail,
        "risk_score": risk_score,
        "risk_message": _risk_message(impact["risk"], s4_cur, kp_cur),
        "charts": {"labels": labels, "kp": kp_chart, "dst": dst_chart, "tec": tec_chart},
    }


def _float(v: Any) -> float | None:
    try:
        if v is None or (isinstance(v, float) and pd.isna(v)):
            return None
        return round(float(v), 3)
    except (TypeError, ValueError):
        return None


def _rtk_note(online_pct: float, s4: float | None) -> str:
    if online_pct < 80:
        return "Reduced — check NTRIP"
    if s4 is not None and s4 >= 0.4:
        return "Degraded — scintillation"
    if s4 is not None and s4 >= 0.25:
        return "Moderate cm-level"
    return "Nominal cm-level"


def _risk_message(risk: str, s4: float | None, kp: float | None) -> str:
    if risk == "High":
        return "Elevated geomagnetic or scintillation activity — expect GNSS impacts."
    if risk == "Moderate":
        return "Some degradation possible for precision GNSS users."
    if s4 is not None and s4 >= 0.3:
        return "Scintillation may affect RTK at low elevations."
    if kp is not None and kp >= 4:
        return "Active conditions — monitor Kp and Dst."
    return "No significant impact expected."
