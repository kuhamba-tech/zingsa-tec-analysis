#!/usr/bin/env bash
# Build the Next.js static export for Render with the API host baked in.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

if [[ -n "${RENDER_API_HOST:-}" ]]; then
  export NEXT_PUBLIC_API_URL="https://${RENDER_API_HOST}"
elif [[ -n "${NEXT_PUBLIC_API_URL:-}" ]]; then
  case "${NEXT_PUBLIC_API_URL}" in
    http://*|https://*) ;;
    *) export NEXT_PUBLIC_API_URL="https://${NEXT_PUBLIC_API_URL}" ;;
  esac
else
  echo "ERROR: Set RENDER_API_HOST or NEXT_PUBLIC_API_URL for the static build." >&2
  exit 1
fi

echo "Building frontend with NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}"
cd frontend
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
npm run build

if [[ ! -d out ]]; then
  echo "ERROR: frontend/out missing after build (expected Next.js output: 'export')." >&2
  exit 1
fi
