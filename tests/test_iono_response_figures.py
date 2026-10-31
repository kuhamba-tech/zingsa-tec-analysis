"""Dst/Kp figure helpers stay on measured samples."""

import math
from datetime import datetime, timedelta, timezone

from zgiis.space_weather.gfz_kp_client import parse_gfz_kp_txt
from zgiis.space_weather.iono_response_figures import (
    _ekf_rows_reset_on_gaps,
    _rmse_maps,
    ipp_lat_lon,
    lognormal_dividers,
    map_rmse,
    matamba_rmse,
    observation_kept,
    rolling_mean_time,
    rolling_median,
)
from zgiis.space_weather.wdc_kyoto_client import _parse_dst_hourly


GFZ = """
2024 05 10 33768 33768.5 2606  1  5.000  4.000  3.000  2.000  1.000  1.000  0.667  0.333   48   39   18    7    6    4    3    2    16 120    180.0    179.0 2
"""

KYOTO = """
<html><pre>
DAY
 1  10  8  5  4  3  2  1  0 -1 -2 -3 -4 -5 -6 -7 -8 -9 -10 -11 -12 -13 -14 -15 -16
 2  9999 4
</pre></html>
"""


def test_gfz_keeps_three_hour_kp():
    row = parse_gfz_kp_txt(GFZ)["2024-05-10"]
    assert row["kp_3h"][0] == 5.0
    assert row["kp_3h"][7] == 0.333
    assert len(row["kp_3h"]) == 8


def test_kyoto_hourly_dst_skips_missing():
    hourly = _parse_dst_hourly(KYOTO, 2026, 5)
    assert hourly["2026-05-01T00:00:00Z"] == 10.0
    assert hourly["2026-05-01T23:00:00Z"] == -16.0
    assert "2026-05-02T00:00:00Z" not in hourly
    assert hourly["2026-05-02T01:00:00Z"] == 4.0


def test_map_rmse_is_zero_when_the_field_is_flat():
    samples = [(lat, 30.0, 12.0) for lat in (-16.0, -18.0, -20.0, -22.0)]
    assert map_rmse(samples) is not None
    assert map_rmse(samples) < 1e-9


def test_map_rmse_needs_four_stations():
    assert map_rmse([(-18.0, 30.0, 10.0), (-19.0, 31.0, 12.0)]) is None


def test_rmse_filter_restarts_after_a_long_gap():
    points = [
        ("2026-09-23T18:00:00Z", 4.0),
        ("2026-09-23T19:00:00Z", 9.0),
        ("2026-09-24T13:00:00Z", 2.5),
    ]
    rows = _ekf_rows_reset_on_gaps(points, "rmse")
    assert rows[2]["ekf"] is None
    assert all(row["ekf"] is None or row["ekf"] < 15 for row in rows)


def test_rolling_median_waits_for_enough_samples():
    values = [1.0] * 11 + [9.0]
    assert rolling_median(values, window=84)[10] is None
    assert rolling_median(values, window=84)[-1] == 1.0


def test_matamba_rmse_is_zero_on_a_flat_field():
    rmse = matamba_rmse(
        [-19.2, -19.2, -19.4, -19.6, -18.2, -18.3, -18.4, -18.6],
        [30.2, 30.4, 30.6, 30.8, 31.2, 31.4, 31.6, 31.8],
        [12.0] * 8,
    )
    assert rmse is not None
    assert rmse < 1e-9


def test_matamba_rmse_matches_the_cell_median():
    rmse = matamba_rmse(
        [-19.2] * 8,
        [30.2] * 8,
        [10.0, 10.0, 10.0, 10.0, 14.0, 14.0, 14.0, 14.0],
    )
    assert rmse is not None
    assert abs(rmse - 2.0) < 1e-9


def test_matamba_rmse_drops_tec_above_50():
    kept = matamba_rmse([-19.2] * 8, [30.2] * 8, [12.0] * 8)
    with_outlier = matamba_rmse([-19.2] * 9, [30.2] * 9, [12.0] * 8 + [60.0])
    assert kept is not None and with_outlier is not None
    assert abs(kept - with_outlier) < 1e-9
    assert matamba_rmse([-19.2] * 7, [30.2] * 7, [12.0] * 7) is None


def test_observation_bounds_follow_the_platform_mask():
    assert observation_kept(0.0, 30.0)
    assert observation_kept(50.0, 90.0)
    assert not observation_kept(0.0, 29.9)
    assert not observation_kept(-0.1, 30.0)
    assert not observation_kept(50.1, 30.0)
    assert not observation_kept(12.0, 19.9)


def test_zenith_pierce_point_is_the_station():
    lat, lon = ipp_lat_lon(-19.0, 29.5, 90.0, 0.0)
    assert abs(lat + 19.0) < 1e-6
    assert abs(lon - 29.5) < 1e-6
    north, _same = ipp_lat_lon(-19.0, 29.5, 30.0, 0.0)
    assert north > -19.0 + 3.0


