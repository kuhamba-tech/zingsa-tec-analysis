"""Navigation News API — copy-ready audience briefs for broadcast agents."""
from __future__ import annotations

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query

from backend.deps import is_broadcast_admin, require_api_key, require_broadcast_admin
from backend.schemas import (
    AiAudienceRecommendationOut,
    AiRecommendationsOut,
    BroadcastRecipientCreate,
    BroadcastRecipientOut,
    BroadcastRecipientUpdate,
    NavigationBroadcastOverviewOut,
    NavigationBroadcastRunOut,
    NavigationBroadcastStatusOut,
    NavigationFacebookPostOut,
    NavigationFacebookStatusOut,
    NavigationNewsAudienceRoleOut,
    NavigationNewsBriefOut,
    NavigationNewsBundleOut,
    NavigationNewsScheduleOut,
    NavigationDeliveryOptionsOut,
    DeliveryOptionOut,
)

router = APIRouter(prefix="/navigation-news", tags=["navigation-news"])

AudienceId = Literal["farmer", "surveyor", "citizen", "driver", "aviation", "scientist"]
VALID_AUDIENCES = frozenset({"farmer", "surveyor", "citizen", "driver", "aviation", "scientist"})


def _recipient_out(rec: dict, *, redact: bool = False) -> BroadcastRecipientOut:
    from zgiis.navigation.audience_roles import enrich_recipient

    data = enrich_recipient(rec)
    member_count = len([p for p in str(data.get("whatsapp_to") or "").split(",") if p.strip()]) or 1
    data = {**data, "member_count": member_count}
    if redact:
        data = {
            **data,
            "whatsapp_to": "private",
            "notes": None,
        }
    return BroadcastRecipientOut(**data)

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
    audience: str | None = Query(None, description="Optional filter: farmer, surveyor, citizen, driver, aviation"),
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
            detail=f"Invalid audience '{audience}'. Use: farmer, surveyor, citizen, driver, aviation",
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


@router.get("/recommendations", response_model=AiRecommendationsOut)
async def navigation_recommendations(
    refresh_ntrip: bool = Query(False),
    _=Depends(require_api_key),
):
    """Compact sector recommendations — the global 'So what?' panel for every page."""
    from zgiis.navigation.ai_recommendations import build_ai_recommendations
    from zgiis.navigation.gnss_forecast import build_gnss_forecast_bundle

    sw = _sw_dict()
    stations = _stations(refresh_ntrip=refresh_ntrip)
    bundle = build_gnss_forecast_bundle(sw, stations)
    payload = build_ai_recommendations(bundle.forecasts, sw, None, bundle.computedAt)
    return AiRecommendationsOut(
        recommendations=[AiAudienceRecommendationOut(**r) for r in payload["recommendations"]],
        tone=payload["tone"],
        computed_at=payload.get("computed_at"),
    )


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


@router.get("/audiences", response_model=list[NavigationNewsAudienceRoleOut])
async def navigation_news_audiences(_=Depends(require_api_key)):
    """Role classifications for tailored WhatsApp registration (matches GNSS Intelligence briefs)."""
    from zgiis.navigation.audience_roles import AUDIENCE_ROLES

    return [NavigationNewsAudienceRoleOut(**r) for r in AUDIENCE_ROLES]


@router.get("/delivery-options", response_model=NavigationDeliveryOptionsOut)
async def navigation_delivery_options(_=Depends(require_api_key)):
    """Languages and accessibility formats for Navigation News WhatsApp delivery."""
    from zgiis.navigation.delivery_preferences import delivery_options_payload

    payload = delivery_options_payload()
    return NavigationDeliveryOptionsOut(
        languages=[DeliveryOptionOut(**x) for x in payload["languages"]],
        accessibility=[DeliveryOptionOut(**x) for x in payload["accessibility"]],
    )


