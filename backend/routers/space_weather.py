from __future__ import annotations

import logging
import threading
import os
import time
from concurrent.futures import Future, ThreadPoolExecutor, TimeoutError as FuturesTimeout

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.deps import require_api_key
from backend.schemas import (
    CorrelationPair,
    EkfAlertOut,
    EkfPointOut,
    EkfSeriesOut,
    EkfStatusOut,
    HeliosphericMonitorResponse,
    StormAlertStatus,
    SolarActivityFull,
    SolarCycleIndicesResponse,
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
from backend.timeline_builder import build_timelines, limit_timelines

router = APIRouter(prefix="/space-weather", tags=["space-weather"])
log = logging.getLogger(__name__)


@router.get('/geomagnetic-indices')
def geomagnetic_indices(hours: int = 24, start: str | None = None, end: str | None = None, _=Depends(require_api_key)):
    from zgiis.space_weather.kyoto_asysym import fetch
    try:
        return fetch(hours,start,end)
    except ValueError as exc:
        raise HTTPException(400,str(exc)) from exc
    except Exception as exc:
        raise HTTPException(503,'Kyoto observations unavailable; no substitute data were generated') from exc


@router.get('/geomagnetic-vtec')
def geomagnetic_vtec(start: str, end: str, region: str = 'all', station: str = '', _=Depends(require_api_key)):
    from zgiis.space_weather.kyoto_asysym import utc, iso
    from zgiis.processing.tec_climatology import read_bins
    from zgiis.processing.north_south_tec_research import zimbabwe_lat_band
    from zgiis.cors.stations import ZIMBABWE_CORS_STATIONS
    from backend.routers.live import _db
    from datetime import timedelta, datetime, timezone
    try:
        left,right=utc(start),utc(end)
        if right<=left or right-left>timedelta(days=7):
            raise ValueError('Choose up to seven days per request')
        if region not in ('all','northern','central','southern'):
            raise ValueError('Unknown region')
        catalog=[{'code':s.code.lower().rstrip('_'),'region':zimbabwe_lat_band(s.lat)} for s in ZIMBABWE_CORS_STATIONS]
        allowed=[s['code'] for s in catalog if (region=='all' or region==s['region']) and (not station or s['code']==station)]
        frame=read_bins(_db(),left,min(right,datetime.now(timezone.utc)),1)
        frame=frame[frame.station.isin(allowed)]
        points=[{'time':iso(datetime.fromtimestamp(float(bucket),timezone.utc)), 'vtec':float(g.vtec.mean()), 'stations':int(g.station.nunique()), 'observations':int(g.observations.sum())} for bucket,g in frame.groupby('bucket')]
        return {'points':points,'catalog':catalog}
    except ValueError as exc:
        raise HTTPException(400,str(exc)) from exc

# These handlers use synchronous database/network libraries. Keep them as
# normal def functions so FastAPI runs them off the ASGI event loop.

# Reuse one database read across simultaneous dashboard requests. A per-request
# executor context waits for its query even after Future.result has timed out.
_mean_vtec_pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dashboard-vtec")
_mean_vtec_lock = threading.Lock()
_mean_vtec_future: Future | None = None


def _read_mean_vtec() -> tuple[float, float | None]:
    # Keep the new upstream station/snapshot fallbacks inside the bounded
    # worker, so an unavailable database cannot delay the metric cards.
    try:
        from backend.routers.cors_network import _safe_station_live_vtec

        vals = [
            float(v) for v in _safe_station_live_vtec(0.25, allow_db=True).values()
            if v is not None and float(v) > 1.0
        ]
        if vals:
            return time.monotonic(), round(sum(vals) / len(vals), 2)
    except Exception:
        pass
    try:
        from backend.space_weather_logger import get_db as get_sw_db

        latest = get_sw_db().latest_snapshot()
        raw = latest.get("mean_vtec") if latest is not None and hasattr(latest, "get") else None
        if raw is not None and float(raw) > 1.0:
            return time.monotonic(), round(float(raw), 2)
    except Exception:
        pass
    value = None
    db = None
    try:
        from zgiis.db.timescale import TecDB

        db = TecDB()
        series = db.mean_vtec_timeseries(hours=2.0, resample="15min")
        if series is not None and not series.empty:
            value = float(series.iloc[-1])
    except Exception:
        pass
    finally:
        if db is not None:
            try:
                db.close()
            except Exception:
                pass
    return time.monotonic(), value


def _bounded_mean_vtec() -> float | None:
    global _mean_vtec_future
    with _mean_vtec_lock:
        pending = _mean_vtec_future
        if pending is None or (pending.done() and time.monotonic() - pending.result()[0] >= 30):
            pending = _mean_vtec_pool.submit(_read_mean_vtec)
            _mean_vtec_future = pending
    try:
        return pending.result(timeout=0.35)[1]
    except FuturesTimeout:
        return None


def _sw() -> dict:
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from zgiis.space_weather.fetch_indices import get_space_weather

    # Page-load reads must stay quick. The CORS_Program enrichment endpoints can
    # time out independently, so use direct NOAA/local sources here and let the
    # dedicated station endpoints handle CORS/NTRIP status.
    try:
        sw = get_space_weather(use_third_party=False, fetch_ionosphere=False)
    except Exception:
        log.exception("get_space_weather failed")
        sw = None
    if not isinstance(sw, dict):
        sw = {
            "mode": "unavailable",
            "kp": None,
            "dst": None,
            "f107": None,
            "gnss_risk": "Unknown",
            "gnss_risk_color": "#94a3b8",
            "stations_online": None,
            "stations_total": 19,
            "updated_utc": None,
        }
    s4, delta_tec, ionosphere_status, ionosphere_note = _cached_s4()
    if s4 is not None:
        sw["s4"] = round(s4, 2)
        sw["ionosphere_data_status"] = ionosphere_status
        sw["ionosphere_data_note"] = ionosphere_note
    return sw


def _cached_s4() -> tuple[float | None, float, str, str]:
    """Non-blocking cached S4 (observed-archive only) — never calls the
    CORS_Program ionosphere endpoint synchronously on a page load."""
    try:
        from zgiis.space_weather.fetch_indices import derive_s4_from_iono
        from zgiis.space_weather.ionosphere_status_cache import get_cached_ionosphere_status

        iono = get_cached_ionosphere_status(station="HARA")
        return derive_s4_from_iono(iono)
    except Exception:
        return None, 0.0, "unavailable", "No observed ionosphere record available."


def _archived_online_total() -> tuple[int, int] | None:
    """Supabase collector snapshots — honest when Spider SBC is blocked."""
    try:
        from backend.routers.cors_network import _archived_status_counts

        archived = _archived_status_counts()
        if archived is not None:
            online, _, _offline, total = archived
            return int(online), int(total)
    except Exception:
        pass
    try:
        from backend.station_status_logger import get_db as get_status_db
        from zgiis.cors.stations import is_surveyor_general, zingsa_cors_stations

        latest = get_status_db().latest_snapshots(hours=1.0)
        if latest:
            online = sum(
                1
                for code, row in latest.items()
                if not is_surveyor_general(str(code)) and row.get("status") == "online"
            )
            return online, len(zingsa_cors_stations())
    except Exception:
        pass
    return None


def _ntrip_stream_counts() -> tuple[int | None, int | None]:
    """Station counts for the CORS Connected card (never block on SBC login).

    Prefer live Spider when it reports any online sites. A cached Spider map of
    all-offline (common after Cloudflare 403 from cloud IPs) must not paint
    0/25 over a healthier NTRIP archive snapshot.
    """
    # Serverless instances must use the same fresh collector snapshot as the
    # station map. An idle pipeline or old aggregate is not station evidence.
    serverless = any(os.getenv(key) for key in ("VERCEL", "VERCEL_ENV", "VERCEL_URL", "AWS_LAMBDA_FUNCTION_NAME"))
    if serverless:
        from zgiis.live.spider_site_status import get_cached_spider_site_statuses
        from zgiis.cors.stations import zingsa_cors_stations
        payload = get_cached_spider_site_statuses(refresh=False)
        rows = payload.get("by_station") or {}
        codes = {s.code.lower().rstrip("_") for s in zingsa_cors_stations()}
        if payload.get("error") or not all(rows.get(code, {}).get("status") in {"online", "offline"} for code in codes):
            return None, None
        return sum(rows[code]["status"] == "online" for code in codes), len(codes)
    spider_counts: tuple[int, int] | None = None
    try:
        from zgiis.live.spider_site_status import get_cached_spider_site_statuses, spider_status_enabled

        if spider_status_enabled():
            # Stale-while-revalidate only — /current must not wait on Spider login.
            payload = get_cached_spider_site_statuses(refresh=False)
            by_station = payload.get("by_station") or {}
            if by_station:
                from zgiis.cors.stations import zingsa_cors_stations
                zingsa = {s.code.lower().rstrip("_") for s in zingsa_cors_stations()}
                online = sum(
                    1
                    for code, row in by_station.items()
                    if str(code).lower().rstrip("_") in zingsa and row.get("status") == "online"
                )
                spider_counts = (online, len(zingsa))
                if not payload.get("error"):
                    return spider_counts
    except Exception:
        pass

    archived = _archived_online_total()

    # Local page loads must never wait on a hosted database connection. The
    # collector cache is process-local and explicitly non-blocking.
    if not os.getenv("VERCEL"):
        try:
            from zgiis.live.ntrip_status_cache import get_cached_ntrip_probe

            probe = get_cached_ntrip_probe(refresh=False, listen_sec=4.0, allow_blocking_refresh=False)
            if not probe.get("error"):
                rows = probe.get("stations") or []
                if rows:
                    online = sum(
                        1 for row in rows if str(row.get("verdict") or "").lower() == "msm_streaming"
                    )
                    probe_total = len(rows) or 24
                    if archived is not None:
                        archived_online, archived_total = archived
                        # A stale/partial direct probe (e.g. 1/2) must not overwrite a healthy
                        # collector archive (e.g. 14/25). Prefer the archived count while the probe
                        # is clearly incomplete or far smaller than the network footprint.
                        if probe_total < max(4, int(archived_total * 0.6)) and archived_online > 0:
                            return archived_online, archived_total
                    if online > 0 or spider_counts is None:
                        return online, probe_total
        except Exception:
            pass

    if archived is not None:
        online, total = archived
        # Archive wins over a Spider all-offline cache.
        if online > 0 or spider_counts is None:
            return online, total

    if spider_counts is not None:
        return spider_counts

    try:
        from zgiis.live.ntrip_status_cache import get_cached_ntrip_probe

        probe = get_cached_ntrip_probe(refresh=False, listen_sec=4.0, allow_blocking_refresh=False)
        if probe.get("error"):
            return None, None
        rows = probe.get("stations") or []
        if not rows:
            return None, None
        online = sum(
            1 for row in rows if str(row.get("verdict") or "").lower() == "msm_streaming"
        )
        return online, len(rows) or 24
    except Exception:
        return None, None


def _logged_mean_vtec() -> float | None:
    """Read the last non-null mean_vtec from Supabase Postgres."""
    try:
        import math

        from zgiis.db.config import database_dsn, get_conn, transaction

        dsn = database_dsn()
        if not dsn:
            return None
        # Hard cap so a slow query cannot stall /space-weather/current.
        # The shared pool already paid for the socket. SET LOCAL only applies
        # inside a transaction, and that transaction is closed before return.
        with get_conn(dsn) as conn:
            with transaction(conn):
                cur = conn.cursor()
                cur.execute("SET LOCAL statement_timeout = '1200ms'")
                cur.execute(
                    """
                    SELECT mean_vtec
                    FROM space_weather_log
                    WHERE mean_vtec IS NOT NULL AND mean_vtec > 1
                    ORDER BY time DESC
                    LIMIT 1
                    """
                )
                row = cur.fetchone()
        if not row or row[0] is None:
            return None
        value = float(row[0])
        if math.isnan(value) or value <= 1.0:
            return None
        return round(value, 2)
    except Exception:
        return None


_CURRENT_CACHE_TTL_S = 2.0
_CURRENT_CACHE: dict[str, object] = {"ts": 0.0, "payload": None}
_CURRENT_CACHE_LOCK = threading.Lock()

_TIMELINES_CACHE_TTL_S = 8.0
_TIMELINES_CACHE: dict[str, object] = {}
_TIMELINES_CACHE_LOCK = threading.Lock()


def _build_current_payload() -> SpaceWeatherCurrent:
    """Dashboard snapshot — keep this path free of Spider login stalls."""
    sw = dict(_sw())
    try:
        ntrip_online, ntrip_total = _ntrip_stream_counts()
        if ntrip_online is not None and ntrip_total:
            sw["stations_online"] = ntrip_online
            sw["stations_total"] = ntrip_total
        else:
            sw["stations_online"] = None
    except Exception:
        sw["stations_online"] = None
        log.exception("station count overlay failed on /space-weather/current")
    # Prefer in-memory collector samples; fall back to recent station VTEC so the
    # Zimbabwe Ionosphere card is not stuck on Unavailable when Spider is down.
    if sw.get("mean_vtec") is None and sw.get("vtec_tecu") is None:
        try:
            from backend.live_manager import latest_vtec_by_station

            vals = [
                float(v)
                for v in latest_vtec_by_station().values()
                if v is not None and float(v) > 1.0
            ]
            if vals:
                sw["mean_vtec"] = round(sum(vals) / len(vals), 2)
        except Exception:
            pass
    if sw.get("mean_vtec") is None and sw.get("vtec_tecu") is None:
        try:
            from backend.live_manager import get_db

            fast = get_db().network_mean_vtec(minutes=5)
            if fast is not None and float(fast) > 1.0:
                sw["mean_vtec"] = round(float(fast), 2)
        except Exception:
            pass
    if sw.get("mean_vtec") is None and sw.get("vtec_tecu") is None:
        try:
            from backend.routers.cors_network import _safe_station_live_vtec

            # The API process does not hold the NTRIP pipeline, so the card
            # must read the same code-live station samples as the TEC map.
            # A logged snapshot is only the fallback below: it was freezing
            # the card on one old number.
            vals = [
                float(v)
                for v in _safe_station_live_vtec(0.25, allow_db=True).values()
                if v is not None and float(v) > 1.0
            ]
            if vals:
                sw["mean_vtec"] = round(sum(vals) / len(vals), 2)
        except Exception:
            pass
    # Vercel serverless has no in-process NTRIP decode — use last logged snapshot.
    # Prefer a row that actually has VTEC so empty "dashboard" polls do not hide
    # a healthier logged / scheduler snapshot.
    if sw.get("mean_vtec") is None and sw.get("vtec_tecu") is None:
        # Prefer the logged Supabase snapshot.
        try:
            from backend.space_weather_logger import get_db as get_sw_db

            db = get_sw_db()
            latest = None
            if hasattr(db, "latest_snapshot_with_vtec"):
                latest = db.latest_snapshot_with_vtec()
            if latest is None:
                latest = db.latest_snapshot()
            if latest is not None:
                raw = latest.get("mean_vtec") if isinstance(latest, dict) else None
                if raw is None and hasattr(latest, "get"):
                    raw = latest.get("mean_vtec")
                if raw is not None and float(raw) > 1.0:
                    sw["mean_vtec"] = round(float(raw), 2)
        except Exception:
            pass
    if sw.get("mean_vtec") is None and sw.get("vtec_tecu") is None:
        logged_vtec = _logged_mean_vtec()
        if logged_vtec is not None:
            sw["mean_vtec"] = logged_vtec
    # A saved snapshot already filled mean_vtec above. The card on this page
    # must show the stations streaming now, not that older number.
    try:
        from zgiis.cors.stations import is_surveyor_general
        from zgiis.db.timescale import TecDB

        live_db = TecDB()
        try:
            by_station = live_db.live_station_mean_vtec(seconds=15 * 60)
        finally:
            live_db.close()
        vals = [
            float(value)
            for code, value in by_station.items()
            if not is_surveyor_general(code) and value is not None and float(value) > 1.0
        ]
        if vals:
            sw["mean_vtec"] = round(sum(vals) / len(vals), 2)
            sw["vtec_tecu"] = sw["mean_vtec"]
    except Exception:
        log.exception("live station TEC mean failed")
    threading.Thread(
        target=log_snapshot,
        kwargs={"source": "dashboard", "force": False, "snapshot": sw},
        daemon=True,
        name="sw-log-snapshot",
    ).start()
    mean_vtec = sw.get("mean_vtec")
    if mean_vtec is None:
        mean_vtec = sw.get("vtec_tecu")
    return SpaceWeatherCurrent(
        kp=sw.get("kp"),
        kp_condition=sw.get("kp_condition"),
        kp_color=sw.get("kp_color"),
        dst=sw.get("dst"),
        f107=sw.get("f107"),
        s4=sw.get("s4"),
        ap=sw.get("ap"),
        gnss_risk=sw.get("gnss_risk"),
        gnss_risk_color=sw.get("gnss_risk_color"),
        stations_online=sw.get("stations_online"),
        stations_total=sw.get("stations_total"),
        plasma_speed=sw.get("solar_wind_speed") or sw.get("plasma_speed"),
        mean_vtec=mean_vtec,
        updated_utc=sw.get("updated_utc") or sw.get("timestamp"),
    )


@router.get("/current", response_model=SpaceWeatherCurrent)
def current(_=Depends(require_api_key)):
    """Dashboard snapshot with a short coalescing cache for SSR + client bursts."""
    import time

    now = time.monotonic()
    with _CURRENT_CACHE_LOCK:
        cached = _CURRENT_CACHE.get("payload")
        ts = float(_CURRENT_CACHE.get("ts") or 0.0)
        if cached is not None and (now - ts) < _CURRENT_CACHE_TTL_S:
            return cached  # type: ignore[return-value]

    payload = _build_current_payload()
    with _CURRENT_CACHE_LOCK:
        _CURRENT_CACHE["payload"] = payload
        _CURRENT_CACHE["ts"] = time.monotonic()
    return payload


@router.get("/solar-activity", response_model=SolarActivityFull)
def solar_activity(
    force_refresh: bool = Query(False),
    _=Depends(require_api_key),
):
    """Fetch NOAA/NASA feeds in FastAPI's worker pool.

    The implementation uses the synchronous ``requests`` client.  Keeping
    this as ``async def`` ran those network waits on the ASGI event loop and
    could freeze every dashboard API request during a DONKI retry.
    """
    try:
        from zgiis.space_weather.solar_activity import (
            get_solar_activity,
            build_donki_cme_rows,
            build_donki_active_regions,
            build_donki_radio_bursts,
        )
    except ImportError as exc:
        return SolarActivityFull(mode="unavailable", error=f"module not found: {exc}")

    sa = get_solar_activity(force_refresh=force_refresh)

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
        flare_class=sa.get("flareClass") or "Unavailable",
        flux=sa.get("flux"),
        xray_series=[float(v) for v in (sa.get("xraySeries") or []) if v is not None],
        solar_wind=SolarWindDetail(
            speed=sw_data.get("speed"),
            density=sw_data.get("density"),
            temperature=sw_data.get("temperature"),
            bt=sw_data.get("bt"),
            bz=sw_data.get("bz"),
            dynamic_pressure=sw_data.get("dynamic_pressure"),
            southward_duration_minutes=sw_data.get("southward_duration_minutes"),
        ),
        alerts=sa.get("alerts") or [],
        donki_flares=flares,
        donki_cmes=cmes,
        donki_storms=storms,
        donki_date_start=date_range.get("start"),
        donki_date_end=date_range.get("end"),
        donki_status=sa.get("donki_status") or "unavailable",
        donki_note=sa.get("donki_note") or "",
        event_feed_source=sa.get("event_feed_source") or "unavailable",
        activity_label=level.get("label") or "Low",
        activity_color=level.get("color") or "#22c55e",
        activity_gnss=level.get("gnss") or "Minimal impact",
        api_routes=sa.get("api_routes") or [],
        feed_status=sa.get("feed_status") or {},
        error=sa.get("error"),
        active_regions=build_donki_active_regions(flares),
        cme_rows=build_donki_cme_rows(cmes),
        radio_burst_rows=build_donki_radio_bursts(flares),
    )


