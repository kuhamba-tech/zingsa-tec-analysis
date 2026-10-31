"""Synthetic policies exercise gates; these numbers are NOT production limits."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest

from zgiis.navigation.advisory_assessment import advisory_rules, build_advisory_assessment
from zgiis.navigation.advisory_messages import build_assessment_briefs

NOW = datetime(2026, 10, 31, 7, 0, tzinfo=timezone.utc)


def series(value=1.5, station="zinh", age=0):
    return [{"station":station,"points":[{"time":(NOW-timedelta(minutes=age+m)).isoformat(),
        "vtec_tecu":value,"obs_count":10} for m in (10,5,0)]}]


def measured(**values):
    return dict(kind="observed", quality="good", source="test receiver", station="zinh",
                observed_at=NOW.isoformat(), sample_count=10, **values)


def policy(metric, caution, high, direction="above"):
    return dict(validated=True,calibration_id="TEST ONLY",dataset_ref="synthetic",
        validation_report="test fixture only",station_codes=["zinh"],min_samples=3,
        valid_from="2026-01-01T00:00:00Z",valid_until="2027-01-01T00:00:00Z",
        criteria=[dict(metric=metric,caution=caution,high=high,direction=direction)])


def rules():
    r=deepcopy(advisory_rules())
    r["ionosphere"]=policy("roti",1,2)
    for role in r["sectors"]:
        r["sectors"][role]=policy("error_cm",20,50)
    return r


def assess(**kwargs):
    return build_advisory_assessment(city=kwargs.pop("city","HARARE"),stations=[],
        local_tec=kwargs.pop("local_tec",series()),now=NOW,**kwargs)


def test_low_vtec_does_not_verify_gnss():
    a=assess()
    assert a["vtec"]==1.5 and a["risk_level"]=="insufficient_data"
    assert a["gnss_performance"]=="not_verified" and a["roti"] is None


def test_high_vtec_with_stable_measured_performance_is_not_automatically_bad():
    a=assess(local_tec=series(180),rules=rules(),signal_metrics=measured(roti=.1,arc_consistent=True),
             performance=measured(error_cm=1,known_control=True))
    assert a["risk_level"]=="favourable" and a["gnss_performance"]=="verified"


def test_low_vtec_elevated_roti_keeps_performance_separate():
    a=assess(rules=rules(),signal_metrics=measured(roti=3,arc_consistent=True))
    assert a["ionospheric_risk"]=="high_risk"
    assert a["risk_level"]=="caution" and a["gnss_performance"]=="not_verified"


def test_global_storm_does_not_invent_local_gnss_failure():
    a=assess(sw={"kp":9,"dst":-250,"updated_utc":NOW.isoformat()})
    assert a["geomagnetic_conditions"]["kp"]==9
    assert a["risk_level"]=="insufficient_data"


@pytest.mark.parametrize("local,freshness", [([],"missing"),(series(age=40),"stale")])
def test_missing_or_stale_tec(local,freshness):
    a=assess(local_tec=local)
    assert a["freshness"]==freshness and a["observation_time"] is None
    assert a["risk_level"]=="insufficient_data"


def test_no_model_means_no_future_working_window():
    a=assess(day="2026-11-01")
    assert len(a["working_windows"])==5
    assert all(w["basis"]=="pending" and w["confidence"] is None for w in a["working_windows"])
    assert not a["forecast_enabled"]


def test_conflicting_station_samples_block_verification():
    local=series(); local[0]["points"].append({**local[0]["points"][-1],"vtec_tecu":20})
    a=assess(local_tec=local)
    assert a["coverage"]["conflicting_stations"]==["zinh"]
    assert a["risk_level"]=="insufficient_data"


def test_conflicts_between_two_sources_for_same_station_are_rejected():
    a=assess(local_tec=series(1.5)+series(20))
    assert a["coverage"]["conflicting_stations"]==["zinh"]
    assert a["risk_level"]=="insufficient_data"


def test_distant_location_never_borrows_harare():
    a=assess(city="MASVINGO")
    assert a["vtec"] is None and a["coverage"]["contributors"]==[]


def test_sector_specific_limits_are_independent():
    r=rules();r["sectors"]["surveyor"]=policy("error_cm",2,5)
    a=assess(rules=r,signal_metrics=measured(roti=.1,arc_consistent=True),
             performance=measured(error_cm=8,known_control=True))
    assert a["sectors"]["farmer"]["risk_level"]=="favourable"
    assert a["sectors"]["surveyor"]["risk_level"]=="high_risk"


def test_proxy_performance_and_wrong_arc_metrics_are_rejected():
    perf=measured(error_cm=1,known_control=True);perf["kind"]="model_proxy"
    a=assess(rules=rules(),performance=perf,signal_metrics=measured(roti=.1,arc_consistent=False))
    assert a["roti"] is None and a["gnss_performance"]=="not_verified"


def test_surveyor_needs_known_control_and_calibration_requires_provenance():
    r=rules();r["sectors"]["farmer"].pop("validation_report")
    a=assess(rules=r,performance=measured(error_cm=1),signal_metrics=measured(roti=.1,arc_consistent=True))
    assert a["sectors"]["surveyor"]["gnss_performance"]=="not_verified"
    assert a["sectors"]["farmer"]["gnss_performance"]=="not_verified"


def test_future_forecast_requires_matching_approved_model_and_bounds():
    r=rules();r["forecast"]={"enabled":True,"model_id":"test","validation_id":"test-report"}
    f=dict(model_id="test",validation_id="wrong",location="HARARE",issued_at=NOW.isoformat(),windows=[])
    assert not assess(rules=r,forecast=f)["forecast_enabled"]
    f["validation_id"]="test-report"
    f["windows"]=[dict(start="2026-10-31T10:00:00Z",end="2026-10-31T13:00:00Z",risk_level="favourable",confidence=.8)]
    a=assess(rules=r,forecast=f)
    assert a["working_windows"][2]["basis"]=="validated_forecast"
    assert a["working_windows"][3]["basis"]=="pending"


def test_drafts_share_assessment_times_limits_and_official_link():
    a=assess();briefs=build_assessment_briefs(a)
    assert len(briefs)==6
    for b in briefs:
        assert b["advisory"]["assessment_id"]==a["assessment_id"]
        assert "Data observed:" in b["social_script"] and "Brief generated:" in b["social_script"]
        assert "https://zingsa-gnss-tec.vercel.app/" in b["social_script"]
        assert "Pending" in b["social_script"] and b["status_tone"]!="excellent"


def test_api_builder_and_filtered_response_preserve_canonical_assessment(monkeypatch):
    import asyncio
    from backend.routers import navigation_news as api
    from zgiis.navigation import news_tec_context
    from zgiis.navigation import advisory_inputs as input_module
    monkeypatch.setattr(input_module,"advisory_inputs",input_module.AdvisoryInputs())
    monkeypatch.setattr(api,"_sw_dict",lambda: None)
    monkeypatch.setattr(api,"_stations",lambda **kw: [])
    monkeypatch.setattr(news_tec_context,"live_tec_context",lambda: [])
    bundle=api._build_bundle_fresh(city="MASVINGO")
    assert bundle.assessment["location_key"]=="MASVINGO"
    assert len(bundle.briefs)==6
    monkeypatch.setattr(api,"get_navigation_news_bundle",lambda **kw: bundle)
    filtered=asyncio.run(api.navigation_news(audience="surveyor",refresh_ntrip=False,force=False,
        city="MASVINGO",day=None,_=None))
    assert len(filtered.briefs)==1 and filtered.assessment==bundle.assessment
    assert filtered.briefs[0].advisory["assessment_id"]==bundle.assessment["assessment_id"]


def test_cache_roundtrip_keeps_evidence_and_rejects_expired_assessment(monkeypatch):
    from zgiis.navigation import news_cache
    a=assess()
    monkeypatch.setattr(news_cache,"load_cache",lambda: None)
    monkeypatch.setattr(news_cache,"save_cache",lambda record: None)
    record=news_cache.record_refresh(dict(computed_at=a["issued_at"],assessment=a,
        briefs=build_assessment_briefs(a)),now=NOW)
    assert news_cache.record_to_bundle_dict(record)["assessment"]==a
    assert news_cache.cache_is_fresh(record,now=NOW+timedelta(seconds=1))
    assert not news_cache.cache_is_fresh(record,now=NOW+timedelta(minutes=3))


def test_slow_input_returns_pending_and_reuses_single_read():
    import threading
    from zgiis.navigation.advisory_inputs import AdvisoryInputs
    store=AdvisoryInputs()
    release=threading.Event()
    calls=[]
    def slow():
        calls.append(1)
        release.wait(2)
        return ["real result"]
    try:
        values,status=store.read({"tec":slow},timeout=.01)
        assert values["tec"] is None and status["tec"]=="loading"
        store.read({"tec":slow},timeout=.01)
        assert calls==[1]
        release.set()
        values,status=store.read({"tec":slow},timeout=1)
        assert values["tec"]==["real result"] and status["tec"]=="available"
    finally:
        release.set()
        store.pool.shutdown(wait=True)


def test_national_briefs_cover_other_regions_and_do_not_copy_harare_metadata():
    from zgiis.navigation.advisory_messages import build_national_briefs
    harare=assess()
    masvingo=assess(city="MASVINGO",local_tec=series(20,station="masv"))
    missing=assess(city="BULAWAYO",local_tec=[])
    briefs=build_national_briefs([harare,masvingo,missing])
    for b in briefs:
        assert b["headline"]=="Zimbabwe: national GNSS update"
        assert "2 of 3 monitored areas" in b["summary"]
        assert "1.5–20.0 TECU" in b["summary"]
        assert b["advisory"]["scope"]=="national"
        assert b["advisory"]["areas_without_fresh_readings"]==["Bulawayo"]
        assert b["advisory"]["assessment_id"]!=harare["assessment_id"]
        assert "countrywide working window" in b["social_script"]


def test_national_brief_never_hides_unverified_areas_behind_one_favourable_city():
    from zgiis.navigation.advisory_messages import build_national_briefs
    a=assess(rules=rules(),signal_metrics=measured(roti=.1,arc_consistent=True),
        performance=measured(error_cm=1,known_control=True))
    missing=assess(city="MASVINGO",local_tec=[])
    assert a["risk_level"]=="favourable"
    for b in build_national_briefs([a,missing]):
        assert b["advisory"]["risk_level"]=="insufficient_data"
        assert b["advisory"]["gnss_performance"]=="not_verified"
        assert b["status_tone"]!="excellent"
