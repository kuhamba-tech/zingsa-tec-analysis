"""Broadcast agent runner — fetch briefs and dispatch on a schedule."""
from __future__ import annotations

import logging
import time
from typing import Any

from zgiis.navigation.broadcast_agent.client import NavigationNewsClient
from zgiis.navigation.broadcast_agent.config import AudienceId, BroadcastConfig, load_config
from zgiis.navigation.broadcast_agent.dispatcher import dispatch_brief
from zgiis.navigation.broadcast_agent.state import BroadcastState

log = logging.getLogger("zgiis.broadcast.runner")


def run_broadcast_cycle(
    config: BroadcastConfig | None = None,
    *,
    audiences: list[AudienceId] | None = None,
    force: bool = False,
) -> list[dict[str, Any]]:
    """Fetch and dispatch one broadcast cycle. Returns summary rows."""
    cfg = config or load_config()
    client = NavigationNewsClient(cfg.api_base, cfg.api_key)
    state = BroadcastState(cfg.state_path)
    target_audiences = audiences or cfg.audiences

    summaries: list[dict[str, Any]] = []

    for audience in target_audiences:
        routes = cfg.routes.get(audience) or cfg.routes.get(audience.lower()) or []
        if not routes:
            log.warning("No routes for audience %s", audience)
            continue

        try:
            brief = client.fetch_brief(audience, refresh_ntrip=cfg.refresh_ntrip)
        except Exception as exc:
            log.error("Failed to fetch brief for %s: %s", audience, exc)
            summaries.append({"audience": audience, "ok": False, "error": str(exc)})
            continue

        results = dispatch_brief(brief, audience, routes, cfg, state, force=force)
        if not cfg.dry_run:
            state.save()

        summaries.append({
            "audience": audience,
            "headline": brief.get("headline"),
            "ok": all(r.ok for r in results),
            "deliveries": [
                {"channel": r.channel, "script": r.script_kind, "ok": r.ok, "detail": r.detail, "dry_run": r.dry_run}
                for r in results
            ],
        })

    return summaries


def run_loop(config: BroadcastConfig | None = None) -> None:
    cfg = config or load_config()
    log.info(
        "Navigation broadcast agent started — interval %d min, dry_run=%s, api=%s",
        cfg.interval_min,
        cfg.dry_run,
        cfg.api_base,
    )
    while True:
        try:
            summaries = run_broadcast_cycle(cfg)
            for row in summaries:
                log.info("Broadcast %s: ok=%s headline=%s", row.get("audience"), row.get("ok"), row.get("headline"))
        except Exception:
            log.exception("Broadcast cycle failed")
        time.sleep(cfg.interval_min * 60)
