"""Synthetic unit tests for ZINGSA early-warning sustained rules."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from zgiis.space_weather.early_warning import (
    Sample,
    evaluate_geomagnetic_observed,
    evaluate_solar_wind_imf,
    evaluate_zimbabwe_gnss,
    noaa_g_scale,
    should_suppress,
    summarise_alerts,
)


def _series(start: datetime, values: list[float], step_minutes: int = 1) -> list[Sample]:
    return [
        Sample(time=start + timedelta(minutes=i * step_minutes), value=value)
        for i, value in enumerate(values)
    ]


def test_speed_500_requires_ten_minutes():
    start = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)
    short = _series(start, [520.0] * 5)
    alerts = evaluate_solar_wind_imf(short, [], now=start + timedelta(minutes=4))
    assert alerts == []

    sustained = _series(start, [520.0] * 12)
    alerts = evaluate_solar_wind_imf(sustained, [], now=start + timedelta(minutes=11))
    assert any(a.rule_id == "sw_speed_500" for a in alerts)
    assert all(a.authority == "zingsa_experimental" for a in alerts)


def test_speed_700_watch_and_bz_rules():
    start = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)
    speed = _series(start, [720.0] * 15)
    bz = _series(start, [-6.0] * 15)
    alerts = evaluate_solar_wind_imf(speed, bz, now=start + timedelta(minutes=14))
    rules = {a.rule_id for a in alerts}
    assert "sw_speed_700" in rules
    assert "imf_bz_m5" in rules
    assert "sw_bz_combined" in rules
    assert "sw_speed_500" not in rules  # superseded by the 700 watch


def test_bz_minus_10_warning():
    start = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)
    bz = _series(start, [-12.0] * 12)
    alerts = evaluate_solar_wind_imf([], bz, now=start + timedelta(minutes=11))
    assert any(a.rule_id == "imf_bz_m10" for a in alerts)
    assert not any(a.rule_id == "imf_bz_m5" for a in alerts)


def test_stale_samples_do_not_alert():
    start = datetime(2026, 11, 9, 10, 0, tzinfo=timezone.utc)
    speed = _series(start, [600.0] * 20)
    alerts = evaluate_solar_wind_imf(speed, [], now=start + timedelta(hours=2))
    assert alerts == []


def test_observed_kp_g_scale():
    assert noaa_g_scale(5.0) == "G1"
    assert noaa_g_scale(9.0) == "G5"
    alerts = evaluate_geomagnetic_observed(kp=5.3, dst=-55.0)
    assert len(alerts) == 1
    assert alerts[0].authority == "official_noaa"
    assert "G1" in alerts[0].title


def test_zimbabwe_vtec_and_s4():
    alerts = evaluate_zimbabwe_gnss(mean_vtec=45.0, s4=0.4, region_vtec={"northern": 42.0})
    rules = {a.rule_id for a in alerts}
    assert "zw_vtec_high" in rules
    assert "zw_s4_moderate" in rules
    assert "zw_vtec_northern" in rules
    assert all(a.authority == "zimbabwe_gnss" for a in alerts)


def test_duplicate_suppression_and_summary():
    start = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)
    speed = _series(start, [560.0] * 15)
    alerts = evaluate_solar_wind_imf(speed, [], now=start + timedelta(minutes=14))
    assert alerts
    first = alerts[0]
    existing = first.to_dict()
    assert should_suppress(existing, first, now=start + timedelta(minutes=20))
    existing["status"] = "resolved"
    existing["last_updated"] = (start + timedelta(minutes=14)).isoformat()
    assert should_suppress(existing, first, now=start + timedelta(minutes=20))
    assert not should_suppress(existing, first, now=start + timedelta(hours=2))
    summary = summarise_alerts(alerts)
    assert summary["active_count"] >= 1
    assert summary["highest_severity"] in {"advisory", "watch", "warning", "severe"}
