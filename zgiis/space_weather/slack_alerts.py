"""Post ZINGSA operational alerts to a Slack incoming webhook.

The webhook URL stays in the environment. A missing URL leaves the channel off.
STORM_ALERT_DRY_RUN=true records the message without posting it.
"""
from __future__ import annotations

import logging
import os
from typing import Any

import requests

log = logging.getLogger(__name__)

_DASHBOARD = "https://zingsa-gnss-tec.vercel.app/storm-watch/"


def slack_webhook_url() -> str:
    return os.getenv("SLACK_WEBHOOK_URL", "").strip()


def slack_configured() -> bool:
    url = slack_webhook_url()
    return url.startswith("https://") and " " not in url


def _dry_run() -> bool:
    raw = os.getenv("STORM_ALERT_DRY_RUN", "true").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def post_slack(text: str) -> tuple[bool, str]:
    """Send one alert text. Returns (ok, detail) and never includes the webhook URL."""
    if not slack_configured():
        return False, "SLACK_WEBHOOK_URL not set"
    message = text.strip()
    if not message:
        return False, "empty slack message"
    if _dry_run():
        log.info("DRY-RUN slack len=%d", len(message))
        return True, "dry-run slack"
    try:
        response = requests.post(
            slack_webhook_url(),
            json={"text": message},
            timeout=15,
        )
    except Exception:
        log.exception("Slack alert delivery failed")
        return False, "slack delivery failed"
    if response.status_code >= 400:
        log.warning("Slack alert rejected with HTTP %s", response.status_code)
        return False, f"slack HTTP {response.status_code}"
    return True, "slack sent"


def format_early_warning_alert(alert: dict[str, Any]) -> str:
    authority = str(alert.get("authority") or "")
    if authority == "zingsa_experimental":
        source_label = "ZINGSA experimental driver watch"
    elif authority == "official_noaa":
        source_label = "International reference / observed indices"
    else:
        source_label = "Zimbabwe GNSS observation alert"
    observed = alert.get("observed_value")
    unit = str(alert.get("unit") or "").strip()
    observed_line = f"Observed: {observed} {unit}".strip() if observed is not None else ""
    lines = [
        "*ZINGSA SPACE WEATHER ALERT*",
        f"{str(alert.get('severity') or 'watch').upper()} / {source_label}",
        "",
        str(alert.get("title") or "Alert"),
        str(alert.get("message") or ""),
        "",
        observed_line,
        f"Source: {alert.get('source') or 'Not supplied'}",
        _DASHBOARD,
    ]
    return "\n".join(line for line in lines if line)


def broadcast_early_warning_alerts(alerts: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Post newly opened early-warning alerts. One failure does not stop the rest."""
    results: list[dict[str, str]] = []
    if not slack_configured() or not alerts:
        return results
    for alert in alerts:
        ok, detail = post_slack(format_early_warning_alert(alert))
        results.append({"alert_id": str(alert.get("alert_id") or ""), "ok": str(ok).lower(), "detail": detail})
        if ok:
            log.info("Early-warning Slack alert: %s", detail)
        else:
            log.warning("Early-warning Slack alert failed: %s", detail)
    return results
