"""Tests for geomagnetic storm alert classification."""

from __future__ import annotations

from zgiis.space_weather.geomagnetic_storm_alerts import classify_geomagnetic_activity
from zgiis.space_weather.storm_notifier import build_alarm_summary, geomagnetic_level_changed


def test_quiet_conditions():
    geo = classify_geomagnetic_activity(2.0, -15.0)
    assert geo["level"] == "none"
    assert geo["headline"] is None


def test_possible_storm_kp_active():
    geo = classify_geomagnetic_activity(4.0, -20.0)
    assert geo["level"] == "possible"
    assert "Kp Index: 4" in geo["headline"]


def test_possible_storm_dst_elevated():
    geo = classify_geomagnetic_activity(3.0, -35.0)
    assert geo["level"] == "possible"
    assert "Dst Index" in geo["headline"]
    assert "Possible storm conditions developing" in geo["headline"]


def test_possible_storm_dst_minus_48():
    geo = classify_geomagnetic_activity(0.0, -48.0)
    assert geo["level"] == "possible"
    assert "Dst Index: -48 nT" in geo["headline"]
    assert "Earth's magnetic field is becoming increasingly disturbed" in geo["headline"]


def test_geomagnetic_storm_kp_g1():
    geo = classify_geomagnetic_activity(5.0, -20.0)
    assert geo["level"] == "storm"
    assert "Kp Index: 5" in geo["headline"]


def test_geomagnetic_storm_dst_threshold():
    geo = classify_geomagnetic_activity(3.0, -55.0)
    assert geo["level"] == "storm"


def test_build_alarm_summary_includes_rules():
    alarm = build_alarm_summary(kp=4.0, dst=-20.0, alerts=[])
    assert alarm["geomagnetic_level"] == "possible"
    assert len(alarm["alert_rules"]) == 2
    assert alarm["active"] is True


def test_geomagnetic_level_changed_detects_transition():
    changed, geo = geomagnetic_level_changed(5.0, -20.0)
    assert geo["level"] == "storm"
    assert changed is True
