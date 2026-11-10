"""Slack delivery for storm alerts and newly opened early-warning alerts."""

from __future__ import annotations

import zgiis.space_weather.slack_alerts as slack_alerts
from zgiis.space_weather.storm_notifier import channels_configured


def test_slack_stays_off_without_a_webhook(monkeypatch):
    monkeypatch.delenv("SLACK_WEBHOOK_URL", raising=False)
    assert slack_alerts.slack_configured() is False
    ok, detail = slack_alerts.post_slack("ZINGSA alert")
    assert ok is False
    assert "not set" in detail
    assert channels_configured()["slack"] is False


def test_dry_run_does_not_post(monkeypatch):
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/secret")
    monkeypatch.setenv("STORM_ALERT_DRY_RUN", "true")
    called = {"n": 0}

    def boom(*_args, **_kwargs):
        called["n"] += 1
        raise AssertionError("dry run must not call Slack")

    monkeypatch.setattr(slack_alerts.requests, "post", boom)
    ok, detail = slack_alerts.post_slack("Kp storm")
    assert ok is True
    assert detail == "dry-run slack"
    assert called["n"] == 0


def test_live_post_sends_the_alert_text(monkeypatch):
    monkeypatch.setenv("SLACK_WEBHOOK_URL", "https://hooks.slack.com/services/T/B/secret")
    monkeypatch.setenv("STORM_ALERT_DRY_RUN", "false")
    captured = {}

    class Response:
        status_code = 200

    def capture(url, json, timeout):
        captured["url"] = url
        captured["json"] = json
        captured["timeout"] = timeout
        return Response()

    monkeypatch.setattr(slack_alerts.requests, "post", capture)
    ok, detail = slack_alerts.post_slack("Geomagnetic storm")
    assert ok is True
    assert detail == "slack sent"
    assert captured["url"].endswith("/secret")
    assert captured["json"] == {"text": "Geomagnetic storm"}
    assert captured["timeout"] == 15


def test_early_warning_message_names_the_alert():
    text = slack_alerts.format_early_warning_alert({
        "authority": "zimbabwe_gnss",
        "severity": "warning",
        "title": "High S4 over Zimbabwe",
        "message": "Measured scintillation crossed the operating limit.",
        "observed_value": 0.42,
        "unit": "",
        "source": "ZINGSA CORS",
    })
    assert "ZINGSA SPACE WEATHER ALERT" in text
    assert "High S4 over Zimbabwe" in text
    assert "Observed: 0.42" in text
    assert "hooks.slack.com" not in text
