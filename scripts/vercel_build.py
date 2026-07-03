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
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
OUT = FRONTEND / "out"
STATIC_EXPORT = ROOT / "static_export"
FRONTEND_BUILD_LEFTOVERS = (
    FRONTEND / "node_modules",
    FRONTEND / ".next",
    FRONTEND / "out",
    FRONTEND / "tsconfig.tsbuildinfo",
)


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

    # Vercel packages the Python function after this build script runs. Keeping
    # Next.js dependencies/caches in frontend/ can add hundreds of MB to that
    # Python bundle even though FastAPI only needs static_export/.
    if os.environ.get("VERCEL"):
        for path in FRONTEND_BUILD_LEFTOVERS:
            if path.is_dir():
                shutil.rmtree(path)
                print(f"Removed build-only directory {path}")
            elif path.exists():
                path.unlink()
                print(f"Removed build-only file {path}")


if __name__ == "__main__":
    main()
