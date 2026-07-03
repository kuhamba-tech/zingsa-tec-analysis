"""Navigation News API — copy-ready audience briefs for broadcast agents."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.deps import require_api_key
from backend.schemas import NavigationNewsBriefOut, NavigationNewsBundleOut, NavigationNewsScheduleOut

router = APIRouter(prefix="/navigation-news", tags=["navigation-news"])

AudienceId = Literal["farmer", "surveyor", "citizen", "driver"]
VALID_AUDIENCES = frozenset({"farmer", "surveyor", "citizen", "driver"})

# In-process cache mirror (per worker); persisted copy in news_cache.py
_mem_cache = None


def _sw_dict() -> dict | None:
    try:
        from zgiis.space_weather.fetch_indices import get_space_weather

        return get_space_weather(use_third_party=True)
    except Exception:
        return None


def _stations(*, refresh_ntrip: bool = False) -> list:
    from backend.routers.cors_network import _stations

    return _stations(refresh_ntrip=refresh_ntrip)


def _build_bundle_fresh(*, refresh_ntrip: bool = False) -> NavigationNewsBundleOut:
    from zgiis.navigation.audience_news import build_audience_news
    from zgiis.navigation.gnss_forecast import build_gnss_forecast_bundle

    sw = _sw_dict()
    stations = _stations(refresh_ntrip=refresh_ntrip)
    bundle = build_gnss_forecast_bundle(sw, stations)
    briefs = build_audience_news(bundle.forecasts, bundle.computedAt, sw)

    return NavigationNewsBundleOut(
        computed_at=bundle.computedAt,
        last_updated_at=bundle.computedAt,
        next_update_at=bundle.computedAt,
        update_interval_hours=4,
        update_history=[],
        input_summary=bundle.inputSummary,
        sources=bundle.sources,
        briefs=[
            NavigationNewsBriefOut(
                id=b.id,
                icon=b.icon,
                title=b.title,
                audience=b.audience,
                headline=b.headline,
                summary=b.summary,
                space_weather_today=b.space_weather_today,
                space_weather_bullets=b.space_weather_bullets,
                bullets=b.bullets,
                action=b.action,
                status_tone=b.status_tone,
                broadcast_script=b.broadcast_script,
                social_script=b.social_script,
                channels=b.channels,
            )
            for b in briefs
        ],
    )


def _bundle_from_cache_dict(data: dict) -> NavigationNewsBundleOut:
    return NavigationNewsBundleOut(
        computed_at=data["computed_at"],
        last_updated_at=data["last_updated_at"],
        next_update_at=data["next_update_at"],
        update_interval_hours=data.get("update_interval_hours", 4),
        update_history=data.get("update_history", []),
        input_summary=data["input_summary"],
        sources=data.get("sources", {}),
        briefs=[NavigationNewsBriefOut(**b) for b in data.get("briefs", [])],
    )


def get_navigation_news_bundle(*, refresh_ntrip: bool = False, force: bool = False) -> NavigationNewsBundleOut:
    """Return cached bundle (4 h TTL) or rebuild and record update time."""
    global _mem_cache

    from zgiis.navigation.news_cache import (
        cache_is_fresh,
        load_cache,
        record_refresh,
        record_to_bundle_dict,
    )

    record = _mem_cache if _mem_cache and cache_is_fresh(_mem_cache) else load_cache()
    if record and not force and cache_is_fresh(record):
        _mem_cache = record
        return _bundle_from_cache_dict(record_to_bundle_dict(record))

    fresh = _build_bundle_fresh(refresh_ntrip=refresh_ntrip)
    stored = record_refresh(fresh.model_dump())
    _mem_cache = stored
    return _bundle_from_cache_dict(record_to_bundle_dict(stored))


@router.get("/schedule", response_model=NavigationNewsScheduleOut)
async def navigation_news_schedule(_=Depends(require_api_key)):
    """When Navigation News was last refreshed and when the next 4-hour update is due."""
    from zgiis.navigation.news_cache import load_cache

    record = load_cache()
    if not record:
        bundle = get_navigation_news_bundle()
        return NavigationNewsScheduleOut(
            last_updated_at=bundle.last_updated_at,
            next_update_at=bundle.next_update_at,
            update_interval_hours=bundle.update_interval_hours,
            update_history=bundle.update_history,
            updates_per_day=24 // bundle.update_interval_hours,
        )
    return NavigationNewsScheduleOut(
        last_updated_at=record.last_updated_at,
        next_update_at=record.next_update_at,
        update_interval_hours=record.update_interval_hours,
        update_history=record.update_history,
        updates_per_day=24 // record.update_interval_hours,
    )


@router.get("", response_model=NavigationNewsBundleOut)
async def navigation_news(
    audience: str | None = Query(None, description="Optional filter: farmer, surveyor, citizen, driver"),
    refresh_ntrip: bool = Query(False),
    force: bool = Query(False, description="Bypass 4-hour cache and rebuild now"),
    _=Depends(require_api_key),
):
    """
    Navigation News for broadcast agents — refreshed every 4 hours.

    Returns copy-ready `broadcast_script` and `social_script` for each audience.
    `last_updated_at` and `next_update_at` record the publish schedule.
    """
    if audience is not None and audience not in VALID_AUDIENCES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid audience '{audience}'. Use: farmer, surveyor, citizen, driver",
        )
    bundle = get_navigation_news_bundle(refresh_ntrip=refresh_ntrip, force=force)
    if audience:
        filtered = [b for b in bundle.briefs if b.id == audience]
        return NavigationNewsBundleOut(
            computed_at=bundle.computed_at,
            last_updated_at=bundle.last_updated_at,
            next_update_at=bundle.next_update_at,
            update_interval_hours=bundle.update_interval_hours,
            update_history=bundle.update_history,
            input_summary=bundle.input_summary,
            sources=bundle.sources,
            briefs=filtered,
        )
    return bundle


@router.get("/briefs/{audience}", response_model=NavigationNewsBriefOut)
async def navigation_news_brief(
    audience: AudienceId,
    refresh_ntrip: bool = Query(False),
    force: bool = Query(False),
    _=Depends(require_api_key),
):
    """Single audience brief — ideal for AI agents posting to WhatsApp or social media."""
    bundle = get_navigation_news_bundle(refresh_ntrip=refresh_ntrip, force=force)
    match = next((b for b in bundle.briefs if b.id == audience), None)
    if not match:
        raise HTTPException(status_code=404, detail=f"No brief for audience '{audience}'")
    return match
