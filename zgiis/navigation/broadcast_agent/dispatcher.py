"""Dispatch Navigation News briefs to configured channels."""
from __future__ import annotations

import logging
from typing import Any

from zgiis.navigation.broadcast_agent.channels import DeliveryResult, build_channel
from zgiis.navigation.broadcast_agent.config import BroadcastConfig, ChannelTarget
from zgiis.navigation.broadcast_agent.state import BroadcastState

log = logging.getLogger("zgiis.broadcast.dispatcher")


def _script_text(brief: dict[str, Any], kind: str) -> str:
    if kind == "social":
        return str(brief.get("social_script") or "")
    return str(brief.get("broadcast_script") or "")


def dispatch_brief(
    brief: dict[str, Any],
    audience: str,
    targets: list[ChannelTarget],
    config: BroadcastConfig,
    state: BroadcastState,
    *,
    force: bool = False,
) -> list[DeliveryResult]:
    results: list[DeliveryResult] = []
    brief = {**brief, "_computed_at": brief.get("_computed_at")}

    for target in targets:
        channel = build_channel(target.channel, out_dir=config.out_dir)
        if channel is None:
            results.append(DeliveryResult(target.channel, audience, target.script, False, "unknown channel"))
            continue

        text = _script_text(brief, target.script)
        if not text.strip():
            results.append(DeliveryResult(target.channel, audience, target.script, False, "empty script"))
            continue

        if not force and not state.should_send(audience, target.channel, target.script, text):
            results.append(DeliveryResult(target.channel, audience, target.script, True, "skipped (unchanged)"))
            continue

        dry_run = config.dry_run
        try:
            result = channel.send(
                audience=audience,
                script_kind=target.script,
                text=text,
                brief=brief,
                dry_run=dry_run,
                options=target.options,
            )
        except Exception as exc:
            log.exception("Channel %s failed for %s", target.channel, audience)
            result = DeliveryResult(target.channel, audience, target.script, False, str(exc))

        if result.ok and "skipped" not in result.detail and not dry_run:
            state.mark_sent(audience, target.channel, target.script, text)
        elif result.ok and dry_run:
            log.info("Dry-run ok: %s/%s/%s", audience, target.channel, target.script)

        results.append(result)

    return results
