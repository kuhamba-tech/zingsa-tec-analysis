from unittest.mock import Mock

import requests

from zgiis.cors import trignet_store


def test_https_publisher_does_not_borrow_sql_connection(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-private-key")
    response = Mock()
    post = Mock(return_value=response)
    monkeypatch.setattr(requests, "post", post)
    checkout = Mock(side_effect=AssertionError("SQL pool must not be used"))
    monkeypatch.setattr(trignet_store, "checkout", checkout)
    payload = {"stations": [{"station": "TDOU", "gg_vtec": 25.0}]}

    assert trignet_store.save_snapshot(payload)
    response.raise_for_status.assert_called_once()
    checkout.assert_not_called()
    kwargs = post.call_args.kwargs
    assert kwargs["json"]["payload"] == payload
    assert kwargs["json"]["id"] == 1
    assert kwargs["params"] == {"on_conflict": "id"}
    assert "resolution=merge-duplicates" in kwargs["headers"]["Prefer"]


def test_https_failure_falls_back_to_sql(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-private-key")
    monkeypatch.setattr(requests, "post", Mock(side_effect=requests.Timeout))
    connection = Mock()
    connection.cursor.return_value.__enter__ = Mock(return_value=Mock())
    connection.cursor.return_value.__exit__ = Mock(return_value=False)
    monkeypatch.setattr(trignet_store, "checkout", Mock(return_value=connection))
    monkeypatch.setattr(trignet_store, "database_dsn", lambda: "test-dsn")
    release = Mock()
    monkeypatch.setattr(trignet_store, "release", release)

    assert trignet_store.save_snapshot({"stations": []})
    connection.commit.assert_called_once()
    release.assert_called_once_with(connection)
