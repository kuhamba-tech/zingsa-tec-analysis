from datetime import date
from types import SimpleNamespace

import pytest

from zgiis.space_weather import celestrak_client as client


def test_local_relay_preserves_source_indices_but_not_remote_receiver_tec(monkeypatch):
    monkeypatch.delenv("VERCEL", raising=False)
    monkeypatch.delenv("AWS_LAMBDA_FUNCTION_NAME", raising=False)
    monkeypatch.setattr(client, "_relay_cache", {})
    calls = []

    def get(url, **kwargs):
        calls.append(url)
        if url != client._RELAY_URL:
            raise client.requests.ConnectTimeout()
        return SimpleNamespace(raise_for_status=lambda: None, json=lambda: {
            "source": "CelesTrak Space Weather Data (https://celestrak.org/SpaceData/)",
            "series": [{"date": "2024-04-01", "kp": 5.3, "ap": 13, "f107": 120.4,
                        "ssn": 31, "data_type": "OBS", "storm_flag": True,
                        "storm_class": "G1 Minor", "mean_vtec": 999}],
        })

    monkeypatch.setattr(client.requests, "get", get)
    rows = client.fetch_celestrak_daily(date(2024, 4, 1), date(2024, 4, 2))
    assert rows[0]["kp"] == 5.3
    assert "mean_vtec" not in rows[0]
    result = client.build_analysis(rows, {"2024-04-01": 22.5})
    assert result["series"][0]["mean_vtec"] == 22.5
    assert "via ZINGSA" in result["source"]
    assert client.fetch_celestrak_daily(date(2024, 4, 1), date(2024, 4, 2)) == rows
    assert len(calls) == 2


def test_vercel_cannot_relay_back_to_itself(monkeypatch):
    monkeypatch.setenv("VERCEL", "1")
    monkeypatch.setattr(client, "_relay_cache", {})
    calls = []

    def get(url, **kwargs):
        calls.append(url)
        raise client.requests.ConnectTimeout()

    monkeypatch.setattr(client.requests, "get", get)
    with pytest.raises(client.requests.ConnectTimeout):
        client.fetch_celestrak_daily(date(2024, 4, 1), date(2024, 4, 2))
    assert client._RELAY_URL not in calls
