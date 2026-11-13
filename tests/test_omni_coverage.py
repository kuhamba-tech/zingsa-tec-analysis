from datetime import date
from types import SimpleNamespace

from zgiis.space_weather import omniweb_client as client


def test_range_beyond_released_data_retries_only_the_real_overlap(monkeypatch):
    calls = []

    def post(url, data, timeout):
        calls.append(dict(data))
        text = ("<H1> Error</H1> INVALID STOP DATE, correct range: 19631128 - 20261029"
                if len(calls) == 1 else "YEAR DOY HR 1 2 3 4\n2026 274 0 100 13 -4 150")
        return SimpleNamespace(text=text, raise_for_status=lambda: None)

    monkeypatch.setattr(client.requests, "post", post)
    rows = client.fetch_omni_daily(date(2026, 10, 1), date(2026, 11, 30))
    assert len(calls) == 2
    assert calls[1]["start_date"] == "20261001"
    assert calls[1]["end_date"] == "20261029"
    assert rows[0]["date"] == "2026-10-01"


def test_no_overlap_returns_no_fabricated_observations(monkeypatch):
    monkeypatch.setattr(client.requests, "post", lambda *a, **kw: SimpleNamespace(
        text="<H1> Error</H1> INVALID STOP DATE, correct range: 19631128 - 20261029",
        raise_for_status=lambda: None,
    ))
    assert client.fetch_omni_daily(date(2026, 11, 1), date(2026, 11, 30)) == []
