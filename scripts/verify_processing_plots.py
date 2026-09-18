"""Verify processing API returns plottable chart data."""
from __future__ import annotations

import json
import sys
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parents[1]
BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:8765"
CMN = ROOT / "verification-2026-06-20.Cmn"
OBS = ROOT / "static" / "data" / "upload_tmp" / "abc123_obs_karo1820.24o"
NAV = ROOT / "static" / "data" / "upload_tmp" / "abc123_nav_karo1820.24n"


def post_cmn() -> str:
    with CMN.open("rb") as fh:
        r = requests.post(f"{BASE}/processing/cmn", files={"file": (CMN.name, fh)}, timeout=120)
    r.raise_for_status()
    return r.json()["session_id"]


def post_rinex() -> str:
    with OBS.open("rb") as o, NAV.open("rb") as n:
        r = requests.post(
            f"{BASE}/processing/rinex",
            files=[
                ("obs", (OBS.name, o)),
                ("nav", (NAV.name, n)),
            ],
            timeout=300,
        )
    r.raise_for_status()
    return r.json()["session_id"]


def check_session(label: str, sid: str) -> dict:
    out: dict = {"label": label, "session_id": sid, "ok": True, "errors": []}

    summary = requests.get(f"{BASE}/processing/{sid}/summary", timeout=60)
    if summary.status_code != 200:
        out["ok"] = False
        out["errors"].append(f"summary HTTP {summary.status_code}")
    else:
        rows = summary.json()
        out["summary_rows"] = len(rows)
        if not rows:
            out["ok"] = False
            out["errors"].append("summary empty")
        else:
            out["sample_mean_vtec"] = rows[0].get("mean_vtec")

    hourly = requests.get(f"{BASE}/processing/{sid}/hourly", timeout=60)
    out["hourly_rows"] = len(hourly.json()) if hourly.ok else 0

    plot = requests.get(f"{BASE}/processing/{sid}/tec-plot", timeout=60)
    if plot.status_code == 200:
        body = plot.json()
        out["plot_mean_points"] = len(body.get("mean") or [])
        out["plot_datasets"] = len(body.get("datasets") or [])
        if out["plot_mean_points"] == 0 and out["plot_datasets"] == 0:
            out["errors"].append("tec-plot empty")
    else:
        out["plot_mean_points"] = 0
        out["plot_datasets"] = 0
        out["errors"].append(f"tec-plot HTTP {plot.status_code}: {plot.text[:120]}")

    if out["errors"]:
        out["ok"] = False
    return out


def main() -> int:
    results = []
    print(f"API base: {BASE}")

    if CMN.is_file():
        print("Processing CMN…")
        sid = post_cmn()
        results.append(check_session("cmn", sid))
    else:
        print(f"Skip CMN — missing {CMN}")

    if OBS.is_file() and NAV.is_file():
        print("Processing RINEX…")
        sid = post_rinex()
        results.append(check_session("rinex", sid))
    else:
        print("Skip RINEX — sample obs/nav not found")

    print(json.dumps(results, indent=2))
    return 0 if results and all(r["ok"] for r in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
