"""Tests for live TEC heat-map payload builder."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pandas as pd

from zgiis.maps.heatmap_data import build_tec_heatmap


def test_build_tec_heatmap_empty_when_no_db_rows():
    with patch("backend.live_manager.get_db") as mock_db, patch(
        "zgiis.data.tec_archive.load_historical_tec",
        return_value=(pd.DataFrame(), {"available": False}),
    ):
        mock_db.return_value.station_summary.return_value = pd.DataFrame()
        mock_db.return_value.query_recent.return_value = pd.DataFrame()
        payload = build_tec_heatmap(hours=2)
    assert payload["available"] is False
    assert payload["stations"] == []


def test_build_tec_heatmap_falls_back_to_processed_archive():
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
        "zgiis.data.tec_archive.load_historical_tec",
        return_value=(archive, {"available": True}),
    ):
        mock_db.return_value.station_summary.return_value = pd.DataFrame()
        mock_db.return_value.query_recent.return_value = pd.DataFrame()
        payload = build_tec_heatmap(hours=2)

    assert payload["available"] is True
    assert payload["data_quality"] == "processed_archive"
    assert payload["station_count"] >= 2
    rows_by_code = {row["code"]: row for row in payload["stations"]}
    assert rows_by_code["hara"]["source"] == "processed_archive"
    assert rows_by_code["gsu"]["source"] == "processed_archive"
    assert rows_by_code["cent"]["source"] == "processed_archive_estimate"
    assert rows_by_code["cent"]["vtec"] > 0
    assert payload["message"] is not None


def test_build_tec_heatmap_interpolates_with_three_stations():
    summary = pd.DataFrame(
        {
            "station": ["hara", "karo", "bula"],
            "mean_vtec": [18.0, 22.0, 20.0],
            "max_vtec": [20.0, 24.0, 22.0],
            "obs_count": [12, 10, 11],
        }
    )
    with patch("backend.live_manager.get_db") as mock_db:
        mock_db.return_value.station_summary.return_value = summary
        payload = build_tec_heatmap(hours=2)

    assert payload["available"] is True
    assert payload["station_count"] == 24
    assert payload["grid"] is not None
    assert payload["grid"]["method"] == "nearest_median"
    assert payload["grid"]["resolution_deg"] == 1.0
    assert payload["data_quality"] == "regional_mean"
    assert payload["icao_mod_tecu"] == 125.0
    assert payload["diagnostics"]["matamba"]["cadence_minutes"] == 5
    assert payload["diagnostics"]["matamba"]["window_minutes"] == 15
    assert payload["diagnostics"]["fit"]["control_station_count"] == 3
    assert payload["diagnostics"]["gradients"]["spatial_max_tecu_per_deg"] is not None
    assert payload["diagnostics"]["ionosonde_comparison"]["code"] == "MU12K"
    assert any("L1/L2" in item for item in payload["diagnostics"]["frequency_recommendations"])
    assert len(payload["heat_points"]) > 24
    assert payload["tec_min"] is not None
    assert payload["tec_max"] is not None
    rows_by_code = {row["code"]: row for row in payload["stations"]}
    assert rows_by_code["hara"]["source"] == "live"
    assert rows_by_code["cent"]["source"] == "live_surface_estimate"


def test_build_tec_heatmap_uses_live_rows_when_remote_db_env_is_set():
    summary = pd.DataFrame(
        {
            "station": ["hara", "karo", "bula"],
            "mean_vtec": [31.0, 33.0, 32.0],
            "max_vtec": [32.0, 34.0, 33.0],
            "obs_count": [8, 7, 6],
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
        "zgiis.data.tec_archive.load_historical_tec",
        return_value=(archive, {"available": True}),
    ):
        mock_db.return_value.station_summary.return_value = summary
        payload = build_tec_heatmap(hours=2)

    rows_by_code = {row["code"]: row for row in payload["stations"]}
    assert payload["available"] is True
    assert payload["data_quality"] == "regional_mean"
    assert rows_by_code["hara"]["source"] == "live"
    assert rows_by_code["hara"]["vtec"] == 31.0


def test_build_tec_heatmap_flags_zero_obs_as_regional_mean():
    summary = pd.DataFrame(
        {
            "station": ["hara", "karo", "bula"],
            "mean_vtec": [30.0, 31.0, 30.5],
            "max_vtec": [31.0, 32.0, 31.5],
            "obs_count": [0, 0, 0],
        }
    )
    with patch("backend.live_manager.get_db") as mock_db:
        mock_db.return_value.station_summary.return_value = summary
        mock_db.return_value.query_recent.return_value = pd.DataFrame()
        payload = build_tec_heatmap(hours=2)

    assert payload["data_quality"] == "regional_mean"
    assert payload["grid"] is not None
    assert payload["message"] is not None


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
    ):
        mock_db.return_value.station_summary.return_value = summary
        mock_db.return_value.query_recent.return_value = recent
        payload = build_tec_heatmap(hours=2)

    assert payload["available"] is True
    assert payload["station_count"] == 24
    rows_by_code = {row["code"]: row for row in payload["stations"]}
    assert rows_by_code["hara"]["source"] == "live"
    assert rows_by_code["hara"]["vtec"] == 28.4
    assert rows_by_code["cent"]["source"] == "live_surface_estimate"
    assert rows_by_code["cent"]["vtec"] == 28.4
    assert payload["message"] is not None


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
        "zgiis.data.tec_archive.load_historical_tec",
        return_value=(pd.DataFrame(), {"available": False}),
    ):
        mock_db.return_value.station_summary.return_value = summary
        mock_db.return_value.query_recent.return_value = recent
        payload = build_tec_heatmap(hours=2)

    assert payload["available"] is True
    assert payload["station_count"] == 24
    rows_by_code = {row["code"]: row for row in payload["stations"]}
    assert rows_by_code["hara"]["source"] == "live"
    assert rows_by_code["hara"]["vtec"] == 30.9
    assert rows_by_code["cent"]["source"] == "live_surface_estimate"
    assert payload["grid"] is not None
    assert payload["data_quality"] == "regional_mean"
