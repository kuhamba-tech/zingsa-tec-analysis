from datetime import datetime, timezone
from unittest.mock import Mock

import pandas as pd

from zgiis.maps import dlr_global_tec as dlr


def test_history_filters_dlr_in_database_and_retains_old_samples(monkeypatch):
    from backend import live_manager
    db = Mock(_is_pg=True)
    db._read_sql.return_value = pd.DataFrame([
        {"station": "GUTU_", "time": "2026-11-12T08:00:00Z", "vtec_tecu": 25,
         "tec_method": dlr.DLR_TEC_METHOD},
        {"station": "GUTU_", "time": "2026-11-17T13:00:00Z", "vtec_tecu": 30,
         "tec_method": dlr.DLR_TEC_METHOD},
    ])
    monkeypatch.setattr(live_manager, "get_db", lambda: db)
    result = dlr.query_global_tec_series(hours=192)
    sql, params = db._read_sql.call_args.args
    assert "tec_method = %s AND time >= %s" in sql
    assert "SELECT *" not in sql
    assert params[0] == dlr.DLR_TEC_METHOD
    assert (datetime.now(timezone.utc) - datetime.fromisoformat(params[1])).total_seconds() > 191 * 3600
    db.query_recent.assert_not_called()
    assert result[0]["station"] == "gutu"
    assert len(result[0]["points"]) == 2


def test_stored_history_does_not_wait_for_external_download(monkeypatch):
    rows = [{"station": "gutu", "points": [{"time": "2026-11-17T13:00:00Z", "vtec_tecu": 30}], "latest_vtec": 30}]
    monkeypatch.setattr(dlr, "query_global_tec_series", lambda **kw: rows)
    refresh = Mock()
    monkeypatch.setattr(dlr, "_schedule_global_tec_refresh", refresh)
    download = Mock(side_effect=AssertionError("History must not wait for DLR"))
    monkeypatch.setattr(dlr, "cached_global_tec_snapshot", download)
    result = dlr.refresh_and_query_global_tec(hours=192)
    assert result["stations"] == rows and result["available"]
    refresh.assert_called_once()
    download.assert_not_called()


def test_latest_timestamp_does_not_get_applied_to_older_station_values(monkeypatch):
    rows = [{"station": code, "points": [{"time": time, "vtec_tecu": 30}], "latest_vtec": 30}
            for code, time in [("gutu", "2026-11-17T13:00:00Z"), ("gokw", "2026-11-17T10:00:00Z")]]
    monkeypatch.setattr(dlr, "query_global_tec_series", lambda **kw: rows)
    monkeypatch.setattr(dlr, "_schedule_global_tec_refresh", Mock())
    result = dlr.refresh_and_query_global_tec(hours=192)
    assert result["epoch"] == "2026-11-17T13:00:00Z"
    assert [row["station"] for row in result["latest"]] == ["gutu"]
    assert len(result["stations"]) == 2


def test_archive_is_available_when_sql_pool_is_full(monkeypatch):
    from backend import live_manager
    monkeypatch.setattr(live_manager, "get_db", Mock(side_effect=RuntimeError("max clients reached")))
    reader = Mock(return_value=[{"station": "gutu", "time": "2026-11-17T07:00:00Z",
                                "vtec_tecu": 25, "tec_method": dlr.DLR_TEC_METHOD}])
    monkeypatch.setattr(dlr, "_global_tec_https_rows", reader)
    rows = dlr.query_global_tec_series(hours=192)
    assert rows[0]["points"][0]["vtec_tecu"] == 25
    reader.assert_called_once()


def test_https_archive_reads_beyond_first_database_page(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://database.example")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key")
    first, second = Mock(), Mock()
    first.json.return_value = [{"time": "2026-11-17T07:00:00Z"}] * 1000
    second.json.return_value = [{"time": "2026-11-17T08:00:00Z"}]
    get = Mock(side_effect=[first, second])
    monkeypatch.setattr(dlr.requests, "get", get)
    result = dlr._global_tec_https_rows("2026-11-11T00:00:00Z")
    assert len(result) == 1001
    assert get.call_args.kwargs["params"]["offset"] == 1000
    assert get.call_args.kwargs["params"]["tec_method"] == f"eq.{dlr.DLR_TEC_METHOD}"
