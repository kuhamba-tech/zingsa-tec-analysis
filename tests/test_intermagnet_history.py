from datetime import date

import pytest

from zgiis.space_weather import intermagnet_client as client


def test_history_excludes_missing_values_and_does_not_differentiate_gaps(monkeypatch):
    payload = client._parse_iaga_payload("""DATE TIME DOY HERX HERY HERZ HERF
2024-04-01 00:00:00.000 092 100 0 5 100
2024-04-01 00:01:00.000 092 101 0 5 101
2024-04-01 00:02:00.000 092 99999 99999 99999 99999
2024-04-01 00:03:00.000 092 500 0 5 500
2024-04-01 00:10:00.000 092 900 0 5 900
""")
    monkeypatch.setattr(client, "_fetch_chunk", lambda *args: payload)
    rows = client.fetch_intermagnet_daily("HER", date(2024, 4, 1), date(2024, 4, 1))
    assert rows[0]["samples"] == 4
    assert rows[0]["mean_h"] == 400.2
    assert rows[0]["max_dbdt"] == 1


def test_non_xyz_layout_is_not_misread_as_cartesian_field():
    with pytest.raises(ValueError, match="component layout"):
        client._parse_iaga_payload("DATE TIME DOY HERH HERD HERZ HERF")


def test_text_format_is_requested(monkeypatch):
    monkeypatch.setattr(client, "read_source", lambda *args, **kwargs: None)
    monkeypatch.setattr(client, "write_source", lambda *args: None)
    class Response:
        text = "2024-04-01 00:00:00.000 092 100 0 5 100"

        def raise_for_status(self):
            pass

    def get(url, params, timeout):
        assert params["format"] == "IAGA2002"
        return Response()

    monkeypatch.setattr(client.requests, "get", get)
    assert client._fetch_chunk("HER", date(2024, 4, 1), 1, 30)["X"] == [100]
