"""Tests for live TEC heat-map payload builder."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pandas as pd
import pytest

from zgiis.maps.heatmap_data import build_tec_heatmap


@pytest.fixture(autouse=True)
def _mock_madimbo_didbase():
    with patch(
        "zgiis.maps.heatmap_data.get_madimbo_metadata",
        return_value={
            "code": "MU12K",
            "name": "MADIMBO",
            "lat": -22.39,
            "lon": 30.88,
            "country": "South Africa",
            "source": "DIDBase/IonoWeb",
            "availability_years": [2000, 2019],
            "latest_available_year": 2019,
            "has_near_realtime_public_tec": False,
            "status": "didbase_metadata",
            "note": "mock",
        },
    ):
        yield


def test_build_tec_heatmap_empty_when_no_db_rows():
    with patch("backend.live_manager.get_db") as mock_db, patch(
        "backend.live_manager.latest_vtec_by_station", return_value={}
    ), patch("backend.routers.cors_network._stations", return_value=[]), patch(
        "zgiis.live.ntrip_status_cache.ntrip_probe_enabled", return_value=False
    ), patch(
        "zgiis.maps.heatmap_data._live_ntrip_heatmap_rows", return_value=[]
    ), patch(
        "zgiis.data.tec_archive.load_historical_tec",
        return_value=(pd.DataFrame({"timestamp": [], "station": [], "vtec": []}), {"available": True}),
    ):
        mock_db.return_value.station_summary.return_value = pd.DataFrame()
        mock_db.return_value.query_recent.return_value = pd.DataFrame()
        payload = build_tec_heatmap(hours=2)
    assert payload["available"] is False
    assert payload["stations"] == []
    assert payload["data_quality"] == "none"
    assert "archive" in (payload["message"] or "").lower() or "live" in (payload["message"] or "").lower()


def test_build_tec_heatmap_does_not_fall_back_to_processed_archive():
    archive = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(
                ["2024-04-01 00:00", "2024-04-01 01:00", "2024-04-01 01:00"]
            ),
            "date": pd.to_datetime(["2024-04-01", "2024-04-01", "2024-04-01"]),
            "station": ["hara", "hara", "gsu"],
            "vtec": [10.0, 12.0, 15.0],
            "observations": [5, 6, 7],
        }
    )
    with patch("backend.live_manager.get_db") as mock_db, patch(
        "backend.live_manager.latest_vtec_by_station", return_value={}
    ), patch("backend.routers.cors_network._stations", return_value=[]), patch(
        "zgiis.live.ntrip_status_cache.ntrip_probe_enabled", return_value=False
    ), patch(
        "zgiis.maps.heatmap_data._live_ntrip_heatmap_rows", return_value=[]
    ), patch(
        "zgiis.data.tec_archive.load_historical_tec",
        return_value=(archive, {"available": True}),
    ):
        mock_db.return_value.station_summary.return_value = pd.DataFrame()
        mock_db.return_value.query_recent.return_value = pd.DataFrame()
        payload = build_tec_heatmap(hours=2)

    assert payload["available"] is False
    assert payload["stations"] == []
    assert payload["data_quality"] == "none"


def test_build_tec_heatmap_uses_live_ntrip_samples_when_db_empty():
    live_ntrip_rows = [
        {
            "code": "hara",
            "name": "Harare",
            "lat": -17.78,
            "lon": 31.05,
            "vtec": 34.2,
            "obs_count": 4,
            "source": "live_ntrip",
        }
    ]
    with patch("backend.live_manager.get_db") as mock_db, patch(
        "backend.live_manager.latest_vtec_by_station", return_value={}
    ), patch("backend.routers.cors_network._stations", return_value=[]), patch(
        "zgiis.live.ntrip_status_cache.ntrip_probe_enabled", return_value=False
    ), patch(
        "zgiis.maps.heatmap_data._live_ntrip_heatmap_rows", return_value=live_ntrip_rows
    ):
        mock_db.return_value.station_summary.return_value = pd.DataFrame()
        mock_db.return_value.query_recent.return_value = pd.DataFrame()
        payload = build_tec_heatmap(hours=2)

    assert payload["available"] is True
    rows_by_code = {row["code"]: row for row in payload["stations"]}
    assert rows_by_code["hara"]["source"] == "live_ntrip"
    assert rows_by_code["hara"]["vtec"] == 34.2
    assert rows_by_code["cent"]["source"] == "live_surface_estimate"
    assert payload["data_quality"] in {"stations_only", "station", "regional_mean"}
    assert payload["tec_min"] is not None
    assert payload["tec_max"] is not None


def test_build_tec_heatmap_interpolates_with_three_stations():
    recent = pd.DataFrame(
        {
            "time": pd.to_datetime(
                ["2026-07-15T12:00:00Z", "2026-07-15T12:00:00Z", "2026-07-15T12:00:00Z"]
            ),
            "station": ["hara", "karo", "bula"],
            "vtec_tecu": [18.0, 22.0, 20.0],
            "tec_method": ["gopi_eq_4_11_code_live"] * 3,
        }
    )
    with patch("backend.live_manager.get_db") as mock_db, patch(
        "backend.live_manager.latest_vtec_by_station", return_value={}
    ), patch(
        "zgiis.maps.heatmap_data._live_ntrip_heatmap_rows", return_value=[]
    ), patch("zgiis.live.ntrip_status_cache.ntrip_probe_enabled", return_value=False):
        mock_db.return_value.station_summary.return_value = pd.DataFrame()
        mock_db.return_value.query_recent.return_value = recent
        payload = build_tec_heatmap(hours=2)

    assert payload["available"] is True
    assert payload["station_count"] >= 3
    assert payload["grid"] is not None
    assert payload["grid"]["method"] == "nearest_median"
    assert payload["grid"]["resolution_deg"] == 1.0
    assert payload["data_quality"] in {"station", "regional_mean"}
    assert payload["icao_mod_tecu"] == 125.0
    assert payload["diagnostics"]["matamba"]["cadence_minutes"] == 5
    assert payload["diagnostics"]["matamba"]["window_minutes"] == 15
    assert payload["diagnostics"]["fit"]["control_station_count"] == 3
    assert payload["diagnostics"]["gradients"]["spatial_max_tecu_per_deg"] is not None
    assert payload["diagnostics"]["gradients"]["spatial_lat_max_tecu_per_deg"] is not None
    assert payload["diagnostics"]["gradients"]["spatial_lon_max_tecu_per_deg"] is not None
    assert payload["diagnostics"]["gradients"]["icao_supporting_diagnostic"] is True
    assert payload["diagnostics"]["ionosonde_comparison"]["code"] == "MU12K"
    assert payload["diagnostics"]["ionosonde_comparison"]["source"] in {"DIDBase/IonoWeb", "fallback"}
    border = payload["diagnostics"]["border_station_comparison"]
    assert len(border) > 0
    assert border[0]["distance_km"] <= border[-1]["distance_km"]
    evaluation = payload["diagnostics"]["evaluation"]
    assert evaluation["matched_points_only"] is True
    assert evaluation["comparison_window_days"] == 5
    assert evaluation["comparison_interval_minutes"] == 60
    assert evaluation["rmse_window_minutes"] == 15
    assert [target["code"] for target in evaluation["targets"]] == ["HE13N", "GR13L"]
    assert evaluation["reference_statistics"]["ionosonde_example_correlation"] == 0.96
    assert evaluation["reference_statistics"]["afritec_example_correlation"] == 0.93
    assert any("L1/L2" in item for item in payload["diagnostics"]["frequency_recommendations"])
    assert len(payload["heat_points"]) > 3
    assert payload["tec_min"] is not None
    assert payload["tec_max"] is not None
    rows_by_code = {row["code"]: row for row in payload["stations"]}
    assert rows_by_code["hara"]["source"] == "live"
    assert rows_by_code["cent"]["source"] == "live_surface_estimate"


def test_build_tec_heatmap_drops_neon_spike_stations():
    recent = pd.DataFrame(
        {
            "time": pd.to_datetime(["2026-07-15T12:00:00Z"] * 6),
            "station": ["hara", "masv", "muta", "karo", "kwek", "zinh"],
            "vtec_tecu": [24.0, 16.0, 18.0, 94.0, 119.0, 121.0],
            "tec_method": ["gopi_eq_4_11_code_live"] * 6,
        }
    )
    with patch("backend.live_manager.get_db") as mock_db, patch(
        "backend.live_manager.latest_vtec_by_station", return_value={}
    ), patch(
        "zgiis.maps.heatmap_data._live_ntrip_heatmap_rows", return_value=[]
    ), patch("zgiis.live.ntrip_status_cache.ntrip_probe_enabled", return_value=False):
        mock_db.return_value.query_recent.return_value = recent
        payload = build_tec_heatmap(hours=2)

    measured = {
        row["code"]: row["vtec"]
        for row in payload["stations"]
        if int(row.get("obs_count") or 0) > 0
    }
    assert set(measured) == {"hara", "masv", "muta"}
    assert payload["tec_max"] is not None and payload["tec_max"] < 40
    # Surface fill remains, but spikes must not control the map.
    rows_by_code = {row["code"]: row for row in payload["stations"]}
    assert rows_by_code["cent"]["source"] == "live_surface_estimate"
    assert rows_by_code["cent"]["vtec"] < 40
    assert "karo" not in measured
    assert "kwek" not in measured
    assert "zinh" not in measured


def test_build_tec_heatmap_computes_matamba_temporal_gradient():
    recent = pd.DataFrame(
        {
            "time": pd.to_datetime(
                [
                    "2026-07-15T12:02:00Z",
                    "2026-07-15T12:02:00Z",
                    "2026-07-15T12:02:00Z",
                    "2026-07-15T12:17:00Z",
                    "2026-07-15T12:17:00Z",
                    "2026-07-15T12:17:00Z",
                ]
            ),
            "station": ["hara", "karo", "bula", "hara", "karo", "bula"],
            "vtec_tecu": [20.0, 22.0, 24.0, 30.0, 35.0, 40.0],
            "tec_method": ["gopi_eq_4_11_code_live"] * 6,
        }
    )
    with patch("backend.live_manager.get_db") as mock_db, patch(
        "backend.live_manager.latest_vtec_by_station", return_value={}
    ), patch(
        "zgiis.maps.heatmap_data._live_ntrip_heatmap_rows", return_value=[]
    ), patch("zgiis.live.ntrip_status_cache.ntrip_probe_enabled", return_value=False):
        mock_db.return_value.station_summary.return_value = pd.DataFrame()
        mock_db.return_value.query_recent.return_value = recent
        payload = build_tec_heatmap(hours=2)

    gradients = payload["diagnostics"]["gradients"]
    assert gradients["temporal_available"] is True
    assert gradients["temporal_cadence_minutes"] == 5
    assert gradients["temporal_window_minutes"] == 15
    assert gradients["temporal_max_tecu_per_hour"] is not None
    assert gradients["temporal_mean_tecu_per_hour"] is not None
    assert gradients["temporal_max_tecu_per_hour"] > 0


def test_build_tec_heatmap_uses_live_rows_when_remote_db_env_is_set():
    recent = pd.DataFrame(
        {
            "time": pd.to_datetime(["2026-07-15T12:00:00Z"] * 3),
            "station": ["hara", "karo", "bula"],
            "vtec_tecu": [31.0, 33.0, 32.0],
            "tec_method": ["gopi_eq_4_11_code_live"] * 3,
        }
    )
    archive = pd.DataFrame(
        {
            "timestamp": pd.to_datetime(["2024-04-01 00:00"]),
            "station": ["hara"],
            "vtec": [5.0],
            "observations": [1],
        }
    )
    with patch.dict("os.environ", {"DATABASE_URL": "postgres://example"}, clear=False), patch(
        "backend.live_manager.get_db"
    ) as mock_db, patch(
        "backend.live_manager.latest_vtec_by_station", return_value={}
    ), patch(
        "zgiis.maps.heatmap_data._live_ntrip_heatmap_rows", return_value=[]
    ), patch("zgiis.live.ntrip_status_cache.ntrip_probe_enabled", return_value=False), patch(
        "zgiis.data.tec_archive.load_historical_tec",
        return_value=(archive, {"available": True}),
    ):
        mock_db.return_value.station_summary.return_value = pd.DataFrame()
        mock_db.return_value.query_recent.return_value = recent
        payload = build_tec_heatmap(hours=2)

    rows_by_code = {row["code"]: row for row in payload["stations"]}
    assert payload["available"] is True
    assert payload["data_quality"] in {"station", "regional_mean"}
    assert rows_by_code["hara"]["source"] == "live"
    assert rows_by_code["hara"]["vtec"] == 31.0
    assert rows_by_code["cent"]["source"] == "live_surface_estimate"


def test_build_tec_heatmap_flags_zero_obs_as_regional_mean():
    # Zero-obs rows are not measured controls; builder should yield an empty live map.
    with patch("backend.live_manager.get_db") as mock_db, patch(
        "backend.live_manager.latest_vtec_by_station", return_value={}
    ), patch(
        "zgiis.maps.heatmap_data._live_ntrip_heatmap_rows", return_value=[]
    ), patch("zgiis.live.ntrip_status_cache.ntrip_probe_enabled", return_value=False), patch(
        "backend.routers.cors_network._stations", return_value=[]
    ):
        mock_db.return_value.station_summary.return_value = pd.DataFrame()
        mock_db.return_value.query_recent.return_value = pd.DataFrame()
        payload = build_tec_heatmap(hours=2)

    assert payload["available"] is False
    assert payload["data_quality"] == "none"


def test_build_tec_heatmap_merges_probe_sample_vtec():
    summary = pd.DataFrame()
    recent = pd.DataFrame()
    probe_payload = {
        "probed_at": "2026-07-07T00:00:00Z",
        "stations": [
            {
                "station": "hara",
                "verdict": "msm_streaming",
                "mean_vtec_tecu": 28.4,
                "vtec_sample_count": 5,
            }
        ],
    }

    with patch("backend.live_manager.get_db") as mock_db, patch(
        "backend.live_manager.latest_vtec_by_station", return_value={}
    ), patch("backend.routers.cors_network._stations", return_value=[]), patch(
        "zgiis.live.ntrip_status_cache.ntrip_probe_enabled", return_value=True
    ), patch(
        "zgiis.live.ntrip_status_cache.get_cached_ntrip_probe", return_value=probe_payload
    ), patch(
        "zgiis.maps.heatmap_data._live_ntrip_heatmap_rows", return_value=[]
    ):
        mock_db.return_value.station_summary.return_value = summary
        mock_db.return_value.query_recent.return_value = recent
        payload = build_tec_heatmap(hours=2)

    assert payload["available"] is True
    assert payload["station_count"] >= 1
    rows_by_code = {row["code"]: row for row in payload["stations"]}
    assert rows_by_code["hara"]["source"] == "live"
    assert rows_by_code["hara"]["vtec"] == 28.4
    assert rows_by_code["cent"]["source"] == "live_surface_estimate"
    assert rows_by_code["cent"]["vtec"] == 28.4
    assert payload["data_quality"] in {"stations_only", "station", "regional_mean"}


def test_build_tec_heatmap_merges_cors_current_tec():
    summary = pd.DataFrame()
    recent = pd.DataFrame()
    mock_station = MagicMock()
    mock_station.code = "hara"
    mock_station.name = "Harare"
    mock_station.lat = -17.78140871
    mock_station.lon = 31.04856188
    mock_station.current_tec = 30.9

    with patch("backend.live_manager.get_db") as mock_db, patch(
        "backend.live_manager.latest_vtec_by_station", return_value={}
    ), patch(
        "backend.routers.cors_network._stations", return_value=[mock_station]
    ), patch("zgiis.live.ntrip_status_cache.ntrip_probe_enabled", return_value=False), patch(
        "zgiis.maps.heatmap_data._live_ntrip_heatmap_rows", return_value=[]
    ), patch(
        "zgiis.data.tec_archive.load_historical_tec",
        return_value=(pd.DataFrame(), {"available": False}),
    ):
        mock_db.return_value.station_summary.return_value = summary
        mock_db.return_value.query_recent.return_value = recent
        payload = build_tec_heatmap(hours=2)

    assert payload["available"] is True
    assert payload["station_count"] >= 1
    rows_by_code = {row["code"]: row for row in payload["stations"]}
    assert rows_by_code["hara"]["source"] == "live"
    assert rows_by_code["hara"]["vtec"] == 30.9
    assert rows_by_code["cent"]["source"] == "live_surface_estimate"
    assert payload["grid"] is not None
    assert payload["data_quality"] in {"stations_only", "station", "regional_mean"}
