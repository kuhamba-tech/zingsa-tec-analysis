"""Gap-aware reports from actual stored transformer-neutral observations."""
from __future__ import annotations
import csv
import io
import json
from datetime import datetime, timedelta, timezone
from typing import Any
import pandas as pd
from zgiis.gic.network import RISK_BANDS
from zgiis.gic.quality import valid_frame
from zgiis.gic.operations import observation_summary, held_durations, validate_ekf

REPORT_PERIODS: dict[str, dict[str, Any]] = {
    "hourly": {"hours": 1.0, "label": "1-hour report", "resample": None},
    "daily": {"hours": 24.0, "label": "24-hour report", "resample": "10min"},
    "weekly": {"hours": 24.0 * 7, "label": "7-day report", "resample": "1h"},
    "monthly": {"hours": 24.0 * 30, "label": "30-day report", "resample": "3h"},
    "yearly": {"hours": 24.0 * 365, "label": "365-day report", "resample": "1D"},
}


def _bands(configuration=None):
    config = configuration or {}
    return [{**band, "min_abs_a": value} for band, value in zip(RISK_BANDS, [0]+config.get("thresholds_a", [5, 10, 25, 35]))]


def band_minutes(df, configuration=None):
    data = valid_frame(df)
    durations = held_durations(data, (configuration or {}).get("expected_cadence_seconds"))
    bands = _bands(configuration)
    result = []
    for i, band in enumerate(bands):
        upper = bands[i+1]["min_abs_a"] if i+1 < len(bands) else float("inf")
        mask = ((data.gic_a.abs() >= band["min_abs_a"]) & (data.gic_a.abs() < upper)).tolist() if not data.empty else []
        result.append({"level": band["level"], "minutes": round(sum(dt for dt, yes in zip(durations, mask) if yes)/60, 3), "samples": sum(mask)})
    return result


def detect_events(df, configuration=None):
    data = valid_frame(df)
    config = configuration or {}
    threshold = config.get("thresholds_a", [5,10,25,35])[1]
    cadence = config.get("expected_cadence_seconds")
    events, group = [], []
    def flush():
        if not group: return
        peak = max(group, key=lambda r: abs(r[1]))
        band = next(b for b in reversed(_bands(config)) if abs(peak[1]) >= b["min_abs_a"])
        events.append({"start": group[0][0].isoformat(), "end": group[-1][0].isoformat(),
                       "duration_min": round((group[-1][0]-group[0][0]).total_seconds()/60, 3) if cadence else 0.,
                       "peak_gic_a": peak[1], "peak_time": peak[0].isoformat(), "level": band["level"],
                       "polarity": "positive" if peak[1] > 0 else "negative"})
        group.clear()
    for row in data.itertuples():
        stamp = pd.Timestamp(row.time)
        if group and (not cadence or (stamp-group[-1][0]).total_seconds()>cadence*1.5): flush()
        if abs(row.gic_a) >= threshold:
            group.append((stamp, float(row.gic_a)))
        else: flush()
    flush()
    return events


