import json

import pandas as pd

from zgiis.processing.anomaly_analysis import build_daily_archive, enrich_anomaly_days, build_storm_comparison, compute_diurnal


def test_utc_archive_and_naive_kp_dates_join():
    frame = pd.DataFrame({"timestamp": pd.to_datetime(["2024-04-01T22:30:00Z", "2024-04-02T00:30:00Z"]), "vtec": [10.0, 15.0], "station": ["karo", "karo"]})
    daily = build_daily_archive(frame)
    kp = pd.DataFrame({"date": ["2024-04-01", "2024-04-02"], "kp_index": [2.0, 6.0]})
    rows = enrich_anomaly_days(daily, kp)
    assert rows[1]["kp"] == 6
    assert rows[1]["geomagnetic_coincidence"]
    assert build_storm_comparison(daily, kp)


def test_constant_or_single_day_is_not_both_positive_and_negative():
    frame = pd.DataFrame({"timestamp": pd.to_datetime(["2024-04-01T00:00:00Z"]), "vtec": [10.0]})
    rows = enrich_anomaly_days(build_daily_archive(frame), pd.DataFrame())
    assert not rows[0]["anomaly"]
    assert rows[0]["quiet_baseline_tecu"] is None


def test_singleton_diurnal_bin_is_json_serializable():
    frame = pd.DataFrame({"timestamp": ["2024-04-01T01:00:00+02:00"], "vtec": [12.0]})
    rows = compute_diurnal(frame)
    assert rows[0]["hour"] == 23
    json.dumps(rows, allow_nan=False)
