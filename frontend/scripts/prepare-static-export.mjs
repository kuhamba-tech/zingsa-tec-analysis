#!/usr/bin/env node
/**
 * Static export (Vercel) cannot include App Router Route Handlers.
 * The Cursor-only /api/zgiis proxy is stashed for production builds and
 * restored afterward so local `next dev` keeps working.
 */
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiDir = path.join(root, "app", "api");
const stashDir = path.join(root, ".dev-api-stash");

const mode = process.argv[2] || "stash";

if (mode === "stash") {
  if (!existsSync(apiDir)) {
    console.log("prepare-static-export: no app/api to stash");
    process.exit(0);
  }
  if (existsSync(stashDir)) {
    rmSync(stashDir, { recursive: true, force: true });
  }
  mkdirSync(path.dirname(stashDir), { recursive: true });
  renameSync(apiDir, stashDir);
  console.log("prepare-static-export: stashed app/api → .dev-api-stash");
  process.exit(0);
}

if (mode === "restore") {
  if (!existsSync(stashDir)) {
    console.log("prepare-static-export: nothing to restore");
    process.exit(0);
  }
  if (existsSync(apiDir)) {
    rmSync(apiDir, { recursive: true, force: true });
  }
  renameSync(stashDir, apiDir);
  console.log("prepare-static-export: restored app/api from .dev-api-stash");
  process.exit(0);
}

console.error(`Usage: prepare-static-export.mjs [stash|restore]`);
process.exit(1);
