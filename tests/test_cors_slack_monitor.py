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
CATALOG = {code: {"name": name, "lat": -18.9, "lon": 27.8} for code, name in NAMES.items()}


class FakeHistory:
    def __init__(self):
        self.records = {}
        self.since = {}

    def station_record(self, code, hours=168.0):
        return self.records.get(code)

    def offline_since(self, code):
        return self.since.get(code)
ALL_UP = {c: "online" for c in ("beit", "lupa", "kwek", "chir", "gutu")}


@pytest.fixture
def make(tmp_path, monkeypatch):
    monkeypatch.setenv("CORS_DAILY_SUMMARY_HOUR", "")
    monkeypatch.setenv("CORS_OFFLINE_ALERT_MINUTES", "0")  # most tests check the 3-reading rule alone
    # 10:00 CAT, away from the daily summary hour.
    clock = Clock(datetime(2026, 11, 11, 8, 0, tzinfo=timezone.utc).timestamp())

    history = FakeHistory()

    def factory():
        mon = cm.CorsSlackMonitor(tmp_path / "state.json", now=clock, catalog=CATALOG, history=history)
        mon.fake = history
        return mon, clock

    return factory


def run(mon, clock, statuses, n=1, **kw):
    out = []
    for _ in range(n):
        clock.tick()
        out += [cm.render(m) for m in mon.evaluate(payload(clock, statuses), **kw)]
    return out


def test_first_run_posts_one_summary_and_lists_unmonitored(make):
    mon, clock = make()
    msgs = [cm.render(m) for m in mon.evaluate(payload(clock, {**ALL_UP, "gutu": "offline"}))]
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
    assert len(msgs) == 1 and "CORS station offline: LUPA" in msgs[0] and "Lupane" in msgs[0]
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
        msgs += [cm.render(m) for m in mon.evaluate(stale)]
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
    assert len(msgs) == 1 and "Daily CORS network report" in msgs[0]
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


def test_offline_report_has_time_location_history_and_context(make):
    mon, clock = make()
    mon.fake.records["lupa"] = {
        "uptime_pct": 96.2, "outages": 3, "downtime_s": 15000, "longest_s": 7800,
        "last_recovered_at": clock.t - 2 * 86400, "current_since": clock.t,
    }
    mon.evaluate(payload(clock, {**ALL_UP, "gutu": "offline"}))
    down = {**ALL_UP, "gutu": "offline", "lupa": "offline"}
    first_offline = clock.t + 30
    msgs = run(mon, clock, down, 3, last_seen_by_station={"lupa": first_offline - 120})
    text = msgs[0]
    assert cm._fmt_time(first_offline) in text  # dated from the first offline reading
    assert "Went offline" in text and "confirmed" in text
    assert "google.com/maps" in text
    assert "Last data received by the collector" in text
    assert "online 96.2% of the time" in text and "3 outages" in text and "longest 2h 10m" in text
    assert "Previous outage ended" in text
    assert "Also offline now:* GUTU (1)" in text
    assert "Updates follow at 2h, 6h, 24h" in text


def test_recovery_report_gives_start_end_and_downtime(make):
    mon, clock = make()
    mon.evaluate(payload(clock, ALL_UP))
    run(mon, clock, {**ALL_UP, "beit": "offline"}, 3)
    went = mon.state["stations"]["beit"]["since"]
    run(mon, clock, {**ALL_UP, "beit": "offline"}, 100)
    msgs = [m for m in run(mon, clock, ALL_UP, 3) if "back online" in m]
    assert len(msgs) == 1
    assert cm._fmt_time(went) in msgs[0] and "Downtime:* 51m" in msgs[0]


def test_recovery_of_station_offline_before_monitoring_uses_archive_start(make):
    mon, clock = make()
    mon.fake.since["gutu"] = (clock.t - 3 * 86400, True)
    mon.evaluate(payload(clock, {**ALL_UP, "gutu": "offline"}))
    msgs = [m for m in run(mon, clock, ALL_UP, 3) if "back online" in m]
    assert "Downtime:* 3d 0h" in msgs[0] and "at least" not in msgs[0]


def test_still_offline_updates_at_2h_6h_24h_then_daily(make):
    mon, clock = make()
    mon.evaluate(payload(clock, ALL_UP))
    down = {**ALL_UP, "kwek": "offline"}
    msgs = run(mon, clock, down, 2 * 60 * 24 * 3 + 20)  # just over three days of heartbeats
    reminders = [m for m in msgs if "Still offline" in m]
    assert len(reminders) == 5  # 2h, 6h, 24h, 48h, 72h
    assert "offline for *2h" in reminders[0] and "KWEK" in reminders[0]


def test_stations_offline_at_start_get_no_misleading_reminders(make):
    mon, clock = make()
    mon.evaluate(payload(clock, {**ALL_UP, "chir": "offline"}))
    assert not [m for m in run(mon, clock, {**ALL_UP, "chir": "offline"}, 600) if "Still offline" in m]


