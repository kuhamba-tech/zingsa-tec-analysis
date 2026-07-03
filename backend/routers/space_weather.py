from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends, HTTPException

from backend.deps import require_api_key
from backend.schemas import (
    CorrelationPair,
    EkfAlertOut,
    EkfPointOut,
    EkfSeriesOut,
    EkfStatusOut,
    StormAlertStatus,
    SolarActivityFull,
    SolarWindDetail,
    SpaceWeatherCorrelationResponse,
    SpaceWeatherCurrent,
    SpaceWeatherHistoryResponse,
    SpaceWeatherHistoryRow,
    SpaceWeatherLogStatus,
    SpaceWeatherReportResponse,
    SpaceWeatherTimelines,
    TimelinePoint,
)
from backend.space_weather_logger import log_snapshot, status as log_status
from backend.timeline_cache import merge_timeline

router = APIRouter(prefix="/space-weather", tags=["space-weather"])


def _sw() -> dict:
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from zgiis.space_weather.fetch_indices import get_space_weather
    return get_space_weather(use_third_party=True)


@router.get("/current", response_model=SpaceWeatherCurrent)
async def current(_=Depends(require_api_key)):
    sw = _sw()
    try:
        from backend.routers.cors_network import _stations

        stations = _stations()
        sw["stations_online"] = sum(1 for s in stations if s.status == "online")
        sw["stations_total"] = len(stations)
    except Exception:
        pass
    log_snapshot(source="dashboard", force=False)
    return SpaceWeatherCurrent(
        kp=sw.get("kp"),
        kp_condition=sw.get("kp_condition"),
        kp_color=sw.get("kp_color"),
        dst=sw.get("dst"),
        f107=sw.get("f107"),
        s4=sw.get("s4"),
        gnss_risk=sw.get("gnss_risk"),
        gnss_risk_color=sw.get("gnss_risk_color"),
        stations_online=sw.get("stations_online"),
        stations_total=sw.get("stations_total"),
        plasma_speed=sw.get("solar_wind_speed") or sw.get("plasma_speed"),
        updated_utc=sw.get("updated_utc") or sw.get("timestamp"),
    )


@router.get("/solar-activity", response_model=SolarActivityFull)
async def solar_activity(_=Depends(require_api_key)):
    try:
        from zgiis.space_weather.solar_activity import (
            get_solar_activity,
            build_donki_cme_rows,
            build_donki_active_regions,
            build_donki_radio_bursts,
        )
    except ImportError as exc:
        return SolarActivityFull(mode="unavailable", error=f"module not found: {exc}")

    sa = get_solar_activity()

    donki = sa.get("donki") or {}
    sw_data = sa.get("solarWind") or {}
    level = sa.get("level") or {}
    flares = (donki.get("flares") or []) if isinstance(donki, dict) else []
    cmes = (donki.get("cmes") or []) if isinstance(donki, dict) else []
    storms = (donki.get("storms") or []) if isinstance(donki, dict) else []
    date_range = (donki.get("dateRange") or {}) if isinstance(donki, dict) else {}

    return SolarActivityFull(
        mode=sa.get("mode") or "unavailable",
        updated=sa.get("updated") or "",
        flare_class=sa.get("flareClass") or "N/A",
        flux=sa.get("flux"),
        xray_series=[float(v) for v in (sa.get("xraySeries") or []) if v is not None],
        solar_wind=SolarWindDetail(
            speed=sw_data.get("speed"),
            density=sw_data.get("density"),
            temperature=sw_data.get("temperature"),
            bt=sw_data.get("bt"),
            bz=sw_data.get("bz"),
        ),
        alerts=sa.get("alerts") or [],
        donki_flares=flares,
        donki_cmes=cmes,
        donki_storms=storms,
        donki_date_start=date_range.get("start"),
        donki_date_end=date_range.get("end"),
        donki_status=sa.get("donki_status") or "unavailable",
        donki_note=sa.get("donki_note") or "",
        activity_label=level.get("label") or "Low",
        activity_color=level.get("color") or "#22c55e",
        activity_gnss=level.get("gnss") or "Minimal impact",
        api_routes=sa.get("api_routes") or [],
        error=sa.get("error"),
        active_regions=build_donki_active_regions(flares),
        cme_rows=build_donki_cme_rows(cmes),
        radio_burst_rows=build_donki_radio_bursts(flares),
    )


