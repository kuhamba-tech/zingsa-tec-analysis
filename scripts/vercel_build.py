"""Build Next.js static export into repo-root public/ for Vercel CDN + FastAPI."""
from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FRONTEND = ROOT / "frontend"
OUT = FRONTEND / "out"
PUBLIC = ROOT / "public"


def run(cmd: list[str], cwd: Path) -> None:
    print(f"+ {' '.join(cmd)}  (cwd={cwd})")
    subprocess.run(cmd, cwd=cwd, check=True)


def main() -> None:
    npm = "npm.cmd" if sys.platform == "win32" else "npm"
    run([npm, "install"], FRONTEND)
    run([npm, "run", "build"], FRONTEND)

    if not OUT.is_dir():
        raise SystemExit(f"Next.js export missing: {OUT}")

    if PUBLIC.exists():
        shutil.rmtree(PUBLIC)
    shutil.copytree(OUT, PUBLIC)
    print(f"Copied {OUT} -> {PUBLIC}")


if __name__ == "__main__":
    main()
