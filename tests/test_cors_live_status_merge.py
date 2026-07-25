from backend.routers.cors_network import _is_serverless_runtime, _merge_live_station_statuses
from zgiis.cors.stations import CorsStation
from unittest.mock import patch


def station(code: str, status: str, source: str = "catalog") -> CorsStation:
    return CorsStation(code, code.upper(), -18.0, 30.0, status, status_source=source)


def test_all_live_ntrip_states_are_propagated():
    catalog = [station("onln", "online"), station("degr", "online"), station("offl", "online")]
    live = [
        station("onln", "online", "ntrip"),
        station("degr", "degraded", "ntrip"),
        station("offl", "offline", "ntrip"),
    ]

    result = _merge_live_station_statuses(catalog, live)

    assert [(row.status, row.status_source) for row in result] == [
        ("online", "ntrip"),
        ("degraded", "ntrip"),
        ("offline", "ntrip"),
    ]


def test_missing_live_row_is_offline_when_pipeline_is_configured():
    result = _merge_live_station_statuses([station("miss", "online")], [])
    assert result[0].status == "offline"
    assert result[0].status_source == "ntrip"


def test_vercel_environment_is_treated_as_serverless():
    with patch.dict("os.environ", {"VERCEL_ENV": "production"}, clear=True):
        assert _is_serverless_runtime()