@router.get("/recipients", response_model=list[BroadcastRecipientOut])
async def list_broadcast_recipients(
    _=Depends(require_api_key),
    admin: bool = Depends(is_broadcast_admin),
):
    """Registered WhatsApp recipients (IDs redacted unless broadcast admin)."""
    from zgiis.db.broadcast_recipient_db import BroadcastRecipientDB

    return [_recipient_out(r, redact=not admin) for r in BroadcastRecipientDB().list_recipients()]


@router.get("/broadcast/recipients", response_model=list[BroadcastRecipientOut])
async def list_broadcast_recipients_alias(
    _=Depends(require_api_key),
    admin: bool = Depends(is_broadcast_admin),
):
    """Alias — same as GET /navigation-news/recipients."""
    from zgiis.db.broadcast_recipient_db import BroadcastRecipientDB

    return [_recipient_out(r, redact=not admin) for r in BroadcastRecipientDB().list_recipients()]


@router.get("/broadcast/overview", response_model=NavigationBroadcastOverviewOut)
async def broadcast_overview(
    _=Depends(require_api_key),
    admin: bool = Depends(is_broadcast_admin),
):
    """Recipients + scheduler status in one call for the GNSS Intelligence broadcast UI."""
    from backend import navigation_broadcast_scheduler
    from zgiis.db.broadcast_recipient_db import BroadcastRecipientDB

    st = navigation_broadcast_scheduler.status()
    if not admin:
        for delivery in st.get("recent_deliveries", []):
            delivery["whatsapp_to"] = "private"

    return NavigationBroadcastOverviewOut(
        recipients=[_recipient_out(r, redact=not admin) for r in BroadcastRecipientDB().list_recipients()],
        status=NavigationBroadcastStatusOut(**st),
    )