def test_daily_report_lists_offline_since_and_recent_outages(make, monkeypatch):
    monkeypatch.setenv("CORS_DAILY_SUMMARY_HOUR", "8")
    mon, clock = make()
    mon.fake.since["chir"] = (clock.t - 5 * 86400, True)
    mon.fake.records["beit"] = {"uptime_pct": 99.0, "outages": 1, "downtime_s": 900, "longest_s": 900,
                                "last_recovered_at": clock.t, "current_since": None}
    mon.evaluate(payload(clock, {**ALL_UP, "chir": "offline"}))
    msgs = run(mon, clock, {**ALL_UP, "chir": "offline"}, 2880)
    daily = [m for m in msgs if "Daily CORS network report" in m][0]
    assert "CHIR* (Chiredzi): offline since" in daily and "(*5d 22h*)" in daily
    assert "Outages in the last 24 hours" in daily and "BEIT* (Beitbridge): 1 outage, 15m offline" in daily


def test_weekly_report_ranks_stations(make, monkeypatch):
    monkeypatch.setenv("CORS_DAILY_SUMMARY_HOUR", "8")
    mon, clock = make()
    mon.fake.records.update({
        "beit": {"uptime_pct": 100.0, "outages": 0, "downtime_s": 0, "longest_s": 0, "last_recovered_at": None, "current_since": None},
        "lupa": {"uptime_pct": 80.5, "outages": 4, "downtime_s": 30000, "longest_s": 20000, "last_recovered_at": None, "current_since": 1.0},
    })
    mon.evaluate(payload(clock, ALL_UP))  # Wednesday 11 Nov
    msgs = run(mon, clock, ALL_UP, 2880 * 5)  # through Monday 16 Nov
    weekly = [m for m in msgs if "Weekly CORS station report" in m]
    assert len(weekly) == 1
    body = weekly[0]
    assert body.index("LUPA") < body.index("BEIT")
    assert "offline now" in body and "No archive data for" in body


def test_summarise_samples_counts_confirmed_outages_only():
    t0 = 1_000_000.0
    seq = ["online"] * 5 + ["offline"] + ["online"] * 5 + ["offline"] * 4 + ["online"] * 6 + ["offline"] * 3
    samples = [(t0 + 30 * i, s) for i, s in enumerate(seq)]
    now = samples[-1][0] + 30
    rec = cm.summarise_samples(samples, now=now)
    assert rec["outages"] == 2  # the single blip is ignored
    assert rec["downtime_s"] == 120 + 90  # 4 readings closed, 3-reading run still open
    assert rec["current_since"] == samples[-3][0]
    assert rec["uptime_pct"] == round(100 * 16 / 24, 1)


def test_collector_gap_does_not_split_or_inflate_an_outage():
    t0 = 1_000_000.0
    samples = [(t0 + 30 * i, "offline") for i in range(5)]
    samples += [(t0 + 36000 + 30 * i, "offline") for i in range(5)]  # 10 h collector gap
    samples += [(t0 + 36150, "online")]
    rec = cm.summarise_samples(samples, now=t0 + 36200)
    assert rec["outages"] == 1
    assert rec["downtime_s"] == 120 + 150  # observed time only
    assert rec["last_recovered_at"] == t0 + 36150


def test_short_outage_below_the_alert_period_sends_nothing(make, monkeypatch):
    monkeypatch.setenv("CORS_OFFLINE_ALERT_MINUTES", "10")
    mon, clock = make()
    mon.evaluate(payload(clock, ALL_UP))
    down = {**ALL_UP, "lupa": "offline"}
    assert run(mon, clock, down, 16) == []  # 8 minutes offline
    assert run(mon, clock, ALL_UP, 10) == []  # recovers: no offline or online message


def test_offline_alert_after_the_period_dated_from_first_reading(make, monkeypatch):
    monkeypatch.setenv("CORS_OFFLINE_ALERT_MINUTES", "10")
    mon, clock = make()
    mon.evaluate(payload(clock, ALL_UP))
    down = {**ALL_UP, "lupa": "offline"}
    first = clock.t + 30
    msgs = run(mon, clock, down, 19)  # 9.5 minutes
    assert msgs == []
    msgs = run(mon, clock, down, 2)
    assert len(msgs) == 1 and "CORS station offline: LUPA" in msgs[0]
    assert cm._fmt_time(first) in msgs[0]
    up = run(mon, clock, ALL_UP, 3)
    assert len(up) == 1 and "back online" in up[0]


def test_history_ignores_drops_shorter_than_the_alert_period():
    t0 = 1_000_000.0
    seq = ["online"] * 3 + ["offline"] * 6 + ["online"] * 3 + ["offline"] * 30 + ["online"]
    samples = [(t0 + 30 * i, s) for i, s in enumerate(seq)]
    rec = cm.summarise_samples(samples, now=samples[-1][0], min_duration_s=600)
    assert rec["outages"] == 1  # the 3-minute drop is not counted
    assert rec["downtime_s"] == 900