def build_report(df, *, station_id, period, sw_df=None, configuration=None):
    config = configuration or {}
    meta = REPORT_PERIODS[period]
    now = datetime.now(timezone.utc)
    start = now-timedelta(hours=meta["hours"])
    summary = observation_summary(df, config, start, now)
    data = valid_frame(df)
    statistics = None
    interpretation = [
        "This retrospective assessment contains stored field observations only. Zero records means unavailable evidence, not zero current.",
        "Magnitude categories are provisional monitoring levels unless approved site-specific ZETDC thresholds are recorded. They do not establish transformer damage or reactive-power consumption.",
        "Event durations count valid adjoining observations only and stop at data gaps. Unknown logger cadence prevents duration and completeness assessment; a lone sample has no measured duration.",
        "A current excursion alone does not identify a geomagnetic storm. Separate magnetic and planetary observations are required to distinguish storm response from ordinary diurnal variation and local electrical effects.",
        "Calibration, sensor polarity, logger time basis, transformer identity and site commissioning must be verified before operational use. No operational EKF prediction warnings are enabled.",
    ]
    if not data.empty:
        peak = data.loc[data.gic_a.abs().idxmax()]
        statistics = {"mean_a": float(data.gic_a.mean()), "std_a": float(data.gic_a.std()) if len(data)>1 else 0.,
            "min_a": float(data.gic_a.min()), "max_a": float(data.gic_a.max()),
            "peak_abs_a": abs(float(peak.gic_a)), "peak_time": str(peak.time),
            "p95_abs_a": float(data.gic_a.abs().quantile(.95)), "first_sample": str(data.time.iloc[0]), "last_sample": str(data.time.iloc[-1])}
        interpretation.insert(0, f"At {station_id}, the signed peak was {peak.gic_a:.3f} A at {peak.time}; magnitude {abs(peak.gic_a):.3f} A. Positive and negative values are retained; physical direction requires the station polarity convention.")
    else:
        interpretation.insert(0, "No valid transformer-neutral GIC observations are available in the requested window. Check the logger export, gateway receipts and sensor quality flags.")
    correlation = None
    if not data.empty and sw_df is not None and not sw_df.empty and 'kp' in sw_df:
        current = data.set_index(pd.to_datetime(data.time, utc=True)).gic_a.abs().resample('10min').max()
        weather = sw_df.set_index(pd.to_datetime(sw_df.time, utc=True))
        merged = pd.DataFrame({'gic': current}).join(weather[[key for key in ('kp','dst') if key in weather]].resample('10min').mean())
        kp_pairs = merged.dropna(subset=['gic','kp'])
        if len(kp_pairs) >= 8 and kp_pairs.gic.std() > 0 and kp_pairs.kp.std() > 0:
            dst_pairs = merged.dropna(subset=['gic','dst']) if 'dst' in merged else pd.DataFrame()
            correlation = {'kp_r': float(kp_pairs.gic.corr(kp_pairs.kp)),
                'dst_r': float(dst_pairs.gic.corr(dst_pairs.dst)) if len(dst_pairs)>=8 and dst_pairs.gic.std()>0 and dst_pairs.dst.std()>0 else None,
                'samples': len(kp_pairs)}
            interpretation.append("Correlation uses overlapping 10-minute maximum |GIC| and mean index bins without gap filling. Repeated Kp values are not independent measurements; correlation does not establish storm causation.")
    return {"station_id": station_id, "period": period, "period_label": meta["label"],
        "window_start": start.isoformat(), "window_end": now.isoformat(), "generated_utc": now.isoformat(),
        "sample_count": len(data), "statistics": statistics, "band_minutes": band_minutes(df, config),
        "events": detect_events(df, config), "kp_correlation": correlation, "interpretation": interpretation,
        "coverage": summary["coverage"], "configuration": config,
        "duration_method": summary["duration_note"], "event_threshold_a": summary["event_threshold_a"],
        "validation": validate_ekf(df, config.get("expected_cadence_seconds")),
        "source": "gic_log / transformer-neutral field observations", "units": "A"}


def report_to_csv(report, df):
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["ZINGSA GIC scientific report"])
    for key in ("station_id", "period_label", "window_start", "window_end", "generated_utc", "sample_count", "source", "duration_method"):
        writer.writerow([key, report.get(key)])
    for key, value in report.get("coverage", {}).items(): writer.writerow(["coverage."+key, value])
    writer.writerow(["site_configuration", json.dumps(report.get("configuration", {}))])
    for key, value in (report.get("statistics") or {}).items(): writer.writerow([key, value])
    for note in report.get("interpretation", []): writer.writerow(["interpretation", note])
    writer.writerow(["monitoring_category", "observed_minutes", "samples"])
    for band in report.get("band_minutes", []): writer.writerow([band["level"], band["minutes"], band["samples"]])
    if report.get("kp_correlation"): writer.writerow(["correlation", json.dumps(report["kp_correlation"])])
    writer.writerow(["event_start", "event_end", "duration_min", "peak_gic_a", "polarity"])
    for event in report.get("events", []): writer.writerow([event["start"], event["end"], event["duration_min"], event["peak_gic_a"], event.get("polarity")])
    writer.writerow(["time_utc", "station_id", "gic_a", "temp_c", "source", "units", "original_time", "quality_flags", "metadata", "received_at"])
    for row in df.to_dict("records"):
        writer.writerow([row.get("time"), row.get("station_id"), row.get("gic_a"), row.get("temp_c"), row.get("source"), row.get("units", "A"), row.get("original_time"), json.dumps(row.get("quality_flags", [])), json.dumps(row.get("metadata", {})), row.get("received_at")])
    return output.getvalue()
