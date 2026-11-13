from unittest.mock import Mock

import requests

from zgiis.space_weather import cosmic2_client as client


def test_failed_checks_retry_and_success_expires(monkeypatch):
    client._archive_cache.clear()
    clock = [100.0]
    monkeypatch.setattr(client, "monotonic", lambda: clock[0])
    response = Mock(status_code=200, headers={"content-length": "123"})
    head = Mock(side_effect=[requests.Timeout("temporary"), response, response])
    monkeypatch.setattr(client.requests, "head", head)
    assert client._check_archive_cached("2024-04-01", 20)["status"] == "unreachable"
    assert client._check_archive_cached("2024-04-01", 20)["available"]
    assert client._check_archive_cached("2024-04-01", 20)["size_bytes"] == 123
    assert head.call_count == 2
    clock[0] += 3601
    assert client._check_archive_cached("2024-04-01", 20)["available"]
    assert head.call_count == 3
    assert response.close.call_count == 2
    client._archive_cache.clear()


def test_streaming_fallback_is_closed_and_missing_is_rechecked(monkeypatch):
    client._archive_cache.clear()
    clock = [0.0]
    monkeypatch.setattr(client, "monotonic", lambda: clock[0])
    head_response = Mock(status_code=405)
    stream = Mock(status_code=404, headers={})
    head = Mock(return_value=head_response)
    monkeypatch.setattr(client.requests, "head", head)
    monkeypatch.setattr(client.requests, "get", Mock(return_value=stream))
    assert not client._check_archive_cached("2024-04-02", 20)["available"]
    client._check_archive_cached("2024-04-02", 20)
    assert head.call_count == 1
    clock[0] += 61
    client._check_archive_cached("2024-04-02", 20)
    assert head.call_count == 2
    assert head_response.close.call_count == 2
    assert stream.close.call_count == 2
    client._archive_cache.clear()