def _build_timelines(sw: dict) -> SpaceWeatherTimelines:
    from zgiis.space_weather.fetch_indices import _parse_kp_value

    def _pts_keyed(raw: list | None, value_key: str) -> list[TimelinePoint]:
        if not raw:
            return []
        out = []
        for p in raw:
            if not isinstance(p, dict) or not p.get("time_tag"):
                continue
            v = p.get(value_key)
            try:
                v = float(v) if v is not None else None
            except (TypeError, ValueError):
                v = None
            out.append(TimelinePoint(t=str(p["time_tag"]), v=v))
        return out

    def _pts_kp(raw: list | None) -> list[TimelinePoint]:
        if not raw:
            return []
        out = []
        for p in raw:
            if not isinstance(p, dict) or not p.get("time_tag"):
                continue
            v = _parse_kp_value(p)
            out.append(TimelinePoint(t=str(p["time_tag"]), v=v))
        return out

    def _single_current_point(value: object, timestamp: object) -> list[TimelinePoint]:
        if value is None:
            return []
        try:
            v = float(value)
        except (TypeError, ValueError):
            return []
        t = str(timestamp or dt.datetime.utcnow().replace(microsecond=0).isoformat())
        return [TimelinePoint(t=t, v=v)]

    def _use_live_series_or_current_snapshot(
        raw: list | None,
        value_key: str,
        current_value: object,
        timestamp: object,
    ) -> list[TimelinePoint]:
        points = _pts_keyed(raw, value_key)
        values = {point.v for point in points if point.v is not None}
        if len(points) > 1 and len(values) > 1:
            return points
        return _single_current_point(current_value, timestamp)

    kp = merge_timeline("kp", _pts_kp(sw.get("kp_history")))
    dst = merge_timeline("dst", _pts_keyed(sw.get("dst_history"), "dst"))
    f107 = merge_timeline("f107", _pts_keyed(sw.get("f107_history"), "flux"))
    solar_wind = merge_timeline(
        "solar_wind",
        _pts_keyed(sw.get("solar_wind_history"), "speed"),
    )
    s4 = merge_timeline(
        "s4",
        _use_live_series_or_current_snapshot(
            sw.get("s4_history"),
            "s4",
            sw.get("s4"),
            sw.get("updated_utc") or sw.get("timestamp"),
        ),
    )

    return SpaceWeatherTimelines(
        kp=kp,
        dst=dst,
        f107=f107,
        solar_wind=solar_wind,
        s4=s4,
        gnss_risk=_pts_keyed(sw.get("gnss_risk_history"), "risk_score"),
        stations_online=_pts_keyed(sw.get("stations_online_history"), "online"),
    )


@router.get("/timelines", response_model=SpaceWeatherTimelines)
async def timelines(_=Depends(require_api_key)):
    return _build_timelines(_sw())


@router.post("/refresh", status_code=204)
async def refresh(_=Depends(require_api_key)):
    from zgiis.space_weather.fetch_indices import clear_space_weather_cache
    clear_space_weather_cache()
    log_snapshot(source="refresh", force=True)


@router.get("/log/status", response_model=SpaceWeatherLogStatus)
async def logging_status(_=Depends(require_api_key)):
    s = log_status()
    return SpaceWeatherLogStatus(**s)


@router.get("/history", response_model=SpaceWeatherHistoryResponse)
async def history(
    hours: float = 24.0,
    resample: str | None = None,
    _=Depends(require_api_key),
):
    from backend.space_weather_logger import get_db

    df = get_db().query_dataframe(hours=hours, resample=resample or None)
    rows: list[SpaceWeatherHistoryRow] = []
    if not df.empty:
        for _, r in df.iterrows():
            t = r["time"]
            time_str = t.isoformat() if hasattr(t, "isoformat") else str(t)
            rows.append(
                SpaceWeatherHistoryRow(
                    time=time_str,
                    kp=_float_or_none(r.get("kp")),
                    kp_condition=_str_or_none(r.get("kp_condition")),
                    dst=_float_or_none(r.get("dst")),
                    f107=_float_or_none(r.get("f107")),
                    plasma_speed=_float_or_none(r.get("plasma_speed")),
                    s4=_float_or_none(r.get("s4")),
                    gnss_risk=_str_or_none(r.get("gnss_risk")),
                    gnss_risk_score=_float_or_none(r.get("gnss_risk_score")),
                    stations_online=_int_or_none(r.get("stations_online")),
                    stations_total=_int_or_none(r.get("stations_total")),
                    mean_vtec=_float_or_none(r.get("mean_vtec")),
                )
            )
    return SpaceWeatherHistoryResponse(
        hours=hours,
        resample=resample,
        count=len(rows),
        rows=rows,
    )


