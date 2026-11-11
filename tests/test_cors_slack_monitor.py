"""CORS station alerts for the CORS management Slack channel."""
from __future__ import annotations

import time
from datetime import datetime, timezone

import pytest

import zgiis.live.cors_slack_monitor as cm


class Clock:
    def __init__(self, start: float) -> None:
        self.t = start

    def __call__(self) -> float:
        return self.t

    def tick(self, seconds: float = 30) -> None:
        self.t += seconds


def payload(clock: Clock, statuses: dict[str, str], *, age: float = 0) -> dict:
    fetched = datetime.fromtimestamp(clock.t - age, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {
        "fetched_at": fetched,
        "error": None,
        "by_station": {
            code: {"spider_status": 3 if s == "online" else 2, "status": s} for code, s in statuses.items()
        },
    }


NAMES = {"beit": "Beitbridge", "lupa": "Lupane", "kwek": "Kwekwe", "chir": "Chiredzi", "gutu": "Gutu", "hara": "Harare"}
ALL_UP = {c: "online" for c in ("beit", "lupa", "kwek", "chir", "gutu")}


@pytest.fixture
def make(tmp_path, monkeypatch):
    monkeypatch.setenv("CORS_DAILY_SUMMARY_HOUR", "")
    # 10:00 CAT, away from the daily summary hour.
    clock = Clock(datetime(2026, 11, 11, 8, 0, tzinfo=timezone.utc).timestamp())

    def factory():
        return cm.CorsSlackMonitor(tmp_path / "state.json", now=clock, names=NAMES), clock

    return factory


def run(mon, clock, statuses, n=1, **kw):
    out = []
    for _ in range(n):
        clock.tick()
        out += mon.evaluate(payload(clock, statuses), **kw)
    return out


def test_first_run_posts_one_summary_and_lists_unmonitored(make):
    mon, clock = make()
    msgs = mon.evaluate(payload(clock, {**ALL_UP, "gutu": "offline"}))
    assert len(msgs) == 1
    assert "CORS monitoring started" in msgs[0]
    assert "4/5" in msgs[0] and "GUTU" in msgs[0]
    assert "HARA" in msgs[0]  # in catalogue but not in Spider


def test_no_seed_from_stale_or_fallback_data(make):
    mon, clock = make()
    assert mon.evaluate(payload(clock, ALL_UP, age=3600)) == []
    assert mon.evaluate({"fetched_at": None, "by_station": {}, "error": "down"}) == []
    assert mon.state == {}


def test_station_down_is_debounced_then_recovery_reports_downtime(make):
    mon, clock = make()
    mon.evaluate(payload(clock, ALL_UP))
    down = {**ALL_UP, "lupa": "offline"}
    assert run(mon, clock, down, 2) == []  # not yet confirmed
    msgs = run(mon, clock, down)
    assert len(msgs) == 1 and "CORS station offline" in msgs[0] and "LUPA" in msgs[0] and "Lupane" in msgs[0]
    assert "4/5" in msgs[0]
    assert run(mon, clock, down, 20) == []  # no repeats
    run(mon, clock, down, 120)  # an hour of heartbeats
    up = run(mon, clock, ALL_UP, 3)
    assert len(up) == 1 and "back online" in up[0] and "LUPA" in up[0]
    assert "1h" in up[0]


def test_single_blip_is_ignored(make):
    mon, clock = make()
    mon.evaluate(payload(clock, ALL_UP))
    assert run(mon, clock, {**ALL_UP, "beit": "offline"}) == []
    assert run(mon, clock, ALL_UP, 5) == []


def test_mass_outage_is_one_grouped_message(make):
    mon, clock = make()
    mon.evaluate(payload(clock, ALL_UP))
    msgs = run(mon, clock, {c: "offline" for c in ALL_UP}, 3)
    assert len(msgs) == 1
    assert "5 CORS stations went offline together" in msgs[0]


def test_stale_spider_freezes_station_alerts_and_alerts_once(make):
    mon, clock = make()
    mon.evaluate(payload(clock, ALL_UP))
    frozen_at = clock.t - 400  # cache older than the 5 minute freshness limit
    msgs = []
    for _ in range(40):  # 20 minutes of the same old cached reading
        clock.tick()
        stale = payload(clock, {c: "offline" for c in ALL_UP})
        stale["fetched_at"] = datetime.fromtimestamp(frozen_at, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        msgs += mon.evaluate(stale)
    assert len(msgs) == 1 and "Spider Site Status unreachable" in msgs[0]
    restored = run(mon, clock, ALL_UP)
    assert len(restored) == 1 and "restored" in restored[0]


def test_restart_with_saved_state_does_not_repeat(make):
    mon, clock = make()
    mon.evaluate(payload(clock, ALL_UP))
    run(mon, clock, {**ALL_UP, "chir": "offline"}, 3)
    mon2, _ = make()  # same state file, same clock
    assert run(mon2, clock, {**ALL_UP, "chir": "offline"}, 10) == []


def test_resume_after_long_gap_is_announced(make):
    mon, clock = make()
    mon.evaluate(payload(clock, ALL_UP))
    clock.tick(7200)
    mon2, _ = make()
    msgs = run(mon2, clock, ALL_UP)
    assert len(msgs) == 1 and "resumed" in msgs[0]


def test_flapping_station_is_summarised(make, monkeypatch):
    mon, clock = make()
    mon.evaluate(payload(clock, ALL_UP))
    msgs = []
    for i in range(6):
        state = {**ALL_UP, "kwek": "offline" if i % 2 == 0 else "online"}
        msgs += run(mon, clock, state, 3)
    flap = [m for m in msgs if "unstable" in m]
    assert len(flap) == 1
    assert len([m for m in msgs if "KWEK" in m]) == 4  # 3 transitions then the flap notice


def test_caster_refusal_alert_and_recovery(make):
    mon, clock = make()
    mon.evaluate(payload(clock, ALL_UP))
    clock.tick(700)  # past the startup grace with no data
    msgs = run(mon, clock, ALL_UP, last_data_at=None, last_reject_at=clock.t)
    assert len(msgs) == 1 and "refusing" in msgs[0]
    assert run(mon, clock, ALL_UP, last_reject_at=clock.t) == []
    ok = run(mon, clock, ALL_UP, last_data_at=clock.t + 30)
    assert len(ok) == 1 and "accepting" in ok[0]


def test_tec_stale_alert_only_when_checked(make):
    mon, clock = make()
    mon.evaluate(payload(clock, ALL_UP))
    clock.tick(700)
    assert run(mon, clock, ALL_UP, tec_checked=False, tec_age_s=None) == []
    msgs = run(mon, clock, ALL_UP, tec_checked=True, tec_age_s=1200)
    assert len(msgs) == 1 and "not reaching the database" in msgs[0]
    ok = run(mon, clock, ALL_UP, tec_checked=True, tec_age_s=20)
    assert len(ok) == 1 and "again" in ok[0]


def test_daily_summary_once_per_day(make, monkeypatch):
    monkeypatch.setenv("CORS_DAILY_SUMMARY_HOUR", "8")
    mon, clock = make()
    mon.evaluate(payload(clock, ALL_UP))  # seeding marks today as done
    assert run(mon, clock, ALL_UP) == []
    msgs = run(mon, clock, ALL_UP, 2880)  # 24 hours of heartbeats
    assert len(msgs) == 1 and "Daily CORS network summary" in msgs[0]
    assert run(mon, clock, ALL_UP) == []


def test_cors_webhook_never_falls_back_to_storm_webhook(monkeypatch):
    monkeypatch.delenv("SLACK_CORS_WEBHOOK_URL", raising=False)
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/storm")
    ok, detail = cm.post_cors_slack("test")
    assert ok is False and "SLACK_CORS_WEBHOOK_URL" in detail


def test_cors_post_uses_its_own_url(monkeypatch):
    import zgiis.space_weather.slack_alerts as sa

    monkeypatch.setenv("SLACK_CORS_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/cors")
    monkeypatch.setenv("CORS_ALERT_DRY_RUN", "false")
    sent = {}

    class R:
        status_code = 200

    def capture(url, json, timeout):
        sent["url"] = url
        sent["text"] = json["text"]
        return R()

    monkeypatch.setattr(sa.requests, "post", capture)
    ok, detail = cm.post_cors_slack("Station LUPA offline")
    assert ok and detail == "slack sent"
    assert sent["url"].endswith("/cors")
