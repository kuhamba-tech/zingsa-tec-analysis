from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from backend.deps import require_api_key
from backend.schemas import ChatRequest, ChatResponse

router = APIRouter(prefix="/chat", tags=["chat"])


@router.post("", response_model=ChatResponse)
async def chat(body: ChatRequest, _=Depends(require_api_key)):
    try:
        from zgiis.ai.assistant import chat as ai_chat
        from zgiis.space_weather.fetch_indices import get_space_weather
        sw = get_space_weather(use_third_party=False)
        messages = [{"role": m.role, "content": m.content} for m in body.messages]
        reply = ai_chat(messages=messages, tec_summary=None, sw=sw, api_key=body.api_key)
        return ChatResponse(reply=reply, context_injected=True)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