@router.get("/timelines", response_model=SpaceWeatherTimelines)
def timelines(
    max_points: int = Query(168, ge=24, le=2000),
    _=Depends(require_api_key),
):
    # Sync route so NOAA/SQLite work runs in the threadpool and does not
    # starve other handlers (heliospheric-monitor was timing out behind this).
    import time

    key = int(max_points)
    now = time.monotonic()
    with _TIMELINES_CACHE_LOCK:
        entry = _TIMELINES_CACHE.get(key)
        if entry and (now - float(entry["ts"])) < _TIMELINES_CACHE_TTL_S:
            return entry["payload"]  # type: ignore[index]

    payload = limit_timelines(build_timelines(_sw()), max_points=max_points)
    with _TIMELINES_CACHE_LOCK:
        _TIMELINES_CACHE[key] = {"ts": time.monotonic(), "payload": payload}
        # Bound memory if clients request many max_points variants.
        if len(_TIMELINES_CACHE) > 12:
            oldest = min(_TIMELINES_CACHE.items(), key=lambda item: float(item[1]["ts"]))[0]
            _TIMELINES_CACHE.pop(oldest, None)
    return payload


@router.post("/refresh", status_code=204)
def refresh(_=Depends(require_api_key)):
    from zgiis.space_weather.ekf_service import compute_ekf_status
    from zgiis.space_weather.fetch_indices import clear_space_weather_cache

    clear_space_weather_cache()
    with _CURRENT_CACHE_LOCK:
        _CURRENT_CACHE["payload"] = None
        _CURRENT_CACHE["ts"] = 0.0
    with _TIMELINES_CACHE_LOCK:
        _TIMELINES_CACHE.clear()
    log_snapshot(source="refresh", force=True)
    sw = _sw()
    compute_ekf_status(sw, dispatch_notifications=True)


