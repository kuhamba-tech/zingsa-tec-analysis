from datetime import date
from unittest.mock import Mock

import pytest

from zgiis.space_weather import equatorial_electric_field as model
from zgiis.space_weather.equatorial_electric_field import parse_equatorial_electric_field


MODEL_RESPONSE = """
<html><body><span>
:Data type: Prompt penetration component of the Equatorial Ionospheric Eastward Electric Field (EEF)
<br>:Created: Sat Nov 21 07:30:19 UTC 2026
<br># Average Solar Wind Velocity : NaN km/s
<br># UT Date Time Geographic Longitudes
<br># YR MO DA HH MM
<br>028.0&nbsp 046.0&nbsp 064.0&nbsp
<br>#------------------
<br>2026 11 21 07 30 +0.000 +0.000 +0.000
:Data type: Climatological (quiet) component of the Equatorial Ionospheric Eastward Electric Field (EEF)
<br>:Created: Sat Nov 21 07:30:21 UTC 2026
<br># UT Date Time Geographic Longitudes
<br># YR MO DA HH MM
<br>028.0&nbsp 046.0&nbsp 064.0&nbsp
<br>#------------------
<br>2026 11 21 07 30 +0.363 +0.463 +0.486
</span></body></html>
"""


def test_model_response_extracts_requested_longitude_and_components():
    parsed = parse_equatorial_electric_field(MODEL_RESPONSE)

    assert parsed["mode"] == "live"
    assert parsed["longitude_deg"] == 28.0
    assert parsed["updated_utc"] == "2026-11-21T07:30:21Z"
    assert parsed["average_solar_wind_velocity_km_s"] is None
    assert parsed["points"] == [
        {
            "time": "2026-11-21T07:30:00Z",
            "prompt_penetration_mvm": None,
            "climatological_mvm": 0.363,
        }
    ]
    assert "no valid solar-wind velocity" in parsed["note"]


def test_model_response_preserves_missing_component_values():
    body = MODEL_RESPONSE.replace(
        "Average Solar Wind Velocity : NaN km/s",
        "Average Solar Wind Velocity : 420.00 km/s",
    ).replace("+0.363 +0.463 +0.486", "NaN +0.463 +0.486")

    parsed = parse_equatorial_electric_field(body)

    assert parsed["points"][0]["prompt_penetration_mvm"] == 0.0
    assert parsed["points"][0]["climatological_mvm"] is None


def test_archive_request_uses_selected_utc_dates_and_model_longitude(monkeypatch):
    fetch = Mock(return_value=Mock(text=MODEL_RESPONSE))
    monkeypatch.setattr(model.requests, "get", fetch)
    monkeypatch.setattr(model, "_CACHE", {})
    start = date(2026, 11, 21)
    first = model.build_equatorial_electric_field(start=start, days=5)
    assert model.build_equatorial_electric_field(start=start, days=5) is first
    fetch.assert_called_once()
    assert fetch.call_args.kwargs["params"] == {
        "year": 2026, "month": 11, "day": 21, "utc": 0, "nDays": 5,
        "comp": "all", "startlong": 28.0, "deltalong": 18, "sat": "auto",
    }


def test_live_model_preserves_timestamp_on_temporary_outage(monkeypatch):
    clock = Mock(return_value=0)
    fetch = Mock(side_effect=[Mock(text=MODEL_RESPONSE), model.requests.Timeout(), model.requests.Timeout()])
    monkeypatch.setattr(model, "time", Mock(monotonic=clock))
    monkeypatch.setattr(model.requests, "get", fetch)
    monkeypatch.setattr(model, "_CACHE", {})

    live = model.build_equatorial_electric_field()
    clock.return_value = 61
    fallback = model.build_equatorial_electric_field()
    assert fallback["points"] == live["points"]
    assert fallback["updated_utc"] == live["updated_utc"]
    assert "could not be refreshed" in fallback["note"]
    assert "no valid solar-wind velocity" in fallback["note"]

    clock.return_value = 3600
    with pytest.raises(model.requests.Timeout):
        model.build_equatorial_electric_field()