@router.post("/recipients", response_model=BroadcastRecipientOut, status_code=201)
async def create_broadcast_recipient(
    body: BroadcastRecipientCreate,
    _=Depends(require_api_key),
    __=Depends(require_broadcast_admin),
):
    from zgiis.db.broadcast_recipient_db import BroadcastRecipientDB

    try:
        return _recipient_out(BroadcastRecipientDB().create_recipient(**body.model_dump()))
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.patch("/recipients/{recipient_id}", response_model=BroadcastRecipientOut)
async def update_broadcast_recipient(
    recipient_id: str,
    body: BroadcastRecipientUpdate,
    _=Depends(require_api_key),
    __=Depends(require_broadcast_admin),
):
    from zgiis.db.broadcast_recipient_db import BroadcastRecipientDB

    try:
        updated = BroadcastRecipientDB().update_recipient(
            recipient_id,
            **body.model_dump(exclude_unset=True),
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if not updated:
        raise HTTPException(status_code=404, detail="Recipient not found")
    return _recipient_out(updated)


@router.delete("/recipients/{recipient_id}", status_code=204)
async def delete_broadcast_recipient(
    recipient_id: str,
    _=Depends(require_api_key),
    __=Depends(require_broadcast_admin),
):
    from zgiis.db.broadcast_recipient_db import BroadcastRecipientDB

    if not BroadcastRecipientDB().delete_recipient(recipient_id):
        raise HTTPException(status_code=404, detail="Recipient not found")


@router.get("/broadcast/status", response_model=NavigationBroadcastStatusOut)
async def navigation_broadcast_status(
    _=Depends(require_api_key),
    admin: bool = Depends(is_broadcast_admin),
):
    """Scheduler state, registered recipient count, and recent WhatsApp deliveries."""
    from backend import navigation_broadcast_scheduler

    payload = navigation_broadcast_scheduler.status()
    if not admin:
        for delivery in payload.get("recent_deliveries", []):
            delivery["whatsapp_to"] = "private"
    return NavigationBroadcastStatusOut(**payload)


@router.get("/facebook/status", response_model=NavigationFacebookStatusOut)
async def navigation_facebook_status(_=Depends(require_api_key)):
    """Facebook Page config for Navigation News (Stellar Aspirations page)."""
    from zgiis.navigation.facebook_status import facebook_status_payload

    return NavigationFacebookStatusOut(**facebook_status_payload())


@router.get("/broadcast/facebook/status", response_model=NavigationFacebookStatusOut)
async def navigation_facebook_status_alias(_=Depends(require_api_key)):
    """Alias for clients where /facebook/status may be blocked or unavailable."""
    from zgiis.navigation.facebook_status import facebook_status_payload

    return NavigationFacebookStatusOut(**facebook_status_payload())


@router.post("/facebook/test-post", response_model=NavigationFacebookPostOut)
async def navigation_facebook_test_post(
    live: bool = Query(False, description="When true and credentials are set, post to Facebook (not dry-run)"),
    language: str = Query("en", description="Post language: en, sn (ChiShona), or nd (isiNdebele)"),
    _=Depends(require_api_key),
):
    """Verify Navigation News can be posted to the Stellar Aspirations Facebook Page.

    Default is dry-run (logs only). Set `live=true` with FACEBOOK_PAGE_ACCESS_TOKEN
    configured to publish a real test post.
    """
    from zgiis.navigation.facebook_publish import publish_navigation_news_to_facebook

    result = publish_navigation_news_to_facebook(dry_run=not live, language=language)
    return NavigationFacebookPostOut(**result)


@router.post("/broadcast/facebook/test-post", response_model=NavigationFacebookPostOut)
async def navigation_facebook_test_post_alias(
    live: bool = Query(False),
    language: str = Query("en", description="Post language: en, sn (ChiShona), or nd (isiNdebele)"),
    _=Depends(require_api_key),
):
    """Alias for Facebook test post."""
    from zgiis.navigation.facebook_publish import publish_navigation_news_to_facebook

    result = publish_navigation_news_to_facebook(dry_run=not live, language=language)
    return NavigationFacebookPostOut(**result)


@router.post("/broadcast/recipients/sync")
async def sync_broadcast_recipients_file(
    _=Depends(require_api_key),
    __=Depends(require_broadcast_admin),
):
    """Load recipients from the private server-side JSON file into the registry."""
    from zgiis.navigation.broadcast_recipients_file import sync_recipients_from_file

    return sync_recipients_from_file()


@router.post("/broadcast/run", response_model=NavigationBroadcastRunOut)
async def navigation_broadcast_run(
    _=Depends(require_api_key),
    __=Depends(require_broadcast_admin),
):
    """Manually send Navigation News now to WhatsApp recipients and Facebook (admin only)."""
    from backend import navigation_broadcast_scheduler

    result = navigation_broadcast_scheduler.run_broadcast_now(force=True)
    return NavigationBroadcastRunOut(**result)


@router.post("/broadcast/whatsapp/send", response_model=NavigationBroadcastRunOut)
async def navigation_whatsapp_send(
    live: bool = Query(False, description="When true and credentials are set, send real WhatsApp messages"),
    _=Depends(require_api_key),
    admin: bool = Depends(is_broadcast_admin),
):
    """Send tailored Navigation News to registered WhatsApp recipients.

    Default is dry-run (logs only). Set `live=true` with Meta WhatsApp Cloud API
    credentials and active recipients to deliver real messages.
    """
    from backend import navigation_broadcast_scheduler
    from backend.deps import _broadcast_admin_expected
    from zgiis.navigation.broadcast_recipients_file import sync_recipients_from_file

    if live and _broadcast_admin_expected() and not admin:
        raise HTTPException(
            status_code=403,
            detail="Broadcast admin key required for live WhatsApp sends (X-Broadcast-Admin-Key)",
        )

    sync_recipients_from_file()
    result = navigation_broadcast_scheduler.run_broadcast_now(
        force=True,
        dry_run_override=not live,
        whatsapp_only=True,
    )
    return NavigationBroadcastRunOut(**result)
