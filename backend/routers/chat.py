from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.deps import require_api_key
from backend.schemas import ChatContextSummary, ChatRequest, ChatResponse

router = APIRouter(prefix="/chat", tags=["chat"])


def _db():
    try:
        from backend.live_manager import get_db

        return get_db()
    except Exception:
        return None


def _live_pipeline_summary() -> dict | None:
    try:
        from backend.live_manager import status as live_status

        s = live_status()
        if not s.get("configured") and not s.get("ingest_enabled"):
            return None
        return {
            "configured": bool(s.get("configured")),
            "ingest_enabled": bool(s.get("ingest_enabled")),
            "active_streams": int(s.get("active_streams") or 0),
            "db_backend": s.get("db_backend"),
            "message": s.get("message"),
        }
    except Exception:
        return None


@router.post("", response_model=ChatResponse)
async def chat(body: ChatRequest, _=Depends(require_api_key)):
    try:
        from zgiis.ai.assistant import chat as ai_chat
        from zgiis.ai.context import (
            build_context_block,
            fetch_ekf_summary,
            fetch_tec_summary,
        )
        from zgiis.space_weather.fetch_indices import get_space_weather

        sw = get_space_weather(use_third_party=False)
        db = _db()
        tec_summary = fetch_tec_summary(db, station=body.station, hours=2.0)
        ekf_summary = fetch_ekf_summary(hours=6.0)
        live_summary = _live_pipeline_summary()

        _, context_lines, structured = build_context_block(
            tec_summary, sw, ekf_summary, live_summary
        )

        messages = [{"role": m.role, "content": m.content} for m in body.messages]
        reply = ai_chat(
            messages=messages,
            tec_summary=tec_summary,
            sw=sw,
            ekf_summary=ekf_summary,
            live_summary=live_summary,
            api_key=body.api_key,
        )

        return ChatResponse(
            reply=reply,
            context_injected=bool(context_lines),
            context=ChatContextSummary(lines=context_lines, **structured),
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
