from unittest.mock import MagicMock

import requests

from zgiis.ionosonde import didbase


def test_public_json_uses_verified_requests_transport(monkeypatch):
    response = MagicMock()
    response.__enter__.return_value = response
    response.json.return_value = {"YearList": [2019]}
    get = MagicMock(return_value=response)
    monkeypatch.setattr(didbase.requests, "get", get)
    assert didbase._get_json("https://lgdc.uml.edu/ionoweb/years4loc?ursiCode=MU12K") == {"YearList": [2019]}
    get.assert_called_once_with("https://lgdc.uml.edu/ionoweb/years4loc?ursiCode=MU12K", timeout=10.0)
    response.raise_for_status.assert_called_once()


def test_certificate_failure_remains_unverified_not_confirmed_missing(monkeypatch):
    def failed(*args, **kwargs):
        raise requests.exceptions.SSLError("certificate chain")
    monkeypatch.setattr(didbase, "fetch_didbase_locations", failed)
    monkeypatch.setattr(didbase, "fetch_didbase_years", failed)
    result = didbase.get_ionosonde_metadata("MU12K")
    assert result["status"] == "fallback"
    assert result["availability_years"] == []
    assert result["latest_available_year"] is None