@router.get("/log/status", response_model=SpaceWeatherLogStatus)
def logging_status(_=Depends(require_api_key)):
    s = log_status()
    return SpaceWeatherLogStatus(**s)


@router.get("/history", response_model=SpaceWeatherHistoryResponse)
def history(
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
def space_weather_report(
    period: str = "hourly",
    _=Depends(require_api_key),
):
    from zgiis.space_weather.report_builder import REPORT_WINDOWS, build_space_weather_report

    if period not in REPORT_WINDOWS:
        raise HTTPException(status_code=422, detail=f"Invalid period. Choose from: {', '.join(REPORT_WINDOWS)}")

    hours = REPORT_WINDOWS[period]["hours"]
    uptime_rows: list[dict] = []
    try:
        from backend.station_status_logger import get_db as get_status_db
        uptime_rows = get_status_db().uptime_summary(hours=hours)
    except Exception:
        pass

    payload = build_space_weather_report(period, uptime_rows=uptime_rows)
    return SpaceWeatherReportResponse(**payload)


@router.get("/correlations", response_model=SpaceWeatherCorrelationResponse)
def correlations(
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


@router.get("/ekf", response_model=EkfStatusOut)
def ekf_status(
    max_points: int = Query(336, ge=24, le=2000),
    _=Depends(require_api_key),
):
    """EKF overlay for dashboard timelines. Alerts are persisted; notifications
    are dispatched only on manual refresh or the background logger — not on read.

    Sync route: compute_ekf_status rebuilds timelines and must not block the
    ASGI event loop (that queued heliospheric-monitor behind a 45s client abort).
    """
    from zgiis.space_weather.ekf_service import compute_ekf_status

    return compute_ekf_status(
        _sw(),
        dispatch_notifications=False,
        max_points=max_points,
    )


@router.get("/storm-alerts/status", response_model=StormAlertStatus)
def storm_alert_status(_=Depends(require_api_key)):
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
        geomagnetic_level=str(alarm.get("geomagnetic_level") or "none"),
        geomagnetic_reasons=list(alarm.get("geomagnetic_reasons") or []),
        alert_rules=list(alarm.get("alert_rules") or []),
        ekf_alert_count=int(alarm.get("ekf_alert_count") or 0),
        notification_channels=channels_configured(),
        dry_run=dry,
    )


@router.get("/ekf/alerts", response_model=list[EkfAlertOut])
def ekf_alert_log(hours: float = 24.0, _=Depends(require_api_key)):
    from zgiis.db.ekf_alert_db import EkfAlertDB
    rows = EkfAlertDB().list_alerts(hours=hours)
    return [EkfAlertOut(**r) for r in rows]


@router.get("/solar-cycle-indices", response_model=SolarCycleIndicesResponse)
def solar_cycle_indices(
    start_year: int = Query(1965, ge=1749, le=2100),
    force_refresh: bool = Query(False),
    _=Depends(require_api_key),
):
    """Monthly mean F10.7 and SSN for multi-cycle solar activity charts.

    NOAA SWPC supplies monthly SSN and post-2004 F10.7. Earlier F10.7 months are
    filled from LISIRD daily radio-flux observations aggregated to month means.
    """
    from zgiis.space_weather.solar_cycle_indices import build_solar_cycle_indices

    try:
        payload = build_solar_cycle_indices(
            start_year=start_year,
            force_refresh=force_refresh,
        )
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Solar-cycle indices fetch failed: {exc}") from exc
    return SolarCycleIndicesResponse(**payload)


@router.get("/heliospheric-monitor", response_model=HeliosphericMonitorResponse)
def heliospheric_monitor(
    force_refresh: bool = Query(False),
    _=Depends(require_api_key),
):
    """KNMI-style stacked heliospheric panels from live NOAA SWPC feeds."""
    from zgiis.space_weather.heliospheric_monitor import build_heliospheric_monitor

    try:
        payload = build_heliospheric_monitor(force_refresh=force_refresh)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Heliospheric monitor fetch failed: {exc}") from exc
    return HeliosphericMonitorResponse(**payload)


@router.post("/ekf/alerts/{alert_id}/ack", status_code=204)
def ekf_alert_ack(alert_id: str, _=Depends(require_api_key)):
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
