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
    assert len(payload["heat_points"]) > 3
    assert payload["tec_min"] is not None
    assert payload["tec_max"] is not None