def test_five_minute_maps_use_a_fifteen_minute_window():
    start = datetime(2026, 5, 1, tzinfo=timezone.utc)
    samples = []
    for minute in range(1, 31):
        moment = start + timedelta(minutes=minute)
        samples.append((moment, -19.2, 30.2, 12.0))
        samples.append((moment, -18.2, 31.2, 12.0))
    maps = _rmse_maps(samples)
    assert maps
    assert all(item[1] == 0.0 for item in maps)
    assert maps[0][0] == "2026-05-01T00:05:00Z"
    assert all(int(item[0][14:16]) % 5 == 0 for item in maps)


def test_lognormal_dividers_need_a_sample():
    assert lognormal_dividers([1.0] * 47) == (None, None)
    low, high = lognormal_dividers([1.0] * 24 + [math.e] * 24)
    assert low is not None and high is not None
    assert low < 1.0 < math.e < high


def test_rolling_mean_is_the_trailing_average():
    stamps = [
        "2026-05-01T00:00:00Z",
        "2026-05-01T01:00:00Z",
        "2026-05-01T02:00:00Z",
    ]
    assert rolling_mean_time(stamps, [2.0, 4.0, 6.0], hours=1, minimum=1) == [2.0, 3.0, 5.0]


def test_cold_ephemeris_download_is_shared_and_never_blocks_request(monkeypatch, tmp_path):
    from concurrent.futures import Future
    from datetime import date
    import pandas as pd
    import zgiis.space_weather.iono_response_figures as figures

    future = Future()
    submissions = []

    class Pool:
        def submit(self, fn, day):
            submissions.append(day)
            return future

    monkeypatch.setattr(figures, "_BRDC_DIR", tmp_path)
    monkeypatch.setattr(figures, "_nav_pool", Pool())
    monkeypatch.setattr(figures, "_nav_jobs", {})
    monkeypatch.setattr(figures, "_nav_failed_at", {})
    monkeypatch.setattr(figures, "_failed_at", {})
    day = date(2026, 5, 1)
    assert figures._nav_frame(day) is None
    assert figures._nav_frame(day) is None
    assert submissions == [day]
    frame = pd.DataFrame({"sv": ["G01"]})
    future.set_result(frame)
    figures._failed_at[day.isoformat()] = 1.0
    assert figures._nav_frame(day) is frame
    assert day.isoformat() not in figures._failed_at


def test_failed_ephemeris_download_is_not_retried_on_every_poll(monkeypatch, tmp_path):
    from concurrent.futures import Future
    from datetime import date
    import zgiis.space_weather.iono_response_figures as figures

    future = Future()
    future.set_result(None)
    day = date(2026, 5, 1)
    monkeypatch.setattr(figures, "_BRDC_DIR", tmp_path)
    monkeypatch.setattr(figures, "_nav_jobs", {day: future})
    monkeypatch.setattr(figures, "_nav_failed_at", {})
    assert figures._nav_frame(day) is None
    assert figures._nav_frame(day) is None
    assert day not in figures._nav_jobs


def test_rmse_releases_database_connection_after_failed_read(monkeypatch):
    import pytest
    import zgiis.db.timescale as timescale
    from zgiis.space_weather.iono_response_figures import _code_live_frame

    closed = []

    class BrokenDB:
        _is_pg = True

        def _read_sql(self, *args):
            raise RuntimeError("database offline")

        def close(self):
            closed.append(True)

    monkeypatch.setattr(timescale, "TecDB", BrokenDB)
    with pytest.raises(RuntimeError, match="database offline"):
        _code_live_frame(datetime.now(timezone.utc))
    assert closed == [True]


def test_rmse_history_build_does_not_block_indices_or_start_duplicate_jobs(monkeypatch):
    from concurrent.futures import Future
    import zgiis.space_weather.iono_response_figures as figures

    future = Future()
    submissions = []

    class Pool:
        def submit(self, fn, **kwargs):
            submissions.append(kwargs)
            return future

    monkeypatch.setattr(figures, "_rmse_pool", Pool())
    monkeypatch.setattr(figures, "_rmse_job", None)
    monkeypatch.setattr(figures, "_rmse_cache", None)
    monkeypatch.setattr(figures, "_index_cache", None)
    monkeypatch.setattr(figures, "_kp_series", lambda *args: ([{"kp": 2}], "GFZ"))
    monkeypatch.setattr(figures, "_dst_series", lambda *args: ([{"dst": -5}], "Kyoto"))
    first = figures.build_iono_response_figures()
    again = figures.build_iono_response_figures()
    assert first["kp"] == [{"kp": 2}]
    assert first["dst"] == [{"dst": -5}]
    assert first["rmse"] == again["rmse"] == []
    assert "background" in first["note"]
    assert len(submissions) == 1
    future.set_result(([{"time": "2026-10-30T00:00:00Z", "rmse": 2.0}], []))
    ready = figures.build_iono_response_figures()
    assert ready["rmse"][0]["rmse"] == 2.0
    assert len(submissions) == 1
