from __future__ import annotations

import datetime as dt

from fastapi import APIRouter, Depends

from backend.deps import require_api_key
from backend.schemas import (
    SolarActivityFull,
    SolarWindDetail,
    SpaceWeatherCurrent,
    SpaceWeatherTimelines,
    TimelinePoint,
)
from backend.timeline_cache import merge_timeline

router = APIRouter(prefix="/space-weather", tags=["space-weather"])


def _sw() -> dict:
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
    from zgiis.space_weather.fetch_indices import get_space_weather
    return get_space_weather()


@router.get("/current", response_model=SpaceWeatherCurrent)
async def current(_=Depends(require_api_key)):
    sw = _sw()
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


@router.get("/timelines", response_model=SpaceWeatherTimelines)
async def timelines(_=Depends(require_api_key)):
    from zgiis.space_weather.fetch_indices import _parse_kp_value
    sw = _sw()

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


@router.post("/refresh", status_code=204)
async def refresh(_=Depends(require_api_key)):
    from zgiis.space_weather.fetch_indices import clear_space_weather_cache
    clear_space_weather_cache()
