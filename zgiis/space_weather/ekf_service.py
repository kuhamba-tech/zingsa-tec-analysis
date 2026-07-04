"""Shared EKF evaluation for dashboard reads and scheduled storm notifications."""
from __future__ import annotations

from backend.schemas import EkfAlertOut, EkfPointOut, EkfSeriesOut, EkfStatusOut
from backend.timeline_builder import build_timelines


def _float_or_none(v: object) -> float | None:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def compute_ekf_status(
    sw: dict,
    *,
    dispatch_notifications: bool = False,
) -> EkfStatusOut:
    """Run EKF on dashboard timelines, persist alerts, optionally notify."""
    from zgiis.space_weather.ekf import run_ekf_series
    from zgiis.space_weather.ekf_alerts import evaluate
    from zgiis.space_weather.storm_notifier import (
        build_alarm_summary,
        channels_configured,
        dispatch_storm_notifications,
        kp_storm_level,
        last_kp_notify_key,
    )
    from zgiis.db.ekf_alert_db import EkfAlertDB

    tl = build_timelines(sw)
    raw_series = {
        name: getattr(tl, name)
        for name in (
            "kp", "dst", "f107", "solar_wind", "s4", "gnss_risk", "stations_online", "mean_vtec",
        )
    }

    ekf_series = {
        name: run_ekf_series([(p.t, p.v) for p in points if p.v is not None], name)
        for name, points in raw_series.items()
        if points
    }
    result = evaluate(ekf_series)

    db = EkfAlertDB()
    newly_created: list[dict] = []
    stored_alerts: list[dict] = []
    for alert in result["alerts"]:
        stored = db.insert_if_new(alert)
        stored_alerts.append(stored)
        if stored.get("alert_id") == alert.get("alert_id"):
            newly_created.append(stored)

    kp = _float_or_none(sw.get("kp"))
    dst = _float_or_none(sw.get("dst"))
    storm = kp_storm_level(kp)
    prev_storm = last_kp_notify_key()
    kp_storm_changed = storm is not None and (kp or 0) >= 5 and prev_storm != f"kp_storm_{int(kp or 0)}"

    if dispatch_notifications:
        dispatch_storm_notifications(
            new_alerts=newly_created,
            kp=kp,
            dst=dst,
            kp_storm_changed=kp_storm_changed,
        )

    recent = db.list_alerts(hours=6)
    alarm = build_alarm_summary(kp=kp, dst=dst, alerts=stored_alerts or recent)
    notify = channels_configured()

    return EkfStatusOut(
        series={
            name: EkfSeriesOut(
                parameter=name,
                points=[
                    EkfPointOut(
                        t=p.t,
                        observed=p.observed,
                        predicted=p.predicted,
                        error=p.error,
                        confidence=p.confidence,
                    )
                    for p in points
                ],
            )
            for name, points in ekf_series.items()
        },
        alerts=[EkfAlertOut(**a) for a in stored_alerts],
        banner=alarm.get("banner"),
        active_alert_count=int(alarm.get("active_count") or 0),
        kp_storm_level=alarm.get("kp_storm_level"),
        notification_channels=notify,
    )
