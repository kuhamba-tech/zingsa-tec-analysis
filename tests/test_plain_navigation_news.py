"""Public news stays short, readable and consistent across delivery channels."""
from dataclasses import asdict
import re

import pytest

from zgiis.navigation.audience_news import build_audience_news
from zgiis.navigation.brief_renderer import render_brief_for_recipient
from zgiis.navigation.facebook_publish import build_facebook_post
from zgiis.navigation.plain_news import plain_news_fields, plain_news_templates


STAMP = "2026-10-31T02:12:00Z"
READINGS = {"kp": 2.0, "dst": -16.0, "s4": None, "gnss_risk": "Low", "updated_utc": STAMP}


@pytest.mark.parametrize("audience", ["citizen", "farmer", "surveyor", "driver", "aviation", "scientist"])
@pytest.mark.parametrize("tone", ["excellent", "moderate", "warning"])
def test_public_copy_is_short_and_has_no_unexplained_indices(audience, tone):
    brief = plain_news_fields(audience, tone, STAMP, READINGS)
    script = brief["broadcast_script"]
    assert len(script.split()) <= 90
    assert not re.search(r"\b(Kp|Dst|S4|VTEC|TECU|GNSS|RTK|ROTI|RAIM|GIC)\b|≠", script)
    assert "2026" in script and "04:12 CAT" in script
    assert "What to do:" in script
    assert brief["social_script"] == script


@pytest.mark.parametrize("sw", [None, {}, {**READINGS, "updated_utc": "invalid"},
    {**READINGS, "updated_utc": "2026-10-31T00:00:00Z"},
    {**READINGS, "kp": float("nan"), "dst": None}])
def test_missing_or_old_readings_do_not_claim_good_conditions(sw):
    brief = plain_news_fields("citizen", "excellent", STAMP, sw)
    assert "Waiting" in brief["headline"]
    assert "cannot confirm" in brief["summary"]
    assert brief["status_tone"] != "excellent"


def test_all_audiences_get_consistent_status_with_different_practical_actions():
    briefs = build_audience_news([], STAMP, READINGS)
    assert len(briefs) == 6
    assert len({b.headline for b in briefs}) == 1
    assert len({b.action for b in briefs}) == 6
    assert all(b.space_weather_bullets == [] and b.bullets == [] for b in briefs)


def test_whatsapp_and_facebook_use_the_same_short_citizen_message():
    brief = asdict(build_audience_news([], STAMP, READINGS)[0])
    whatsapp = render_brief_for_recipient(brief, language="en", accessibility="standard")
    facebook = build_facebook_post([brief], computed_at=STAMP)
    assert whatsapp == facebook == brief["social_script"]


def test_old_cached_technical_copy_is_invalidated():
    from datetime import datetime, timedelta, timezone
    from zgiis.navigation.news_cache import NavigationNewsCacheRecord, cache_is_fresh

    now = datetime.now(timezone.utc)
    record = NavigationNewsCacheRecord(
        last_updated_at=now.isoformat(), next_update_at=(now + timedelta(hours=4)).isoformat(),
        update_interval_hours=4, computed_at=now.isoformat(), input_summary="", sources={}, briefs=[],
    )
    assert not cache_is_fresh(record, now)
    record.content_version = plain_news_templates()["version"]
    assert not cache_is_fresh(record, now)  # A matching copy version alone lacks evidence.
    record.assessment = {"valid_until": (now + timedelta(minutes=2)).isoformat()}
    assert cache_is_fresh(record, now)


def test_timestamp_midnight_keeps_the_correct_utc_date():
    from zgiis.navigation.plain_news import _parse_time, news_timestamp

    stamp = news_timestamp(_parse_time("2026-10-31T23:30:00Z"))
    assert "01 Nov 2026, 01:30 CAT" in stamp
    assert "31 Oct 2026, 23:30 UTC" in stamp
