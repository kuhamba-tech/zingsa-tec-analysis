"""TEC anomaly analysis: storm-day marking, DOY comparison, EIA indicators."""

from __future__ import annotations

from datetime import date
from typing import Any

import numpy as np
import pandas as pd

from tec_core import mark_storm_days


def build_daily_archive(df: pd.DataFrame, station: str | None = None) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=["date", "mean_vtec", "max_vtec", "min_vtec", "samples"])
    work = df.copy()
    if station and "station" in work.columns:
        work = work[work["station"] == station]
    work["date"] = pd.to_datetime(work.get("date", work.get("timestamp")), errors="coerce")
    work = work.dropna(subset=["date"])
    daily = (
        work.groupby(work["date"].dt.floor("D"))
        .agg(
            mean_vtec=("vtec", "mean"),
            max_vtec=("vtec", "max"),
            min_vtec=("vtec", "min"),
            samples=("vtec", "count"),
        )
        .reset_index()
        .rename(columns={"date": "date"})
    )
    daily["date"] = pd.to_datetime(daily["date"]).dt.floor("D")
    return daily


def list_archive_stations(df: pd.DataFrame) -> list[str]:
    if df.empty or "station" not in df.columns:
        return []
    return sorted({str(s) for s in df["station"].dropna().unique()})


def _kp_df_from_gfz_rows(rows: list[dict[str, Any]]) -> pd.DataFrame:
    if not rows:
        return pd.DataFrame(columns=["date", "kp_index"])
    return pd.DataFrame(
        [{"date": r["date"], "kp_index": r["kp"]} for r in rows if r.get("kp") is not None]
    )


def _geomagnetic_daily_from_gfz_and_kyoto(
    start: date,
    end: date,
    gfz_rows: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], bool, bool]:
    """Daily Kp (GFZ) and Dst (WDC Kyoto) for archive date range."""
    dst_by_date: dict[str, float] = {}
    try:
        from zgiis.space_weather.wdc_kyoto_client import fetch_kyoto_daily

        for row in fetch_kyoto_daily(start, end):
            dst = row.get("dst")
            if dst is not None:
                dst_by_date[str(row["date"])] = float(dst)
    except Exception:
        pass

    kp_by_date = {str(r["date"]): r.get("kp") for r in gfz_rows if r.get("kp") is not None}
    all_dates = sorted(set(kp_by_date) | set(dst_by_date))
    daily = [
        {
            "date": day,
            "kp": float(kp_by_date[day]) if day in kp_by_date else None,
            "dst": dst_by_date.get(day),
        }
        for day in all_dates
    ]
    return daily, bool(kp_by_date), bool(dst_by_date)


def fetch_geomagnetic_daily(
    start: date,
    end: date,
    *,
    gfz_rows: list[dict[str, Any]] | None = None,
) -> tuple[list[dict[str, Any]], bool, bool]:
    """Daily Kp (GFZ) and Dst (WDC Kyoto) for archive date range."""
    rows = gfz_rows
    if rows is None:
        try:
            from zgiis.space_weather.gfz_kp_client import fetch_gfz_daily

            rows = fetch_gfz_daily(start, end)
        except Exception:
            rows = []
    return _geomagnetic_daily_from_gfz_and_kyoto(start, end, rows)


def fetch_kp_df(
    start: date,
    end: date,
    *,
    gfz_rows: list[dict[str, Any]] | None = None,
) -> pd.DataFrame:
    if gfz_rows is not None:
        return _kp_df_from_gfz_rows(gfz_rows)
    try:
        from zgiis.space_weather.gfz_kp_client import fetch_gfz_daily

        return _kp_df_from_gfz_rows(fetch_gfz_daily(start, end))
    except Exception:
        return pd.DataFrame(columns=["date", "kp_index"])


