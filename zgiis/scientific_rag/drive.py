"""Google Drive read-only client (OAuth refresh token or service account)."""
from __future__ import annotations

import json
import logging
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from zgiis.scientific_rag import config

log = logging.getLogger(__name__)

DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.readonly"
SUPPORTED_MIME = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "text/plain",
    "application/vnd.google-apps.document",
}


class DriveAuthError(RuntimeError):
    pass


def _http_json(url: str, *, data: bytes | None = None, headers: dict[str, str] | None = None, method: str = "GET") -> dict[str, Any]:
    request = Request(url, data=data, headers=headers or {}, method=method)
    try:
        with urlopen(request, timeout=60) as response:
            body = response.read().decode("utf-8")
            return json.loads(body) if body else {}
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:500]
        raise DriveAuthError(f"Drive HTTP {exc.code}: {detail}") from exc
    except URLError as exc:
        raise DriveAuthError(f"Drive network error: {exc}") from exc


def _oauth_access_token() -> str:
    client_id = config.oauth_client_id()
    client_secret = config.oauth_client_secret()
    refresh = config.oauth_refresh_token()
    if not (client_id and client_secret and refresh):
        raise DriveAuthError("OAuth client ID/secret/refresh token are not configured")
    payload = urlencode(
        {
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh,
            "grant_type": "refresh_token",
        }
    ).encode("utf-8")
    data = _http_json(
        "https://oauth2.googleapis.com/token",
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    token = data.get("access_token")
    if not token:
        raise DriveAuthError("OAuth token response missing access_token")
    return str(token)


def _service_account_access_token() -> str:
    """Minimal JWT bearer exchange for a Drive service account."""
    info = config.service_account_info()
    if not info:
        raise DriveAuthError("Service account JSON is not configured")
    try:
        import jwt  # PyJWT — optional; fall back message if missing
    except ImportError as exc:
        raise DriveAuthError(
            "Service-account Drive auth requires PyJWT. Prefer OAuth refresh token env vars, "
            "or pip install PyJWT cryptography."
        ) from exc

    now = int(time.time())
    assertion = jwt.encode(
        {
            "iss": info["client_email"],
            "scope": DRIVE_SCOPE,
            "aud": "https://oauth2.googleapis.com/token",
            "iat": now,
            "exp": now + 3600,
        },
        info["private_key"],
        algorithm="RS256",
    )
    payload = urlencode(
        {
            "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer",
            "assertion": assertion,
        }
    ).encode("utf-8")
    data = _http_json(
        "https://oauth2.googleapis.com/token",
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    token = data.get("access_token")
    if not token:
        raise DriveAuthError("Service-account token response missing access_token")
    return str(token)


def access_token() -> str:
    if config.oauth_refresh_token() and config.oauth_client_id():
        return _oauth_access_token()
    return _service_account_access_token()


def list_library_files(page_token: str | None = None, page_size: int = 50) -> dict[str, Any]:
    folder = config.folder_id()
    if not folder:
        raise DriveAuthError("GOOGLE_DRIVE_FOLDER_ID is not set")
    token = access_token()
    mime_filter = " or ".join(f"mimeType='{m}'" for m in sorted(SUPPORTED_MIME))
    q = f"'{folder}' in parents and trashed=false and ({mime_filter})"
    params = {
        "q": q,
        "pageSize": str(page_size),
        "fields": "nextPageToken,files(id,name,mimeType,modifiedTime,md5Checksum,size,webViewLink)",
        "supportsAllDrives": "true",
        "includeItemsFromAllDrives": "true",
    }
    if page_token:
        params["pageToken"] = page_token
    url = "https://www.googleapis.com/drive/v3/files?" + urlencode(params)
    return _http_json(url, headers={"Authorization": f"Bearer {token}"})


def download_file_bytes(file_id: str, mime_type: str) -> tuple[bytes, str]:
    """Return (bytes, effective_mime). Google Docs are exported to plain text."""
    token = access_token()
    if mime_type == "application/vnd.google-apps.document":
        url = f"https://www.googleapis.com/drive/v3/files/{file_id}/export?mimeType=text/plain"
        effective = "text/plain"
    else:
        url = f"https://www.googleapis.com/drive/v3/files/{file_id}?alt=media"
        effective = mime_type
    request = Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urlopen(request, timeout=120) as response:
            return response.read(), effective
    except HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")[:400]
        raise DriveAuthError(f"Download failed ({exc.code}): {detail}") from exc
