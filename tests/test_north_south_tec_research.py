"""Tests for North–South Zimbabwe VTEC research calculations."""

from __future__ import annotations

from zgiis.processing.north_south_tec_research import (
    group_boundaries_from_stations,
    linear_regression,
    observation_completeness,
    pairwise_delta_vtec,
    pairwise_latitudinal_gradient,
    quality_control_flags,
    station_statistics,
    suggest_north_south_transect,
    synchronize_pairs,
    utc_iso_to_cat_hour,
    zimbabwe_lat_band,
)


def test_zimbabwe_lat_band_catalog_thresholds():
    assert zimbabwe_lat_band(-16.5) == "northern"
    assert zimbabwe_lat_band(-19.0) == "central"
    assert zimbabwe_lat_band(-21.0) == "southern"


def test_utc_to_cat_conversion():
    # 12:00 UTC → 14:00 CAT
    assert utc_iso_to_cat_hour("2026-09-20T12:00:00Z") == 14.0
    # 22:30 UTC → 00:30 CAT next calendar day locally, hour=0.5
    assert abs(utc_iso_to_cat_hour("2026-09-20T22:30:00Z") - 0.5) < 1e-9


def test_pairwise_delta_and_gradient_example():
    """Mathematical verification: N=-16°, S=-22°, VTEC 30 vs 24 → +1 TECU/°.

    This is a math check only — not measured Zimbabwean data.
    """
    assert pairwise_delta_vtec(30.0, 24.0) == 6.0
    g = pairwise_latitudinal_gradient(30.0, 24.0, -16.0, -22.0)
    assert g is not None
    assert abs(g - 1.0) < 1e-9


def test_zero_latitude_separation_refuses_gradient():
    assert pairwise_latitudinal_gradient(30.0, 24.0, -18.0, -18.0) is None
    assert pairwise_latitudinal_gradient(30.0, 24.0, -18.0, -18.05) is None


def test_multi_station_regression_slope():
    # VTEC = 10 + 2 * lat  → slope ≈ 2
    lats = [-16.0, -18.0, -20.0, -22.0]
    vtecs = [10 + 2 * lat for lat in lats]
    reg = linear_regression(lats, vtecs)
    assert reg["n"] == 4
    assert reg["slope"] is not None
    assert abs(float(reg["slope"]) - 2.0) < 1e-6
    assert reg["r_squared"] is not None
    assert float(reg["r_squared"]) > 0.999


def test_regression_requires_two_stations():
    reg = linear_regression([-17.0], [25.0])
    assert reg["slope"] is None
    assert reg["n"] == 1


def test_synchronize_pairs_tolerance():
    north = [
        {"timestamp_utc": "2026-09-20T12:00:00Z", "vtec_tecu": 30.0},
        {"timestamp_utc": "2026-09-20T13:00:00Z", "vtec_tecu": 28.0},
    ]
    south = [
        {"timestamp_utc": "2026-09-20T12:05:00Z", "vtec_tecu": 24.0},
        {"timestamp_utc": "2026-09-20T15:00:00Z", "vtec_tecu": 20.0},
    ]
    pairs = synchronize_pairs(north, south, tolerance_s=600)
    assert len(pairs) == 1
    assert pairs[0]["delta_vtec"] == 6.0
    assert abs(pairs[0]["sync_offset_s"]) == 300.0


def test_missing_data_not_zero_filled():
    stats = station_statistics([])
    assert stats["mean"] is None
    assert stats["n"] == 0
    qc = quality_control_flags([10.0, None, -1.0, float("nan")])
    assert qc["missing"] == 1
    assert qc["negative"] == 1
    assert qc["invalid"] >= 1


def test_observation_completeness():
    c = observation_completeness(90, 100)
    assert c["completeness_pct"] == 90.0
    assert c["status"] == "good"
    assert c["missing"] == 10


def test_suggest_transect_maximizes_lat_span():
    stations = [
        {"station_id": "kari", "lat": -16.5, "lon": 28.8, "latest_vtec": 20.0},
        {"station_id": "hara", "lat": -17.8, "lon": 31.0, "latest_vtec": 18.0},
        {"station_id": "gwer", "lat": -19.5, "lon": 29.8, "latest_vtec": 15.0},
        {"station_id": "beit", "lat": -22.2, "lon": 30.0, "latest_vtec": 12.0},
        {"station_id": "far_east", "lat": -19.0, "lon": 40.0, "latest_vtec": 14.0},
    ]
    transect = suggest_north_south_transect(stations, max_stations=4)
    assert transect[0] == "kari"
    assert transect[-1] == "beit"
    assert "far_east" not in transect or transect.index("far_east")  # may or may not
    # Lat span of selection should include kari and beit
    assert "kari" in transect and "beit" in transect


def test_group_boundaries_fallback_and_tertile():
    fb = group_boundaries_from_stations([-17.0, -19.0, -21.0])
    assert fb["method"] == "catalog_thresholds"
    lats = [-16 + i * 0.5 for i in range(12)]
    tb = group_boundaries_from_stations(lats)
    assert tb["method"] == "tertile_from_operational_stations"
    assert tb["northern_min_lat"] > tb["central_min_lat"]
