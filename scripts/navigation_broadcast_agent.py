#!/usr/bin/env python3
"""ZINGSA Navigation News broadcast agent.

Fetches live audience briefs from /navigation-news and posts to WhatsApp,
Facebook, X, webhooks, or local files. Designed to run on a scheduler or
always-on host (not Vercel serverless).

Examples:
  python scripts/navigation_broadcast_agent.py once
  python scripts/navigation_broadcast_agent.py once --audience farmer --force
  python scripts/navigation_broadcast_agent.py loop
  python scripts/navigation_broadcast_agent.py fetch --audience citizen
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

load_dotenv(ROOT / "backend" / ".env", override=True)

from zgiis.navigation.broadcast_agent.client import NavigationNewsClient  # noqa: E402
from zgiis.navigation.broadcast_agent.config import ALL_AUDIENCES, load_config  # noqa: E402
from zgiis.navigation.broadcast_agent.runner import run_broadcast_cycle, run_loop  # noqa: E402


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    )


def cmd_fetch(args: argparse.Namespace) -> int:
    cfg = load_config()
    client = NavigationNewsClient(cfg.api_base, cfg.api_key)
    if args.audience:
        data = client.fetch_brief(args.audience, refresh_ntrip=args.refresh_ntrip)
    else:
        data = client.fetch_all(refresh_ntrip=args.refresh_ntrip)
    print(json.dumps(data, indent=2, ensure_ascii=False))
    return 0


def cmd_once(args: argparse.Namespace) -> int:
    cfg = load_config()
    if args.no_dry_run:
        cfg.dry_run = False
    audiences = [args.audience] if args.audience else None
    summaries = run_broadcast_cycle(cfg, audiences=audiences, force=args.force)
    print(json.dumps(summaries, indent=2, ensure_ascii=False))
    return 0 if all(s.get("ok", False) for s in summaries) else 1


def cmd_loop(args: argparse.Namespace) -> int:
    cfg = load_config()
    if args.no_dry_run:
        cfg.dry_run = False
    run_loop(cfg)
    return 0


def cmd_routes(args: argparse.Namespace) -> int:
    cfg = load_config()
    print(json.dumps(cfg.routes, indent=2, default=lambda o: o.__dict__))
    return 0


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    parser = argparse.ArgumentParser(description="ZINGSA Navigation News broadcast agent")
    parser.add_argument("-v", "--verbose", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)

    p_fetch = sub.add_parser("fetch", help="Fetch brief(s) from API and print JSON")
    p_fetch.add_argument("--audience", choices=ALL_AUDIENCES)
    p_fetch.add_argument("--refresh-ntrip", action="store_true")
    p_fetch.set_defaults(func=cmd_fetch)

    p_once = sub.add_parser("once", help="Run one broadcast cycle")
    p_once.add_argument("--audience", choices=ALL_AUDIENCES)
    p_once.add_argument("--force", action="store_true", help="Send even if script unchanged")
    p_once.add_argument("--no-dry-run", action="store_true", help="Actually post to channels")
    p_once.set_defaults(func=cmd_once)

    p_loop = sub.add_parser("loop", help="Run forever at BROADCAST_INTERVAL_MIN")
    p_loop.add_argument("--no-dry-run", action="store_true")
    p_loop.set_defaults(func=cmd_loop)

    sub.add_parser("routes", help="Show parsed BROADCAST_ROUTES").set_defaults(func=cmd_routes)

    args = parser.parse_args()
    _setup_logging(args.verbose)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
