"""Navigation News API — copy-ready audience briefs for broadcast agents."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.deps import require_api_key
from backend.schemas import NavigationNewsBriefOut, NavigationNewsBundleOut

router = APIRouter(prefix="/navigation-news", tags=["navigation-news"])

AudienceId = Literal["farmer", "surveyor", "citizen", "driver"]
VALID_AUDIENCES = frozenset({"farmer", "surveyor", "citizen", "driver"})


def _sw_dict() -> dict | None:
    try:
        from zgiis.space_weather.fetch_indices import get_space_weather

        return get_space_weather(use_third_party=True)
    except Exception:
        return None


def _stations(*, refresh_ntrip: bool = False) -> list:
    from backend.routers.cors_network import _stations

    return _stations(refresh_ntrip=refresh_ntrip)


def _build_bundle(*, refresh_ntrip: bool = False) -> NavigationNewsBundleOut:
    from zgiis.navigation.audience_news import build_audience_news
    from zgiis.navigation.gnss_forecast import build_gnss_forecast_bundle

    sw = _sw_dict()
    stations = _stations(refresh_ntrip=refresh_ntrip)
    bundle = build_gnss_forecast_bundle(sw, stations)
    briefs = build_audience_news(bundle.forecasts, bundle.computedAt, sw)

    return NavigationNewsBundleOut(
        computed_at=bundle.computedAt,
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


@router.get("", response_model=NavigationNewsBundleOut)
async def navigation_news(
    audience: str | None = Query(None, description="Optional filter: farmer, surveyor, citizen, driver"),
    refresh_ntrip: bool = Query(False),
    _=Depends(require_api_key),
):
    """
    Live Navigation News for broadcast agents.

    Returns copy-ready `broadcast_script` and `social_script` for each audience.
    Use `?audience=farmer` on GET /navigation-news/briefs/{audience} for a single brief.
    """
    if audience is not None and audience not in VALID_AUDIENCES:
        raise HTTPException(
            status_code=422,
            detail=f"Invalid audience '{audience}'. Use: farmer, surveyor, citizen, driver",
        )
    bundle = _build_bundle(refresh_ntrip=refresh_ntrip)
    if audience:
        filtered = [b for b in bundle.briefs if b.id == audience]
        return NavigationNewsBundleOut(
            computed_at=bundle.computed_at,
            input_summary=bundle.input_summary,
            sources=bundle.sources,
            briefs=filtered,
        )
    return bundle


@router.get("/briefs/{audience}", response_model=NavigationNewsBriefOut)
async def navigation_news_brief(
    audience: AudienceId,
    refresh_ntrip: bool = Query(False),
    _=Depends(require_api_key),
):
    """Single audience brief — ideal for AI agents posting to WhatsApp or social media."""
    bundle = _build_bundle(refresh_ntrip=refresh_ntrip)
    match = next((b for b in bundle.briefs if b.id == audience), None)
    if not match:
        raise HTTPException(status_code=404, detail=f"No brief for audience '{audience}'")
    return match
