"""Scientific literature RAG admin + assistant API (Google Drive backed)."""
from __future__ import annotations

import os

from fastapi import APIRouter, Depends, HTTPException, Query, Security
from fastapi.security.api_key import APIKeyHeader
from pydantic import BaseModel, Field

from backend.deps import require_api_key

router = APIRouter(prefix="/scientific-rag", tags=["scientific-rag"])

_admin_header = APIKeyHeader(name="X-Scientific-Rag-Admin-Key", auto_error=False)


def _admin_expected() -> str:
    return (
        os.getenv("SCIENTIFIC_RAG_ADMIN_KEY")
        or os.getenv("BROADCAST_ADMIN_KEY")
        or os.getenv("API_KEY")
        or ""
    ).strip()


async def require_rag_admin(admin_key: str | None = Security(_admin_header)) -> str:
    expected = _admin_expected()
    env = (os.getenv("ZGIIS_ENV") or os.getenv("ENVIRONMENT") or "").strip().lower()
    production = env in {"production", "prod"} or bool(os.getenv("VERCEL"))
    if not expected:
        if production:
            raise HTTPException(status_code=503, detail="Scientific RAG admin key is not configured")
        return ""
    if (admin_key or "").strip() != expected:
        raise HTTPException(status_code=403, detail="Scientific RAG admin key required")
    return admin_key or ""


class AskBody(BaseModel):
    question: str = Field(min_length=3, max_length=4000)
    include_live_context: bool = True


class SyncBody(BaseModel):
    max_files: int = Field(default=3, ge=1, le=10)
    page_token: str | None = None


@router.get("/status")
async def status(_=Depends(require_api_key)):
    from zgiis.scientific_rag.status import rag_status

    return rag_status()


@router.get("/documents")
async def documents(limit: int = Query(100, ge=1, le=500), _=Depends(require_api_key)):
    from zgiis.scientific_rag import store

    try:
        return {"documents": store.list_documents(limit=limit)}
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/sync")
async def sync(body: SyncBody, _=Depends(require_rag_admin)):
    from zgiis.scientific_rag.sync import sync_library

    return sync_library(max_files=body.max_files, page_token=body.page_token)


@router.post("/ask")
async def ask(body: AskBody, _=Depends(require_api_key)):
    from zgiis.ai.context import build_context_block, fetch_ekf_summary, fetch_tec_summary
    from zgiis.scientific_rag.answer import answer_scientific_question
    from zgiis.space_weather.fetch_indices import get_space_weather

    live_context = None
    if body.include_live_context:
        try:
            from backend.live_manager import get_db

            db = get_db()
        except Exception:
            db = None
        try:
            sw = get_space_weather(use_third_party=False)
            tec = fetch_tec_summary(db, hours=2.0)
            ekf = fetch_ekf_summary(hours=6.0)
            live_context, _, _ = build_context_block(tec, sw, ekf, None)
        except Exception:
            live_context = None

    try:
        return answer_scientific_question(
            body.question,
            include_live_context=body.include_live_context,
            live_context=live_context,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
