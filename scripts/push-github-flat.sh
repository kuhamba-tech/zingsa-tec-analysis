#!/usr/bin/env bash
# From the Origin/workspace monorepo: publish zingsa-tec-analysis/ as GitHub main root.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
BRANCH="cursor/zingsa-vercel-root-8324"
git subtree split --prefix=zingsa-tec-analysis -b "$BRANCH"
git push github "$BRANCH:main" --force
echo "GitHub main updated (flat root for Vercel)."
