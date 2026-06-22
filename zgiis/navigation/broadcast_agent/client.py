"""Fetch Navigation News briefs from the ZGIIS API."""
from __future__ import annotations

import logging
from typing import Any

import requests

from zgiis.navigation.broadcast_agent.config import AudienceId

log = logging.getLogger("zgiis.broadcast.client")


class NavigationNewsClient:
    def __init__(self, api_base: str, api_key: str = "", timeout: float = 120.0) -> None:
        self.api_base = api_base.rstrip("/")
        self.api_key = api_key
        self.timeout = timeout

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"Accept": "application/json"}
        if self.api_key:
            headers["X-API-Key"] = self.api_key
        return headers

    def fetch_brief(self, audience: AudienceId, *, refresh_ntrip: bool = False) -> dict[str, Any]:
        url = f"{self.api_base}/navigation-news/briefs/{audience}"
        params = {"refresh_ntrip": "true"} if refresh_ntrip else {}
        log.info("GET %s", url)
        res = requests.get(url, headers=self._headers(), params=params, timeout=self.timeout)
        res.raise_for_status()
        return res.json()

    def fetch_all(self, *, refresh_ntrip: bool = False) -> dict[str, Any]:
        url = f"{self.api_base}/navigation-news"
        params = {"refresh_ntrip": "true"} if refresh_ntrip else {}
        log.info("GET %s", url)
        res = requests.get(url, headers=self._headers(), params=params, timeout=self.timeout)
        res.raise_for_status()
        return res.json()
