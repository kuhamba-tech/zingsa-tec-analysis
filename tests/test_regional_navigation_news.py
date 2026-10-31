"""Regional advice must follow local evidence, without invented safe-work hours."""
import json
from pathlib import Path

import pytest

from zgiis.navigation.audience_news import build_audience_news
from zgiis.navigation.gnss_forecast import GnssForecastCity
from zgiis.navigation.plain_news import plain_news_fields


@pytest.fixture
def context():
    return json.loads((Path(__file__).parent / "fixtures/navigation_news_regional.json").read_text(encoding="utf-8"))


def render(context, audience="farmer"):
    forecasts = [{**row, "feed_reliability": row["feedReliability"]} for row in context["forecasts"]]
    return plain_news_fields(audience, "excellent", context["computedAt"], context["sw"],
                             forecasts=forecasts, local_tec=context["localTec"], city=context["city"])


@pytest.mark.parametrize("audience", ["citizen", "farmer", "surveyor", "driver", "aviation", "scientist"])
def test_city_tec_effect_precautions_and_work_timing_are_in_every_message(context, audience):
    brief = render(context, audience)
    message = brief["broadcast_script"]
    assert "Masvingo" in message
    assert "rose from 8.0 to 12.0 TEC units in 15 minutes" in message
    assert "total electron content" in message
    assert "What to do:" in message and "When to work:" in message
    assert "04:27 CAT" in message and "Recovery time is unconfirmed" in message
    assert "32.0" not in message
    assert "07:00" not in message and "14:00" not in message
    assert brief["social_script"] == message
    assert len(message.split()) <= 145


def test_a_stale_city_never_borrows_fresh_readings_from_another_city(context):
    for point in context["localTec"][0]["points"]:
        point["time"] = "2026-10-31T00:00:00Z"
    brief = render(context)
    assert "No recent local TEC reading" in brief["summary"]
    assert "32.0" not in brief["summary"] and "12.0" not in brief["summary"]


def test_one_measurement_does_not_produce_a_trend(context):
    context["localTec"][0]["points"] = context["localTec"][0]["points"][-1:]
    summary = render(context)["summary"]
    assert "12.0 TEC units" in summary
    assert "rose" not in summary and "fell" not in summary


def test_long_gaps_do_not_produce_a_continuous_tec_trend(context):
    context["localTec"][0]["points"] = context["localTec"][0]["points"][::3]
    assert "rose" not in render(context)["summary"]


def test_high_absolute_tec_alone_does_not_claim_a_local_storm(context):
    context["city"] = "HARARE"
    brief = render(context)
    assert "32.0 TEC units" in brief["summary"]
    assert brief["status_tone"] == "excellent"
    assert "storm" not in brief["summary"] and "high TEC" not in brief["summary"]


def test_a_correction_service_problem_is_not_attributed_to_tec(context):
    context["forecasts"][0]["feedReliability"] = 12
    brief = render(context)
    assert "could not check the local service" in brief["summary"]
    assert "does not confirm a space-weather problem" in brief["summary"]


def test_unknown_city_is_rejected(context):
    context["city"] = "NOT A CITY"
    with pytest.raises(ValueError, match="Unknown"):
        render(context)


def test_public_build_path_preserves_regional_context(context):
    forecasts = [GnssForecastCity(
        **{k: v for k, v in row.items() if k != "feedReliability"}, feed_reliability=row["feedReliability"],
    ) for row in context["forecasts"]]
    briefs = build_audience_news(forecasts, context["computedAt"], context["sw"],
                                local_tec=context["localTec"], city="MASVINGO")
    assert all("Masvingo" in brief.headline for brief in briefs)
    assert all("12.0 TEC units" in brief.summary for brief in briefs)


def test_global_storm_outlook_does_not_claim_confirmed_local_failure(context):
    brief = plain_news_fields("farmer", "warning", context["computedAt"], {**context["sw"], "kp": 7},
        forecasts=context["forecasts"], local_tec=context["localTec"], city="MASVINGO")
    assert "global readings show magnetic storm activity" in brief["summary"]
    assert "can make" in brief["summary"] and "will fail" not in brief["summary"]


def test_national_highlight_keeps_the_measured_place_name(context):
    brief = plain_news_fields("citizen", "excellent", context["computedAt"], context["sw"],
        forecasts=context["forecasts"], local_tec=context["localTec"])
    assert "Masvingo" in brief["headline"]
    assert "Near Masvingo" in brief["summary"]


def test_observation_and_generation_times_are_distinct_and_preserved_on_regeneration(context):
    first = render(context)
    context["computedAt"] = "2026-10-31T02:16:00Z"
    later = render(context)
    assert first["data_observed_at"] == later["data_observed_at"] == "2026-10-31T02:10:00Z"
    assert first["brief_generated_at"] == "2026-10-31T02:12:00Z"
    assert later["brief_generated_at"] == "2026-10-31T02:16:00Z"
    assert "Data observed: 31 Oct 2026, 04:10 CAT · 02:10 UTC" in first["social_script"]
    assert "Brief generated: 31 Oct 2026, 04:12 CAT · 02:12 UTC" in first["social_script"]


def test_old_observation_time_is_shown_without_calling_the_old_value_current(context):
    for point in context["localTec"][0]["points"]:
        point["time"] = "2026-10-31T00:00:00Z"
    brief = render(context)
    assert brief["data_observed_at"] == "2026-10-31T00:00:00Z"
    assert "No recent local TEC reading" in brief["summary"]
    assert "12.0 TEC units" not in brief["summary"]


def test_global_check_time_is_not_mislabelled_as_local_observation_time(context):
    context["localTec"] = []
    brief = render(context)
    assert brief["data_observed_at"] is None
    assert brief["data_checked_at"] == "2026-10-31T02:10:00Z"
    assert brief["brief_generated_at"] == context["computedAt"]
    assert "Data observed: Unavailable" in brief["social_script"]
    assert "Data checked: 31 Oct 2026, 04:10 CAT" in brief["social_script"]


def test_api_schema_retains_all_three_timestamp_fields(context):
    from backend.schemas import NavigationNewsBriefOut

    fields = render(context)
    payload = NavigationNewsBriefOut(id="farmer", icon="", channels=[], **fields).model_dump()
    assert payload["data_observed_at"] == fields["data_observed_at"]
    assert payload["brief_generated_at"] == fields["brief_generated_at"]
    assert payload["data_checked_at"] == fields["data_checked_at"]