@router.get("/report", response_model=SpaceWeatherReportResponse)
async def space_weather_report(
    period: str = "hourly",
    _=Depends(require_api_key),
):
    from zgiis.space_weather.report_builder import REPORT_WINDOWS, build_space_weather_report

    if period not in REPORT_WINDOWS:
        raise HTTPException(status_code=422, detail=f"Invalid period. Choose from: {', '.join(REPORT_WINDOWS)}")

    hours = REPORT_WINDOWS[period]["hours"]
    uptime_rows: list[dict] = []
    try:
        from zgiis.db.station_status_db import StationStatusDB
        uptime_rows = StationStatusDB().uptime_summary(hours=hours)
    except Exception:
        pass

    payload = build_space_weather_report(period, uptime_rows=uptime_rows)
    return SpaceWeatherReportResponse(**payload)


@router.get("/correlations", response_model=SpaceWeatherCorrelationResponse)
async def correlations(
    hours: float = 168.0,
    resample: str = "1h",
    _=Depends(require_api_key),
):
    from backend.space_weather_logger import get_db

    result = get_db().correlation_matrix(hours=hours, resample=resample)
    pairs = [CorrelationPair(**p) for p in result.get("pairs", [])]
    return SpaceWeatherCorrelationResponse(
        hours=result["hours"],
        resample=result["resample"],
        sample_count=result["sample_count"],
        from_time=result.get("from"),
        to_time=result.get("to"),
        matrix=result.get("matrix", {}),
        pairs=pairs,
    )


_EKF_PARAMS = ("kp", "dst", "f107", "solar_wind", "s4", "gnss_risk", "stations_online")


@router.get("/ekf", response_model=EkfStatusOut)
async def ekf_status(_=Depends(require_api_key)):
    """EKF-predicted overlay for every existing dashboard timeline, plus any
    newly triggered deviation alerts (also persisted to the event log)."""
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

    sw = _sw()
    tl = _build_timelines(sw)
    raw_series = {name: getattr(tl, name) for name in _EKF_PARAMS}

    ekf_series = {
        name: run_ekf_series([(p.t, p.v) for p in points], name)
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
                    EkfPointOut(t=p.t, observed=p.observed, predicted=p.predicted, error=p.error, confidence=p.confidence)
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


@router.get("/storm-alerts/status", response_model=StormAlertStatus)
async def storm_alert_status(_=Depends(require_api_key)):
    """Current geomagnetic storm / EKF alarm state and notification channel config."""
    import os

    from zgiis.db.ekf_alert_db import EkfAlertDB
    from zgiis.space_weather.storm_notifier import build_alarm_summary, channels_configured

    sw = _sw()
    kp = _float_or_none(sw.get("kp"))
    dst = _float_or_none(sw.get("dst"))
    recent = EkfAlertDB().list_alerts(hours=6)
    alarm = build_alarm_summary(kp=kp, dst=dst, alerts=recent)
    dry = os.getenv("STORM_ALERT_DRY_RUN", "true").strip().lower() in {"1", "true", "yes", "on"}
    return StormAlertStatus(
        active=bool(alarm.get("active")),
        active_count=int(alarm.get("active_count") or 0),
        banner=alarm.get("banner"),
        kp_storm_level=alarm.get("kp_storm_level"),
        ekf_alert_count=int(alarm.get("ekf_alert_count") or 0),
        notification_channels=channels_configured(),
        dry_run=dry,
    )


@router.get("/ekf/alerts", response_model=list[EkfAlertOut])
async def ekf_alert_log(hours: float = 24.0, _=Depends(require_api_key)):
    from zgiis.db.ekf_alert_db import EkfAlertDB
    rows = EkfAlertDB().list_alerts(hours=hours)
    return [EkfAlertOut(**r) for r in rows]


@router.post("/ekf/alerts/{alert_id}/ack", status_code=204)
async def ekf_alert_ack(alert_id: str, _=Depends(require_api_key)):
    from zgiis.db.ekf_alert_db import EkfAlertDB
    EkfAlertDB().acknowledge(alert_id)


def _float_or_none(value: object) -> float | None:
    try:
        return None if value is None or (isinstance(value, float) and value != value) else float(value)
    except (TypeError, ValueError):
        return None


def _int_or_none(value: object) -> int | None:
    try:
        return None if value is None else int(value)
    except (TypeError, ValueError):
        return None


def _str_or_none(value: object) -> str | None:
    return None if value is None else str(value)
