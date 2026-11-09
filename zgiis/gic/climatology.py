"""Research aggregation of field observations; weather grouping is descriptive."""
from __future__ import annotations
import pandas as pd
from zgiis.gic.quality import valid_frame
from zgiis.gic.operations import observation_summary


def climatology(df, sw_df, configuration, grouping="daily", seasons=None):
    data = valid_frame(df)
    if grouping not in {"daily", "monthly", "seasonal", "annual", "diurnal"}:
        raise ValueError("Choose daily, monthly, seasonal, annual or diurnal")
    if grouping == "seasonal":
        groups = seasons or {}
        months = [month for values in groups.values() for month in values]
        if sorted(months) != list(range(1,13)):
            raise ValueError("Seasonal research requires explicit approved month groups covering each month exactly once")
    if data.empty:
        return {"grouping": grouping, "rows": [], "note": "No valid stored field observations; no climatology generated"}
    data["time"] = pd.to_datetime(data.time, utc=True)
    data["context"] = "Unclassified geomagnetic context"
    if sw_df is not None and not sw_df.empty and "kp" in sw_df:
        sw = sw_df[["time", "kp"]].dropna().copy()
        sw["time"] = pd.to_datetime(sw.time, utc=True)
        matched = pd.merge_asof(data[["time"]].sort_values("time"), sw.sort_values("time"), on="time", direction="backward", tolerance=pd.Timedelta("3h"))
        data["context"] = ["Planetary storm context (Kp >= 5)" if pd.notna(kp) and kp >=5 else "Below storm threshold (not a local quiet baseline)" if pd.notna(kp) else "Unclassified geomagnetic context" for kp in matched.kp]
    local = data.time.dt.tz_convert("Africa/Harare")
    if grouping == "daily": data["group"] = local.dt.strftime("%Y-%m-%d")
    elif grouping == "monthly": data["group"] = local.dt.strftime("%Y-%m")
    elif grouping == "annual": data["group"] = local.dt.strftime("%Y")
    elif grouping == "diurnal": data["group"] = local.dt.strftime("%H:00 CAT")
    else:
        def season(t):
            name, months = next((name, months) for name, months in groups.items() if t.month in months)
            # Group wrapping seasons by their ending year, preserving the supplied ordering.
            wraps = any(a>b for a,b in zip(months, months[1:]))
            year = t.year+int(wraps and t.month>=months[0])
            return f"{year} / {name}"
        data["group"] = local.map(season)
    rows=[]
    for (key, context), frame in data.groupby(["group", "context"]):
        rows.append({"period": key, "geomagnetic_context": context, "samples": len(frame),
            "mean_signed_a": float(frame.gic_a.mean()), "median_signed_a": float(frame.gic_a.median()),
            "peak_abs_a": float(frame.gic_a.abs().max()), "p95_abs_a": float(frame.gic_a.abs().quantile(.95)),
            "positive_samples": int((frame.gic_a>0).sum()), "negative_samples": int((frame.gic_a<0).sum())})
    return {"grouping": grouping, "timezone": "Africa/Harare (UTC+02:00)", "rows": rows, "seasons": seasons,
            "note": "Descriptive field statistics, not a validated climatological baseline. Planetary Kp context uses backward matching within 3h; it does not prove the current is storm-driven. Seasonal labels do not imply weather causes GIC. Completeness must be read from the window coverage assessment."}
