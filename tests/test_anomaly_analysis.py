"""Tests for TEC anomaly analysis helpers."""

from __future__ import annotations

import pandas as pd

from zgiis.processing.anomaly_analysis import (
    build_daily_archive,
    build_eia_summary,
    build_storm_comparison,
    compute_solar_cycle,
    enrich_anomaly_days,
)


def test_build_daily_archive_groups_by_date():
    df = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(["2024-04-01 10:00", "2024-04-01 12:00", "2024-04-02 08:00"]),
            "vtec": [10.0, 14.0, 12.0],
            "station": ["KARO", "KARO", "KARO"],
        }
    )
    daily = build_daily_archive(df)
    assert len(daily) == 2
    assert daily.iloc[0]["mean_vtec"] == 12.0
    assert daily.iloc[0]["max_vtec"] == 14.0


def test_enrich_anomaly_days_marks_percentile_anomalies():
    daily = pd.DataFrame(
        {
            "date": pd.to_datetime(["2024-04-01", "2024-04-02", "2024-04-03", "2024-04-04"]),
            "mean_vtec": [10.0, 11.0, 12.0, 30.0],
            "max_vtec": [11.0, 12.0, 13.0, 35.0],
            "min_vtec": [9.0, 10.0, 11.0, 28.0],
            "samples": [24, 24, 24, 24],
        }
    )
    kp = pd.DataFrame({"date": ["2024-04-04"], "kp_index": [6.0]})
    days = enrich_anomaly_days(daily, kp, threshold_pct=75)
    by_date = {d["date"]: d for d in days}
    assert by_date["2024-04-04"]["anomaly"] is True
    assert by_date["2024-04-04"]["storm_flag"] is True
    assert by_date["2024-04-04"]["kp"] == 6.0


def test_build_storm_comparison_by_doy():
    daily = pd.DataFrame(
        {
            "date": pd.to_datetime(["2024-01-15", "2024-02-20", "2024-03-10"]),
            "mean_vtec": [10.0, 20.0, 15.0],
            "max_vtec": [12.0, 22.0, 17.0],
            "min_vtec": [8.0, 18.0, 13.0],
            "samples": [24, 24, 24],
        }
    )
    kp = pd.DataFrame(
        {
            "date": pd.to_datetime(["2024-01-15", "2024-02-20", "2024-03-10"]),
            "kp_index": [2.0, 6.0, 5.0],
        }
    )
    rows = build_storm_comparison(daily, kp)
    assert len(rows) >= 2
    storm_row = next(r for r in rows if r["storm_mean_vtec"] is not None)
    assert storm_row["storm_mean_vtec"] >= 15.0


def test_build_eia_summary_post_sunset():
    diurnal = [{"hour": h, "mean_vtec": v, "std_vtec": 1.0} for h, v in [(12, 20.0), (20, 35.0), (22, 30.0)]]
    seasonal = [{"season": "Jan–Mar (Summer)", "mean": 18.0, "max": 25.0, "min": 10.0, "std": 2.0}]
    days = [{"anomaly": True, "storm_flag": True}, {"anomaly": False, "storm_flag": False}]
    eia = build_eia_summary(diurnal, seasonal, days)
    assert eia["post_sunset_peak_hour_utc"] == 20
    assert eia["anomaly_day_count"] == 1
    assert eia["storm_confirmed_count"] == 1


def test_compute_solar_cycle_by_station():
    df = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(["2023-06-01", "2024-06-01"]),
            "vtec": [10.0, 20.0],
            "station": ["hara", "hara"],
        }
    )
    rows = compute_solar_cycle(df, "hara")
    assert len(rows) == 2
    assert rows[1]["mean_vtec"] == 20.0


def test_enrich_anomaly_days_includes_dst():
    daily = pd.DataFrame(
        {
            "date": pd.to_datetime(["2024-04-04"]),
            "mean_vtec": [30.0],
            "max_vtec": [35.0],
            "min_vtec": [28.0],
            "samples": [24],
        }
    )
    kp = pd.DataFrame({"date": ["2024-04-04"], "kp_index": [6.0]})
    geo = {"2024-04-04": {"date": "2024-04-04", "kp": 6.0, "dst": -85.0}}
    days = enrich_anomaly_days(daily, kp, threshold_pct=50, geomagnetic=geo)
    assert days[0]["dst"] == -85.0
