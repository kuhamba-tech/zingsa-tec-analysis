"""GIC series analysis and report generation.

All statistics are computed from real ingested measurements. The EKF
overlay uses the shared ZGIIS Extended Kalman Filter, driven only by the
observed series (no synthetic values). Interpretation thresholds follow
the EPRI SUNBURST occurrence study (≥10 A "large") and the Gannon-storm
transformer response study (25–35 A harmonic onset, >30 A reactive power
draw) — see zgiis.gic.network.RISK_BANDS.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

import pandas as pd

from zgiis.gic.network import RISK_BANDS, classify_gic

REPORT_PERIODS: dict[str, dict[str, Any]] = {
    "hourly": {"hours": 1.0, "label": "1-hour report", "resample": None},
    "daily": {"hours": 24.0, "label": "24-hour report", "resample": "10min"},
    "weekly": {"hours": 24.0 * 7, "label": "7-day report", "resample": "1h"},
    "monthly": {"hours": 24.0 * 30, "label": "30-day report", "resample": "3h"},
    "yearly": {"hours": 24.0 * 365, "label": "365-day report", "resample": "1D"},
}

# Episodes are contiguous runs of samples at/above the "Large" band.
_EVENT_THRESHOLD_A = 10.0


def band_minutes(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Approximate time spent in each risk band using median sample spacing."""
    out = []
    if df.empty:
        return [{"level": b["level"], "minutes": 0.0, "samples": 0} for b in RISK_BANDS]

    times = pd.to_datetime(df["time"], utc=True)
    if len(times) > 1:
        spacing_min = float(times.diff().dt.total_seconds().median() or 60.0) / 60.0
    else:
        spacing_min = 1.0
    abs_vals = df["gic_a"].abs()

    for i, b in enumerate(RISK_BANDS):
        upper = RISK_BANDS[i + 1]["min_abs_a"] if i + 1 < len(RISK_BANDS) else float("inf")
        mask = (abs_vals >= b["min_abs_a"]) & (abs_vals < upper)
        n = int(mask.sum())
        out.append({"level": b["level"], "minutes": round(n * spacing_min, 1), "samples": n})
    return out


def detect_events(df: pd.DataFrame) -> list[dict[str, Any]]:
    """Contiguous |GIC| >= 10 A episodes with peak and duration."""
    if df.empty:
        return []
    events: list[dict[str, Any]] = []
    in_event = False
    start = peak = peak_t = None
    times = pd.to_datetime(df["time"], utc=True)

    for i in range(len(df)):
        v = float(df["gic_a"].iloc[i])
        t = times.iloc[i]
        if abs(v) >= _EVENT_THRESHOLD_A:
            if not in_event:
                in_event, start, peak, peak_t = True, t, v, t
            elif abs(v) > abs(peak):
                peak, peak_t = v, t
            end = t
        elif in_event:
            events.append(_event_row(start, end, peak, peak_t))
            in_event = False
    if in_event:
        events.append(_event_row(start, end, peak, peak_t))
    return events


def _event_row(start, end, peak, peak_t) -> dict[str, Any]:
    band = classify_gic(abs(peak))
    return {
        "start": start.isoformat(),
        "end": end.isoformat(),
        "duration_min": round((end - start).total_seconds() / 60.0, 1),
        "peak_gic_a": round(peak, 2),
        "peak_time": peak_t.isoformat(),
        "level": band["level"] if band else "Large",
    }


