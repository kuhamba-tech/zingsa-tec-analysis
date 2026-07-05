from __future__ import annotations

import os

from fastapi import HTTPException, Security, status
from fastapi.security.api_key import APIKeyHeader

_header = APIKeyHeader(name="X-API-Key", auto_error=False)
_admin_header = APIKeyHeader(name="X-Broadcast-Admin-Key", auto_error=False)


async def require_api_key(key: str | None = Security(_header)) -> str:
    expected = os.getenv("API_KEY")
    if not expected:
        return ""  # API_KEY not configured → open access (dev mode)
    if key != expected:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid API key")
    return key


def _broadcast_admin_expected() -> str:
    return (os.getenv("BROADCAST_ADMIN_KEY") or os.getenv("API_KEY") or "").strip()


async def is_broadcast_admin(admin_key: str | None = Security(_admin_header)) -> bool:
    expected = _broadcast_admin_expected()
    if not expected:
        return True  # dev mode — no admin key configured
    return (admin_key or "").strip() == expected


async def require_broadcast_admin(admin_key: str | None = Security(_admin_header)) -> str:
    expected = _broadcast_admin_expected()
    if not expected:
        return ""  # dev mode
    if (admin_key or "").strip() != expected:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Broadcast admin key required (X-Broadcast-Admin-Key)",
        )
    return admin_key or ""
