#!/usr/bin/env node
/**
 * Cross-platform replacement for the POSIX `npm run build` one-liner.
 *
 * VERCEL=1  → `next build` (server build, App Router routes stay in place).
 * otherwise → stash app/api, static-export `next build`, always restore, then
 *             exit with the build status (restore still runs if the build fails).
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const prepareScript = path.join(root, "scripts", "prepare-static-export.mjs");

function run(args, extraEnv = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: root,
      env: { ...process.env, ...extraEnv },
      stdio: "inherit",
    });
    child.on("exit", (code, signal) => {
      resolve(signal ? 1 : code ?? 1);
    });
    child.on("error", () => resolve(1));
  });
}

if (process.env.VERCEL === "1") {
  process.exit(await run([nextBin, "build"]));
}

const stashed = await run([prepareScript, "stash"]);
if (stashed !== 0) process.exit(stashed);

const built = await run([nextBin, "build"], { ZGIIS_STATIC_EXPORT: "1" });
await run([prepareScript, "restore"]);
process.exit(built);