def build_report(
    df: pd.DataFrame,
    *,
    station_id: str,
    period: str,
    sw_df: pd.DataFrame | None = None,
) -> dict[str, Any]:
    """Aggregate statistics + plain-language interpretation for a period."""
    meta = REPORT_PERIODS[period]
    now = datetime.now(tz=timezone.utc)
    window_start = now - timedelta(hours=meta["hours"])

    base: dict[str, Any] = {
        "station_id": station_id,
        "period": period,
        "period_label": meta["label"],
        "window_start": window_start.isoformat(),
        "window_end": now.isoformat(),
        "generated_utc": now.replace(microsecond=0).isoformat(),
    }

    if df.empty:
        base.update({
            "sample_count": 0,
            "statistics": None,
            "band_minutes": band_minutes(df),
            "events": [],
            "kp_correlation": None,
            "interpretation": [
                "No GIC measurements were recorded in this window. "
                "Check the field station uplink (CR1000 → Raspberry Pi gateway) "
                "or upload a datalogger file.",
            ],
        })
        return base

    abs_vals = df["gic_a"].abs()
    peak_idx = abs_vals.idxmax()
    stats = {
        "mean_a": round(float(df["gic_a"].mean()), 3),
        "std_a": round(float(df["gic_a"].std() or 0.0), 3),
        "min_a": round(float(df["gic_a"].min()), 3),
        "max_a": round(float(df["gic_a"].max()), 3),
        "peak_abs_a": round(float(abs_vals.max()), 3),
        "peak_time": str(df["time"].loc[peak_idx]),
        "p95_abs_a": round(float(abs_vals.quantile(0.95)), 3),
        "first_sample": str(df["time"].iloc[0]),
        "last_sample": str(df["time"].iloc[-1]),
    }
    events = detect_events(df)
    bands = band_minutes(df)
    peak_band = classify_gic(stats["peak_abs_a"])

    # Kp/Dst correlation over the same window (needs both logs to overlap).
    kp_corr = None
    if sw_df is not None and not sw_df.empty and len(df) >= 8:
        try:
            g = df.set_index(pd.to_datetime(df["time"], utc=True))["gic_a"].abs().resample("10min").max()
            k = sw_df.set_index(pd.to_datetime(sw_df["time"], utc=True))
            merged = pd.DataFrame({"gic": g}).join(
                k[["kp", "dst"]].resample("10min").mean(), how="inner"
            ).dropna(subset=["gic"])
            if len(merged.dropna(subset=["kp"])) >= 8:
                kp_corr = {
                    "kp_r": round(float(merged["gic"].corr(merged["kp"])), 3),
                    "dst_r": (
                        round(float(merged["gic"].corr(merged["dst"])), 3)
                        if merged["dst"].notna().sum() >= 8 else None
                    ),
                    "samples": int(len(merged)),
                }
        except Exception:
            kp_corr = None

    interpretation: list[str] = []
    interpretation.append(
        f"Peak |GIC| was {stats['peak_abs_a']} A at {stats['peak_time']} "
        f"({peak_band['level']} band: {peak_band['meaning']})"
    )
    if events:
        worst = max(events, key=lambda e: abs(e["peak_gic_a"]))
        interpretation.append(
            f"{len(events)} large-GIC episode(s) (|GIC| ≥ {_EVENT_THRESHOLD_A:g} A) detected; "
            f"the strongest peaked at {worst['peak_gic_a']} A over {worst['duration_min']} min. "
            "Episodes at this level warrant checking transformer hotspot temperatures and harmonics."
        )
    else:
        interpretation.append(
            f"No episode reached the {_EVENT_THRESHOLD_A:g} A 'Large' criterion — "
            "activity stayed within normal quiet-time variation."
        )
    if stats["peak_abs_a"] >= 25.0:
        interpretation.append(
            "Peaks above 25 A can drive asymmetric half-cycle transformer core saturation "
            "(even-order harmonics) and, above ~30 A, measurably increased reactive power "
            "consumption. Inspection of transformer diagnostics for this window is recommended."
        )
    if kp_corr and kp_corr["kp_r"] is not None:
        strength = "strong" if abs(kp_corr["kp_r"]) >= 0.6 else "moderate" if abs(kp_corr["kp_r"]) >= 0.3 else "weak"
        interpretation.append(
            f"|GIC| vs Kp correlation over this window: r = {kp_corr['kp_r']} ({strength}), "
            f"n = {kp_corr['samples']} co-sampled bins — "
            + ("consistent with geomagnetic driving of the measured currents."
               if abs(kp_corr["kp_r"]) >= 0.3
               else "suggesting local/engineering sources may dominate in this quiet window.")
        )

    base.update({
        "sample_count": int(len(df)),
        "statistics": stats,
        "band_minutes": bands,
        "events": events,
        "kp_correlation": kp_corr,
        "interpretation": interpretation,
    })
    return base


def report_to_csv(report: dict[str, Any], df: pd.DataFrame) -> str:
    """Flatten a report + raw window data into a downloadable CSV."""
    lines: list[str] = []
    lines.append("ZGIIS GIC MONITOR REPORT")
    lines.append(f"station,{report['station_id']}")
    lines.append(f"period,{report['period_label']}")
    lines.append(f"window_start,{report['window_start']}")
    lines.append(f"window_end,{report['window_end']}")
    lines.append(f"generated_utc,{report['generated_utc']}")
    lines.append(f"sample_count,{report['sample_count']}")
    lines.append("")

    stats = report.get("statistics")
    if stats:
        lines.append("statistic,value")
        for k, v in stats.items():
            lines.append(f"{k},{v}")
        lines.append("")

    lines.append("risk_band,minutes,samples")
    for b in report.get("band_minutes", []):
        lines.append(f"{b['level']},{b['minutes']},{b['samples']}")
    lines.append("")

    events = report.get("events", [])
    if events:
        lines.append("event_start,event_end,duration_min,peak_gic_a,peak_time,level")
        for e in events:
            lines.append(
                f"{e['start']},{e['end']},{e['duration_min']},{e['peak_gic_a']},{e['peak_time']},{e['level']}"
            )
        lines.append("")

    lines.append("interpretation")
    for note in report.get("interpretation", []):
        lines.append('"' + note.replace('"', "'") + '"')
    lines.append("")

    if not df.empty:
        lines.append("time,station_id,gic_a,temp_c")
        for _, r in df.iterrows():
            temp = "" if pd.isna(r.get("temp_c")) else r.get("temp_c")
            lines.append(f"{r['time']},{r['station_id']},{r['gic_a']},{temp}")

    return "\n".join(lines)