def _geomagnetic_lookup(daily_geo: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {str(row["date"]): row for row in daily_geo}


def enrich_anomaly_days(
    daily: pd.DataFrame,
    kp_df: pd.DataFrame,
    threshold_pct: int = 95,
    geomagnetic: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    if daily.empty:
        return []

    threshold = float(daily["mean_vtec"].quantile(threshold_pct / 100.0))
    marked = mark_storm_days(
        daily.copy(),
        kp_df=kp_df if not kp_df.empty else None,
        vtec_percentile=threshold_pct / 100.0,
    )

    days: list[dict[str, Any]] = []
    for _, row in marked.iterrows():
        d = row["date"]
        date_str = d.strftime("%Y-%m-%d") if hasattr(d, "strftime") else str(d)[:10]
        kp_val = row.get("kp_index")
        tec_z = row.get("tec_response_z")
        tec_dev = row.get("tec_deviation_tecu")
        max_vtec = row.get("max_vtec")
        geo = (geomagnetic or {}).get(date_str, {})
        dst_val = geo.get("dst")
        days.append(
            {
                "date": date_str,
                "mean_vtec": float(row["mean_vtec"]),
                "max_vtec": float(max_vtec) if pd.notna(max_vtec) else None,
                "anomaly": bool(row["mean_vtec"] >= threshold),
                "threshold": threshold,
                "tec_anomaly_flag": bool(row.get("tec_anomaly_flag", False)),
                "storm_flag": bool(row.get("storm_flag", False)),
                "kp_storm_flag": bool(row.get("kp_storm_flag", False)),
                "kp": float(kp_val) if pd.notna(kp_val) else None,
                "dst": float(dst_val) if dst_val is not None else None,
                "kp_severity": row.get("kp_severity"),
                "tec_response": row.get("tec_response"),
                "tec_response_z": float(tec_z) if pd.notna(tec_z) else None,
                "tec_deviation_tecu": float(tec_dev) if pd.notna(tec_dev) else None,
            }
        )
    return days


def build_storm_comparison(daily: pd.DataFrame, kp_df: pd.DataFrame) -> list[dict[str, Any]]:
    if daily.empty or kp_df.empty:
        return []

    work = daily.copy()
    work["date"] = pd.to_datetime(work["date"]).dt.floor("D")
    kp = kp_df.copy()
    kp["date"] = pd.to_datetime(kp["date"]).dt.floor("D")
    merged = work.merge(kp[["date", "kp_index"]], on="date", how="inner")
    if merged.empty:
        return []

    merged["doy"] = merged["date"].dt.dayofyear
    quiet = merged[merged["kp_index"] < 3]
    storm = merged[merged["kp_index"] >= 5]
    all_doys = sorted(set(quiet["doy"].tolist()) | set(storm["doy"].tolist()))
    quiet_by_doy = quiet.groupby("doy")["mean_vtec"].mean()
    storm_by_doy = storm.groupby("doy")["mean_vtec"].mean()
    return [
        {
            "doy": int(doy),
            "quiet_mean_vtec": float(quiet_by_doy[doy]) if doy in quiet_by_doy.index else None,
            "storm_mean_vtec": float(storm_by_doy[doy]) if doy in storm_by_doy.index else None,
        }
        for doy in all_doys
    ]


def compute_diurnal(df: pd.DataFrame, station: str | None = None) -> list[dict[str, Any]]:
    if df.empty:
        return []
    work = df.copy()
    if station and "station" in work.columns:
        work = work[work["station"] == station]
    if "time_hours" in work.columns:
        work["hour"] = work["time_hours"].astype(int) % 24
    elif "timestamp" in work.columns:
        work["hour"] = pd.to_datetime(work["timestamp"]).dt.hour
    else:
        work["hour"] = pd.to_datetime(work.get("date", work.get("timestamp"))).dt.hour
    grp = work.groupby("hour")["vtec"].agg(["mean", "std"]).reset_index()
    return [
        {
            "hour": int(r["hour"]),
            "mean_vtec": float(r["mean"]),
            "std_vtec": float(r["std"] or 0),
        }
        for _, r in grp.iterrows()
    ]


def compute_seasonal(df: pd.DataFrame, station: str | None = None) -> list[dict[str, Any]]:
    if df.empty:
        return []
    work = df.copy()
    if station and "station" in work.columns:
        work = work[work["station"] == station]
    work["date"] = pd.to_datetime(work.get("date", work.get("timestamp")))
    work["month"] = work["date"].dt.month
    work["season"] = pd.cut(
        work["month"],
        bins=[0, 3, 6, 9, 12],
        labels=["Jan–Mar (Summer)", "Apr–Jun (Autumn)", "Jul–Sep (Winter)", "Oct–Dec (Spring)"],
    )
    grp = work.groupby("season", observed=True)["vtec"].agg(["mean", "max", "min", "std"]).reset_index()
    return [
        {
            "season": str(r["season"]),
            "mean": float(r["mean"]),
            "max": float(r["max"]),
            "min": float(r["min"]),
            "std": float(r["std"] or 0),
        }
        for _, r in grp.iterrows()
    ]


def compute_solar_cycle(df: pd.DataFrame, station: str | None = None) -> list[dict[str, Any]]:
    if df.empty:
        return []
    work = df.copy()
    if station and "station" in work.columns:
        work = work[work["station"] == station]
    work["date"] = pd.to_datetime(work.get("date", work.get("timestamp")))
    work["year"] = work["date"].dt.year
    grp = work.groupby("year")["vtec"].agg(["mean", "max", "min"]).reset_index()
    return [
        {
            "year": int(r["year"]),
            "mean_vtec": float(r["mean"]),
            "max_vtec": float(r["max"]),
            "min_vtec": float(r["min"]),
        }
        for _, r in grp.iterrows()
    ]


def build_eia_summary(
    diurnal: list[dict[str, Any]],
    seasonal: list[dict[str, Any]],
    days: list[dict[str, Any]],
) -> dict[str, Any]:
    empty = {
        "peak_hour_utc": None,
        "post_sunset_peak_hour_utc": None,
        "post_sunset_mean_vtec": None,
        "daytime_mean_vtec": None,
        "peak_season": None,
        "anomaly_day_count": 0,
        "storm_confirmed_count": 0,
    }
    if not diurnal:
        return empty

    peak = max(diurnal, key=lambda p: p["mean_vtec"])
    post = [p for p in diurnal if 18 <= p["hour"] <= 23]
    daytime = [p for p in diurnal if 6 <= p["hour"] <= 17]
    post_peak = max(post, key=lambda p: p["mean_vtec"]) if post else None
    peak_season = max(seasonal, key=lambda s: s["mean"])["season"] if seasonal else None
    return {
        "peak_hour_utc": peak["hour"],
        "post_sunset_peak_hour_utc": post_peak["hour"] if post_peak else None,
        "post_sunset_mean_vtec": float(np.mean([p["mean_vtec"] for p in post])) if post else None,
        "daytime_mean_vtec": float(np.mean([p["mean_vtec"] for p in daytime])) if daytime else None,
        "peak_season": peak_season,
        "anomaly_day_count": sum(1 for d in days if d.get("anomaly")),
        "storm_confirmed_count": sum(1 for d in days if d.get("anomaly") and d.get("storm_flag")),
    }


def build_anomaly_analysis(
    df: pd.DataFrame,
    *,
    station: str | None = None,
    threshold_pct: int = 95,
) -> dict[str, Any]:
    stations = list_archive_stations(df)
    daily = build_daily_archive(df, station)
    empty_eia = build_eia_summary([], [], [])

    if daily.empty:
        return {
            "days": [],
            "storm_comparison": [],
            "eia": empty_eia,
            "stations": stations,
            "kp_available": False,
            "dst_available": False,
            "geomagnetic_daily": [],
            "diurnal": [],
            "seasonal": [],
            "solar_cycle": [],
        }

    start = daily["date"].min().date()
    end = daily["date"].max().date()
    gfz_rows: list[dict[str, Any]] = []
    try:
        from zgiis.space_weather.gfz_kp_client import fetch_gfz_daily

        gfz_rows = fetch_gfz_daily(start, end)
    except Exception:
        gfz_rows = []
    geomagnetic_daily, kp_available, dst_available = fetch_geomagnetic_daily(
        start, end, gfz_rows=gfz_rows
    )
    geo_lookup = _geomagnetic_lookup(geomagnetic_daily)
    kp_df = fetch_kp_df(start, end, gfz_rows=gfz_rows)
    days = enrich_anomaly_days(daily, kp_df, threshold_pct, geomagnetic=geo_lookup)
    storm_comparison = build_storm_comparison(daily, kp_df)
    diurnal = compute_diurnal(df, station)
    seasonal = compute_seasonal(df, station)
    solar_cycle = compute_solar_cycle(df, station)
    eia = build_eia_summary(diurnal, seasonal, days)

    return {
        "days": days,
        "storm_comparison": storm_comparison,
        "eia": eia,
        "stations": stations,
        "kp_available": kp_available,
        "dst_available": dst_available,
        "geomagnetic_daily": geomagnetic_daily,
        "diurnal": diurnal,
        "seasonal": seasonal,
        "solar_cycle": solar_cycle,
    }
