from __future__ import annotations

import os

from fastapi import HTTPException, Request, Security, status
from fastapi.security.api_key import APIKeyHeader

_header = APIKeyHeader(name="X-API-Key", auto_error=False)
_admin_header = APIKeyHeader(name="X-Broadcast-Admin-Key", auto_error=False)


def _is_production() -> bool:
    environment = (os.getenv("ZGIIS_ENV") or os.getenv("ENVIRONMENT") or "").strip().lower()
    return environment in {"production", "prod"} or bool(os.getenv("VERCEL"))


async def require_api_key(request: Request, key: str | None = Security(_header)) -> str:
    expected = os.getenv("API_KEY")
    if not expected:
        # Public dashboards need unauthenticated reads. Never silently expose
        # mutating production endpoints when deployment secrets are missing.
        if _is_production() and request.method.upper() not in {"GET", "HEAD", "OPTIONS"}:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="API write protection is not configured",
            )
        return ""
    if key != expected:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid API key")
    return key


def _broadcast_admin_expected() -> str:
    return (os.getenv("BROADCAST_ADMIN_KEY") or os.getenv("API_KEY") or "").strip()


async def is_broadcast_admin(admin_key: str | None = Security(_admin_header)) -> bool:
    expected = _broadcast_admin_expected()
    if not expected:
        return not _is_production()
    return (admin_key or "").strip() == expected


async def require_broadcast_admin(admin_key: str | None = Security(_admin_header)) -> str:
    expected = _broadcast_admin_expected()
    if not expected:
        if _is_production():
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Broadcast administration is not configured",
            )
        return ""
    if (admin_key or "").strip() != expected:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Broadcast admin key required (X-Broadcast-Admin-Key)",
        )
    return admin_key or ""
