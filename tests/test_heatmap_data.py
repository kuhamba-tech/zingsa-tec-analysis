"""Tests for live TEC heat-map payload builder."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pandas as pd

from zgiis.maps.heatmap_data import build_tec_heatmap


def test_build_tec_heatmap_empty_when_no_db_rows():
    with patch("backend.live_manager.get_db") as mock_db:
        mock_db.return_value.station_summary.return_value = pd.DataFrame()
        payload = build_tec_heatmap(hours=2)
    assert payload["available"] is False
    assert payload["stations"] == []


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
    assert payload["station_count"] == 3
    assert payload["grid"] is not None
    assert payload["data_quality"] == "station"
    assert payload["icao_mod_tecu"] == 125.0
    assert len(payload["heat_points"]) > 3
    assert payload["tec_min"] is not None
    assert payload["tec_max"] is not None


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
        "backend.routers.cors_network._stations", return_value=[mock_station]
    ):
        mock_db.return_value.station_summary.return_value = summary
        mock_db.return_value.query_recent.return_value = recent
        payload = build_tec_heatmap(hours=2)

    assert payload["available"] is True
    assert payload["station_count"] == 1
    assert payload["stations"][0]["code"] == "hara"
    assert payload["grid"] is not None
    assert payload["data_quality"] == "station"
