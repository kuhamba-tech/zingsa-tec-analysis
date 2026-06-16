"""Request-level device hints used for lightweight mobile rendering."""
from __future__ import annotations

from typing import Any


_MOBILE_USER_AGENT_MARKERS = (
    "android",
    "iphone",
    "ipad",
    "ipod",
    "mobile",
    "opera mini",
    "opera mobi",
    "windows phone",
)


def is_mobile_request(st_module: Any) -> bool:
    """Return True when Streamlit's request headers identify a mobile client."""
    try:
        headers = st_module.context.headers
        user_agent = str(
            headers.get("User-Agent")
            or headers.get("user-agent")
            or ""
        ).lower()
    except (AttributeError, RuntimeError):
        return False

    return any(marker in user_agent for marker in _MOBILE_USER_AGENT_MARKERS)
