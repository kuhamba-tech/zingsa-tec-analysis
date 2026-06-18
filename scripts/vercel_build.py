"""Build Next.js static export into repo-root static_export/, served by FastAPI itself.

Deliberately NOT named "public" -- Vercel treats a root-level public/ directory as a
reserved CDN-static bucket, and in practice files copied there mid-build (rather than
committed ahead of time) were neither promoted to that CDN bucket nor included in the
Python function bundle, so requests for them (including "/") fell through to FastAPI's
404/fallback handler. Using a non-reserved name and having backend/main.py mount it
directly with StaticFiles sidesteps that ambiguity entirely.
"""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
OUT = FRONTEND / "out"
STATIC_EXPORT = ROOT / "static_export"


def run(cmd: list[str], cwd: Path) -> None:
    print(f"+ {' '.join(cmd)}  (cwd={cwd})")
    subprocess.run(cmd, cwd=cwd, check=True)


def main() -> None:
    npm = "npm.cmd" if sys.platform == "win32" else "npm"
    run([npm, "install"], FRONTEND)
    run([npm, "run", "build"], FRONTEND)

    if not OUT.is_dir():
        raise SystemExit(f"Next.js export missing: {OUT}")

    if STATIC_EXPORT.exists():
        shutil.rmtree(STATIC_EXPORT)
    shutil.copytree(OUT, STATIC_EXPORT)
    print(f"Copied {OUT} -> {STATIC_EXPORT}")


if __name__ == "__main__":
    main()
