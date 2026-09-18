#!/usr/bin/env node
/**
 * Start (or reuse) the local ZGIIS stack:
 *   - FastAPI on http://127.0.0.1:8000
 *   - Next.js frontend on http://127.0.0.1:3000
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.join(root, "frontend");
const venvPython = path.join(root, ".venv", "bin", "python");
const uvicornBin = path.join(root, ".venv", "bin", "uvicorn");

async function probe(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return res.ok || res.status === 200;
  } catch {
    return false;
  }
}

function start(command, args, cwd, label) {
  const child = spawn(command, args, {
    cwd,
    stdio: "ignore",
    detached: true,
    env: process.env,
  });
  child.unref();
  console.log(`started ${label} (pid ${child.pid})`);
}

async function main() {
  let apiUp = await probe("http://127.0.0.1:8000/health");
  let uiUp = await probe("http://127.0.0.1:3000/");

  if (!apiUp) {
    if (!existsSync(uvicornBin)) {
      console.error("Missing .venv — create it and install backend/requirements.txt first.");
      process.exit(1);
    }
    start(
      uvicornBin,
      ["backend.main:app", "--host", "127.0.0.1", "--port", "8000"],
      root,
      "API :8000",
    );
  } else {
    console.log("API already running on http://127.0.0.1:8000");
  }

  if (!uiUp) {
    start(
      "npx",
      ["next", "dev", "--webpack", "--port", "3000", "--hostname", "127.0.0.1"],
      frontend,
      "frontend :3000",
    );
  } else {
    console.log("Frontend already running on http://127.0.0.1:3000");
  }

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    apiUp = await probe("http://127.0.0.1:8000/health");
    uiUp = await probe("http://127.0.0.1:3000/");
    if (apiUp && uiUp) break;
  }

  if (!apiUp || !uiUp) {
    console.error(`Not ready yet — API ${apiUp ? "up" : "down"}, UI ${uiUp ? "up" : "down"}`);
    process.exit(1);
  }

  console.log("");
  console.log("ZGIIS is running:");
  console.log("  Frontend  http://127.0.0.1:3000/");
  console.log("  API       http://127.0.0.1:8000/health");
  console.log(`  Python    ${existsSync(venvPython) ? venvPython : "n/a"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
