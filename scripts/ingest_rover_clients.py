#!/usr/bin/env python3
"""Ingest Spider Business Center / caster client export into rover_clients.json.

Usage:
  python scripts/ingest_rover_clients.py path/to/export.json
  python scripts/ingest_rover_clients.py path/to/export.csv
  python scripts/ingest_rover_clients.py --stdin < export.json

Accepted JSON shape:
  {
    "updated_at": "ISO-8601",
    "source": "spider_business_center",
    "stations": [
      {"code":"hara","mountpoint":"HARA","connected_rovers":12,"peak_24h":18}
    ]
  }

Accepted CSV headers (any subset):
  code|station|station_code, mountpoint|mount, connected_rovers|clients|rovers|connections
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from zgiis.live.rover_clients import (  # noqa: E402
    parse_rover_clients_csv,
    parse_rover_clients_payload,
    write_rover_clients_snapshot,
)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", nargs="?", help="JSON or CSV export path")
    parser.add_argument("--stdin", action="store_true", help="Read JSON/CSV from stdin")
    parser.add_argument(
        "-o",
        "--output",
        default="",
        help="Output JSON path (default: static/data/rover_clients.json)",
    )
    parser.add_argument("--source", default="spider_business_center_export")
    args = parser.parse_args()

    if args.stdin:
        text = sys.stdin.read()
        path_label = "stdin"
    elif args.path:
        p = Path(args.path)
        text = p.read_text(encoding="utf-8")
        path_label = str(p)
    else:
        parser.error("Provide a file path or --stdin")

    out_path = Path(args.output) if args.output else None
    lower = path_label.lower()
    if lower.endswith(".csv") or (args.stdin and "mountpoint" in text.lower() and "," in text.splitlines()[0]):
        snap = parse_rover_clients_csv(text, source=args.source)
        payload = {
            "updated_at": snap.updated_at,
            "source": args.source,
            "stations": [
                {
                    "code": s.code,
                    "mountpoint": s.mountpoint,
                    "name": s.name,
                    "connected_rovers": s.connected_rovers,
                    "peak_24h": s.peak_24h,
                }
                for s in snap.stations
            ],
        }
    else:
        payload = json.loads(text)
        if not isinstance(payload, dict):
            raise SystemExit("JSON root must be an object")
        payload.setdefault("source", args.source)
        snap = parse_rover_clients_payload(payload, source=args.source)

    if not snap.available and not snap.stations:
        print(f"No rover rows parsed from {path_label}", file=sys.stderr)
        return 1

    written = write_rover_clients_snapshot(payload, out_path)
    print(f"Wrote {written} · {snap.total_rovers} rovers across {len(snap.stations)} stations")
    if snap.busiest_code:
        print(f"Busiest: {snap.busiest_code.upper()} ({snap.busiest_count})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
