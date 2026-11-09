"""Space weather report builder — aggregates logged dashboard archive data."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd

from zgiis.space_weather.report_narrative import scientific_assessment

REPORT_WINDOWS: dict[str, dict[str, Any]] = {
    "hourly": {"hours": 1.0, "label": "Hourly Report (Last 1 Hour)", "resample": None},
    "daily": {"hours": 24.0, "label": "Daily Report (Last 24 Hours)", "resample": "15min"},
    "weekly": {"hours": 168.0, "label": "Weekly Report (Last 7 Days)", "resample": "1h"},
    "monthly": {"hours": 720.0, "label": "Monthly Report (Last 30 Days)", "resample": "3h"},
    "yearly": {"hours": 8760.0, "label": "Yearly Report (Last 365 Days)", "resample": "1D"},
}

_REPORT_NUMERIC_COLUMNS = (
    "kp",
    "dst",
    "f107",
    "plasma_speed",
    "s4",
    "gnss_risk_score",
    "mean_vtec",
)


def _normalise_report_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Supply optional archive fields that older or sparse logs omit.

    Pandas resampling may also drop columns whose values are entirely null.
    Reports should still render the available metrics instead of returning a
    server error because TEC, scintillation, or another feed has no samples.
    """
    normalised = df.copy()
    for column in _REPORT_NUMERIC_COLUMNS:
        if column not in normalised.columns:
            normalised[column] = float("nan")
    if "gnss_risk" not in normalised.columns:
        normalised["gnss_risk"] = None
    return normalised


def _utc_iso(value: datetime) -> str:
    return value.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _trend(series: pd.Series) -> str:
    s = series.dropna()
    if len(s) < 4:
        return "stable"
    mid = len(s) // 2
    first = float(s.iloc[:mid].mean())
    second = float(s.iloc[mid:].mean())
    tolerance = max(abs(first) * 0.05, 1e-6)
    if second > first + tolerance:
        return "rising"
    if second < first - tolerance:
        return "falling"
    return "stable"


def _impact_level(kp: float | None, dst: float | None, s4: float | None, gnss: str | None) -> dict[str, str]:
    if all(value is None for value in (kp, dst, s4)) and not gnss:
        return {"label": "INSUFFICIENT DATA", "color": "#94a3b8", "risk": "Unknown"}
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
        return {"label": "HIGH INDICATOR LEVEL", "color": "#ff4444", "risk": "High"}
    if score >= 2:
        return {"label": "MODERATE INDICATOR LEVEL", "color": "#ff8c00", "risk": "Moderate"}
    if score >= 1:
        return {"label": "LOW INDICATOR LEVEL", "color": "#00ff88", "risk": "Low"}
    return {"label": "LOW INDICATOR LEVEL", "color": "#00ff88", "risk": "Low"}


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
        return "Fast solar wind; assess IMF coupling"
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
    return "Electron content; local reference needed"


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

    from zgiis.db.space_weather_db import read_log_dataframe

    df = read_log_dataframe(hours=win_hours, resample=None)
    if df.empty:
        return {
            "period": period,
            "period_label": meta["label"],
            "window_start": window_start.isoformat(),
            "window_end": now.isoformat(),
            "generated_utc": _utc_iso(now),
            "sample_count": 0,
            "impact": _impact_level(None, None, None, None),
            **scientific_assessment(df),
            "parameters": [],
            "gnss_stations": [],
            "overall_availability_pct": None,
            "risk_score": None,
            "risk_message": "No logged samples in this window.",
            "charts": {"kp": [], "dst": [], "tec": [], "labels": []},
        }

    df = _normalise_report_columns(df)
    latest = df.iloc[-1]
    kp_cur = _float(latest.get("kp"))
    dst_cur = _float(latest.get("dst"))
    wind_cur = _float(latest.get("plasma_speed"))
    f107_cur = _float(latest.get("f107"))
    tec_cur = _float(latest.get("mean_vtec"))
    s4_cur = _float(latest.get("s4"))
    gnss_cur = str(latest.get("gnss_risk") or "")

    impact = _impact_level(_float(df["kp"].max()), _float(df["dst"].min()), _float(df["s4"].max()), gnss_cur)

    parameters = [
        {"name": "Kp Index", "current": kp_cur, "trend": _trend(df["kp"]), "interpretation": _interpret_kp(kp_cur)},
        {"name": "Dst Index", "unit": "nT", "current": dst_cur, "trend": _trend(df["dst"]), "interpretation": _interpret_dst(dst_cur)},
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
        labels.append(t.strftime("%m-%d %H:%M" if win_hours > 24 else "%H:%M") if hasattr(t, "strftime") else str(t)[:16])
        kp_chart.append(_float(r.get("kp")))
        dst_chart.append(_float(r.get("dst")))
        tec_chart.append(_float(r.get("mean_vtec")))

    return {
        "period": period,
        "period_label": meta["label"],
        "window_start": window_start.isoformat(),
        "window_end": now.isoformat(),
        "generated_utc": _utc_iso(now),
        "sample_count": int(len(df)),
        "impact": impact,
        **scientific_assessment(df),
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
        return "Reduced service availability; investigate station and link health"
    return "Service availability only; positioning accuracy not assessed"


def _risk_message(risk: str, s4: float | None, kp: float | None) -> str:
    return (f"{risk} environmental indicator level under the dashboard screening rules. "
            "This is not a calibrated impact probability or a NOAA warning; local operational effects require independent confirmation.")
