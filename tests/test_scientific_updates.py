from datetime import datetime, timezone

import pytest

from zgiis.space_weather.scientific_updates import parse_discussion
from zgiis.space_weather.solar_activity import (
    build_donki_active_regions, build_donki_cme_rows, build_donki_radio_bursts,
)

TEXT = """:Product: Forecast Discussion
:Issued: 2026 Oct 31 0030 UTC
# NOAA SWPC
Solar Activity
.24 hr Summary...
Solar activity was low.
No Earth-directed CME was observed.
.Forecast...
An isolated M-class flare is possible.
Energetic Particle
.24 hr Summary...
Protons were at background levels.
.Forecast...
Protons are expected at background levels.
Solar Wind
.24 hr Summary...
Speed was 350 km/s.
.Forecast...
A high-speed stream may arrive.
Geospace
.24 hr Summary...
The field was quiet to active.
.Forecast...
G1 conditions are possible tomorrow.
"""
NOW = datetime(2026,10,31,4,tzinfo=timezone.utc)


def test_observations_forecasts_issue_and_retrieval_times_are_separate():
    parsed=parse_discussion(TEXT,now=NOW)
    assert parsed["issued_at"]=="2026-10-31T00:30:00Z"
    assert parsed["checked_at"]=="2026-10-31T04:00:00Z"
    assert parsed["status"]=="current" and len(parsed["sections"])==4
    geo=parsed["sections"][-1]
    assert "G1" not in geo["observed"] and "G1" in geo["forecast"]
    assert "# NOAA" not in str(parsed["sections"])


def test_old_discussion_is_stale_not_current():
    assert parse_discussion(TEXT,now=datetime(2026,11,1,tzinfo=timezone.utc))["status"]=="stale"


def test_partial_discussion_is_not_marked_current_and_padded_dates_parse():
    partial=parse_discussion(TEXT.split("Energetic Particle")[0],now=NOW)
    assert partial["status"]=="stale" and "Incomplete" in partial["note"]
    parsed=parse_discussion(TEXT.replace("2026 Oct 31","2026 Oct  1"),now=NOW)
    assert parsed["issued_at"]=="2026-10-01T00:30:00Z"


@pytest.mark.parametrize("text",["<html>Error</html>",TEXT.split("Solar Activity")[0],TEXT.replace("2026 Oct 31","2027 Oct 31")])
def test_missing_malformed_or_future_discussion_rejected(text):
    with pytest.raises(ValueError): parse_discussion(text,now=NOW)


def test_flare_class_never_invents_magnetic_class_sunspots_or_radio_bursts():
    flares=[dict(flrID="f1",activeRegionNum=1234,classType="M9.0",peakTime="2026-10-31T01:00Z"),
            dict(flrID="f2",activeRegionNum=1234,classType="X1.0",peakTime="2026-10-30T01:00Z")]
    rows=build_donki_active_regions(flares)
    assert len(rows)==1 and rows[0]["latest"]=="X1.0" and rows[0]["flare_count"]==2
    assert rows[0]["spots"] is None and rows[0]["mag"]=="Unavailable"
    assert build_donki_radio_bursts(flares)==[]


def test_linked_event_and_cone_width_are_not_earth_impact_evidence():
    rows=build_donki_cme_rows([dict(activityID="c1",startTime="2026-10-31T00:00Z",
        linkedEvents=[{"activityID":"flare"}],cmeAnalyses=[dict(halfAngle=180,speed=900,isMostAccurate=True)])])
    assert rows[0]["speed"]==900 and rows[0]["impact"]=="Not assessed"
    assert rows[0]["halo"]=="Not established"


def test_failed_refresh_never_presents_retained_forecast_as_current(monkeypatch):
    import requests
    from zgiis.space_weather import scientific_updates as module
    monkeypatch.setattr(module,"_cached",parse_discussion(TEXT,now=NOW))
    monkeypatch.setattr(module,"_checked",0)
    def fail(*args,**kwargs): raise requests.Timeout("test timeout")
    monkeypatch.setattr(requests,"get",fail)
    result=module.get_scientific_updates()
    assert result["status"]=="stale" and len(result["sections"])==4
    assert "Refresh failed" in result["note"]


def test_unavailable_discussion_does_not_invent_a_forecast(monkeypatch):
    import requests
    from zgiis.space_weather import scientific_updates as module
    monkeypatch.setattr(module,"_cached",None)
    monkeypatch.setattr(module,"_checked",0)
    def fail(*args,**kwargs): raise requests.Timeout("test timeout")
    monkeypatch.setattr(requests,"get",fail)
    result=module.get_scientific_updates()
    assert result["status"]=="unavailable" and not result.get("sections")
