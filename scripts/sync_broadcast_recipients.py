#!/usr/bin/env python3
"""Sync WhatsApp broadcast recipients from a private JSON file (not committed to git).

Usage:
  python scripts/sync_broadcast_recipients.py
  python scripts/sync_broadcast_recipients.py --file path/to/recipients.json

Set BROADCAST_RECIPIENTS_FILE to override the default path:
  static/data/broadcast_recipients.private.json
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from zgiis.navigation.broadcast_recipients_file import recipients_file_path, sync_recipients_from_file


def main() -> int:
    parser = argparse.ArgumentParser(description="Sync private WhatsApp broadcast recipients into the platform.")
    parser.add_argument(
        "--file",
        type=Path,
        help="Path to private JSON file (default: static/data/broadcast_recipients.private.json)",
    )
    parser.add_argument("--print-path", action="store_true", help="Print the resolved file path and exit.")
    args = parser.parse_args()

    path = args.file or recipients_file_path()
    if args.print_path:
        print(path)
        return 0

    if not path.is_file():
        example = ROOT / "static" / "data" / "broadcast_recipients.private.json.example"
        print(f"Private recipients file not found: {path}", file=sys.stderr)
        print(f"Copy {example.name} to {path.name} and add your groups.", file=sys.stderr)
        return 1

    result = sync_recipients_from_file(path=path)
    print(json.dumps(result, indent=2))
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())
