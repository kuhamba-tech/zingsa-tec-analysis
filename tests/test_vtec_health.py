from __future__ import annotations

from unittest.mock import patch

from zgiis.live import vtec_health


def test_build_live_vtec_health_shape():
    fake_hm = {
        "available": True,
        "stations": [
            {"code": "kwek", "source": "live", "obs_count": 12, "vtec": 17.5},
            {"code": "tsho", "source": "live_surface_estimate", "obs_count": 0, "vtec": 18.2},
        ],
    }

    with (
        patch.object(vtec_health, "_collector_pid_alive", return_value=True),
        patch("zgiis.maps.heatmap_data.build_tec_heatmap", return_value=fake_hm),
        patch("backend.live_manager.get_db") as mock_get_db,
        patch("backend.live_manager.diagnostics_by_station", return_value={}),
        patch("backend.live_manager.status", return_value={"streams": {}}),
    ):
        db = mock_get_db.return_value
        db.backend = "sqlite"
        db.recent_station_vtec.return_value = None
        db.query_recent.return_value = None

        payload = vtec_health.build_live_vtec_health()

    assert "live_available" in payload
    assert "stations" in payload
    assert isinstance(payload["stations"], list)
    kwek = next(s for s in payload["stations"] if s["station"] == "kwek")
    tsho = next(s for s in payload["stations"] if s["station"] == "tsho")
    assert kwek["source"] == "live"
    assert tsho["source"] == "estimate"


def test_station_blocker_ephemeris():
    blocker = vtec_health._station_blocker(
        code="kwek",
        has_fresh_vtec=False,
        stream={"connected": True, "last_seen": "2026-01-01T00:00:00Z"},
        diag={"observations": 100, "missing_elevation": 90, "vtec_emitted": 0},
    )
    assert blocker == "awaiting_gps_ephemeris"
