from backend.routers.cors_network import _is_serverless_runtime, _merge_live_station_statuses
from zgiis.cors.stations import CorsStation
from unittest.mock import patch
from contextlib import ExitStack


def test_serverless_normal_request_reads_collector_without_stream_probe():
    from backend.routers import cors_network
    from unittest.mock import Mock

    snapshot = station("hara", "online", "ntrip")
    with ExitStack() as stack:
        stack.enter_context(patch.dict("os.environ", {"VERCEL_ENV": "production"}, clear=True))
        stack.enter_context(patch("backend.live_manager.pipeline_map_state", return_value=(False, {})))
        stack.enter_context(patch("backend.live_manager.latest_vtec_by_station", return_value={}))
        stack.enter_context(patch.object(cors_network, "_merge_spider_site_statuses", side_effect=lambda rows, **kw: rows))
        archive = stack.enter_context(patch.object(cors_network, "_merge_archived_live_statuses", return_value=([snapshot], True)))
        stack.enter_context(patch.object(cors_network, "_safe_station_live_vtec", return_value={}))
        stack.enter_context(patch.object(cors_network, "_merge_rover_clients", side_effect=lambda rows: rows))
        probe = stack.enter_context(patch.object(cors_network, "_supplement_live_ntrip_vtec", new=Mock(side_effect=AssertionError("must not probe"))))
        rows = cors_network._stations_impl(refresh_ntrip=False)
    archive.assert_called_once()
    probe.assert_not_called()
    assert [(row.code, row.status, row.status_source) for row in rows] == [("hara", "online", "ntrip")]


def station(code: str, status: str, source: str = "catalog") -> CorsStation:
    return CorsStation(code, code.upper(), -18.0, 30.0, status, status_source=source)


def test_all_live_ntrip_states_are_propagated():
    catalog = [station("onln", "online"), station("idle", "online"), station("offl", "online")]
    live = [
        station("onln", "online", "ntrip"),
        station("idle", "degraded", "ntrip"),  # legacy label → offline
        station("offl", "offline", "ntrip"),
    ]

    result = _merge_live_station_statuses(catalog, live)

    assert [(row.status, row.status_source) for row in result] == [
        ("online", "ntrip"),
        ("offline", "ntrip"),
        ("offline", "ntrip"),
    ]


def test_missing_live_row_is_offline_when_pipeline_is_configured():
    result = _merge_live_station_statuses([station("miss", "online")], [])
    assert result[0].status == "offline"
    assert result[0].status_source == "ntrip"


def test_vercel_environment_is_treated_as_serverless():
    with patch.dict("os.environ", {"VERCEL_ENV": "production"}, clear=True):
        assert _is_serverless_runtime()
