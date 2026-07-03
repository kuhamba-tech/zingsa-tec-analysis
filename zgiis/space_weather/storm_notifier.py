"""Geomagnetic storm alert notifications — SMS, WhatsApp, and email.

Dispatched when EKF deviation alerts fire or Kp crosses storm thresholds.
Credentials come from environment variables; STORM_ALERT_DRY_RUN=true logs only.
"""
from __future__ import annotations

import json
import logging
import os
import smtplib
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any

import requests

log = logging.getLogger(__name__)

_STATE_PATH = Path(__file__).resolve().parents[2] / "static" / "data" / "storm_notify_state.json"
_SEVERITY_RANK = {"Low": 0, "Moderate": 1, "High": 2, "Severe": 3}


def _dry_run() -> bool:
    raw = os.getenv("STORM_ALERT_DRY_RUN", "true").strip().lower()
    return raw in {"1", "true", "yes", "on"}


def _load_state() -> dict[str, Any]:
    try:
        if _STATE_PATH.exists():
            return json.loads(_STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        pass
    return {}


def _save_state(state: dict[str, Any]) -> None:
    try:
        _STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")
    except Exception as exc:
        log.warning("Could not persist storm notify state: %s", exc)


def channels_configured() -> dict[str, bool]:
    return {
        "email": bool(os.getenv("STORM_ALERT_EMAIL_TO", "").strip() and os.getenv("SMTP_HOST", "").strip()),
        "sms": bool(
            os.getenv("STORM_ALERT_SMS_TO", "").strip()
            and os.getenv("TWILIO_ACCOUNT_SID", "").strip()
            and os.getenv("TWILIO_AUTH_TOKEN", "").strip()
        ),
        "whatsapp": bool(
            os.getenv("STORM_ALERT_WHATSAPP_TO", "").strip()
            and os.getenv("WHATSAPP_ACCESS_TOKEN", "").strip()
            and os.getenv("WHATSAPP_PHONE_NUMBER_ID", "").strip()
        ),
    }


def kp_storm_level(kp: float | None) -> str | None:
    if kp is None:
        return None
    if kp >= 9:
        return "Extreme G5"
    if kp >= 8:
        return "Severe G4"
    if kp >= 7:
        return "Strong G3"
    if kp >= 6:
        return "Moderate G2"
    if kp >= 5:
        return "Minor G1"
    if kp >= 4:
        return "Active"
    return None


def build_alarm_summary(
    *,
    kp: float | None,
    dst: float | None,
    alerts: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build dashboard alarm payload from live indices + unacknowledged alerts."""
    storm = kp_storm_level(kp)
    active = [a for a in alerts if not a.get("acknowledged_status")]
    moderate_plus = [
        a for a in active
        if _SEVERITY_RANK.get(str(a.get("severity")), 0) >= _SEVERITY_RANK["Moderate"]
    ]
    count = len(moderate_plus) + (1 if storm and (kp or 0) >= 5 else 0)
    if storm and (kp or 0) >= 4 and not moderate_plus:
        count = max(count, 1)

    messages: list[str] = []
    if storm and (kp or 0) >= 5:
        messages.append(f"ACTIVE GEOMAGNETIC STORM — Kp {kp:.0f} ({storm})")
    elif storm and (kp or 0) >= 4:
        messages.append(f"Elevated geomagnetic activity — Kp {kp:.0f} ({storm})")

    if moderate_plus:
        worst = max(moderate_plus, key=lambda a: _SEVERITY_RANK.get(str(a.get("severity")), 0))
        messages.append(
            f"Possible geomagnetic disturbance: {worst.get('parameter_label')} "
            "observed value differs significantly from EKF prediction. "
            "Check Kp, Dst, TEC and solar wind conditions."
        )

    banner = " · ".join(messages) if messages else None
    return {
        "active": count > 0,
        "active_count": count,
        "banner": banner,
        "kp_storm_level": storm,
        "ekf_alert_count": len(moderate_plus),
    }


def _format_message(alert: dict[str, Any] | None, *, kp: float | None, dst: float | None, headline: str) -> str:
    lines = [
        "ZINGSA Space Weather Alert",
        headline,
        "",
    ]
    if kp is not None:
        lines.append(f"Kp Index: {kp:.1f}" + (f" ({kp_storm_level(kp)})" if kp_storm_level(kp) else ""))
    if dst is not None:
        lines.append(f"Dst Index: {dst:.0f} nT")
    if alert:
        lines.extend([
            "",
            f"Parameter: {alert.get('parameter_label')}",
            f"Observed: {alert.get('observed_value')}",
            f"EKF predicted: {alert.get('ekf_predicted_value')}",
            f"Error: {alert.get('prediction_error')} (threshold {alert.get('threshold')})",
            f"Severity: {alert.get('severity')}",
            "",
            str(alert.get("alert_message") or ""),
        ])
        related = alert.get("related_indicators") or []
        if related:
            lines.append(f"Related indicators: {', '.join(related)}")
    lines.extend([
        "",
        f"Time (UTC): {datetime.now(tz=timezone.utc).strftime('%Y-%m-%d %H:%M')}",
        "Dashboard: https://zingsa-gnss-tec.vercel.app/dashboard",
    ])
    return "\n".join(lines)


def _send_email(subject: str, body: str) -> tuple[bool, str]:
    to_raw = os.getenv("STORM_ALERT_EMAIL_TO", "").strip()
    if not to_raw:
        return False, "STORM_ALERT_EMAIL_TO not set"
    host = os.getenv("SMTP_HOST", "").strip()
    port = int(os.getenv("SMTP_PORT", "587"))
    user = os.getenv("SMTP_USER", "").strip()
    password = os.getenv("SMTP_PASSWORD", "").strip()
    from_addr = os.getenv("SMTP_FROM", user).strip()
    if not host:
        return False, "SMTP_HOST not set"

    recipients = [e.strip() for e in to_raw.split(",") if e.strip()]
    msg = MIMEMultipart()
    msg["From"] = from_addr
    msg["To"] = ", ".join(recipients)
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain", "utf-8"))

    if _dry_run():
        log.info("DRY-RUN email to %s: %s", recipients, subject)
        return True, f"dry-run email to {len(recipients)} recipient(s)"

    try:
        with smtplib.SMTP(host, port, timeout=30) as server:
            server.starttls()
            if user and password:
                server.login(user, password)
            server.sendmail(from_addr, recipients, msg.as_string())
        return True, f"email sent to {len(recipients)} recipient(s)"
    except Exception as exc:
        log.exception("Storm alert email failed")
        return False, str(exc)


def _send_sms(body: str) -> tuple[bool, str]:
    to = os.getenv("STORM_ALERT_SMS_TO", "").strip()
    sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
    token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
    from_num = os.getenv("TWILIO_FROM_NUMBER", "").strip()
    if not all([to, sid, token, from_num]):
        return False, "Twilio credentials or STORM_ALERT_SMS_TO not set"

    text = body if len(body) <= 1500 else body[:1490] + "…"

    if _dry_run():
        log.info("DRY-RUN SMS to %s len=%d", to, len(text))
        return True, f"dry-run SMS to {to}"

    try:
        res = requests.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
            auth=(sid, token),
            data={"From": from_num, "To": to, "Body": text},
            timeout=30,
        )
        ok = res.status_code < 400
        return ok, res.text[:200] if not ok else "sms sent"
    except Exception as exc:
        log.exception("Storm alert SMS failed")
        return False, str(exc)


def _send_whatsapp(body: str) -> tuple[bool, str]:
    from zgiis.navigation.broadcast_agent.channels import WhatsAppCloudChannel

    channel = WhatsAppCloudChannel()
    result = channel.send(
        audience="storm",
        script_kind="alert",
        text=body,
        brief={},
        dry_run=_dry_run(),
        options={"to": os.getenv("STORM_ALERT_WHATSAPP_TO", "").strip()},
    )
    return result.ok, result.detail


def last_kp_notify_key() -> str | None:
    return _load_state().get("last_kp_notify_key")


def dispatch_storm_notifications(
    *,
    new_alerts: list[dict[str, Any]],
    kp: float | None = None,
    dst: float | None = None,
    kp_storm_changed: bool = False,
) -> list[dict[str, Any]]:
    """Send SMS / WhatsApp / email for newly created EKF alerts or Kp storm transitions."""
    if not new_alerts and not kp_storm_changed:
        return []

    state = _load_state()
    results: list[dict[str, Any]] = []

    alerts_to_notify = [
        a for a in new_alerts
        if _SEVERITY_RANK.get(str(a.get("severity")), 0) >= _SEVERITY_RANK["Moderate"]
    ]

    if kp_storm_changed and kp is not None and (kp >= 5):
        headline = f"ACTIVE GEOMAGNETIC STORM — Kp {kp:.0f} ({kp_storm_level(kp)})"
        body = _format_message(None, kp=kp, dst=dst, headline=headline)
        key = f"kp_storm_{int(kp)}"
        if state.get("last_kp_notify_key") != key:
            results.extend(_dispatch_all(headline, body))
            state["last_kp_notify_key"] = key

    for alert in alerts_to_notify:
        key = alert.get("alert_id")
        if state.get("last_alert_id") == key:
            continue
        headline = f"Space weather alert — {alert.get('severity')} — {alert.get('parameter_label')}"
        body = _format_message(alert, kp=kp, dst=dst, headline=headline)
        results.extend(_dispatch_all(headline, body))
        state["last_alert_id"] = key

    if results:
        state["last_dispatch_utc"] = datetime.now(tz=timezone.utc).isoformat()
        _save_state(state)

    return results


def _dispatch_all(subject: str, body: str) -> list[dict[str, Any]]:
    configured = channels_configured()
    out: list[dict[str, Any]] = []
    channels = (
        ("email", configured["email"], lambda: _send_email(subject, body)),
        ("sms", configured["sms"], lambda: _send_sms(body)),
        ("whatsapp", configured["whatsapp"], lambda: _send_whatsapp(body)),
    )
    for name, enabled, fn in channels:
        if not enabled:
            continue
        ok, detail = fn()
        out.append({"channel": name, "ok": ok, "detail": detail})
        if ok:
            log.info("Storm alert %s: %s", name, detail)
        else:
            log.warning("Storm alert %s failed: %s", name, detail)
    return out
