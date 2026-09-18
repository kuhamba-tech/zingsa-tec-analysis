#!/usr/bin/env node
/**
 * Start (or reuse) the local ZGIIS stack:
 *   - FastAPI on http://127.0.0.1:8000
 *   - Next.js frontend on http://127.0.0.1:3000
 *
 * If Next is listening but returning 5xx / connection errors (corrupt
 * `.next` cache), free :3000, clear `.next`, and restart cleanly.
 */
import { spawn, execSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.join(root, "frontend");
const nextDir = path.join(frontend, ".next");
const venvPython = path.join(root, ".venv", "bin", "python");
const uvicornBin = path.join(root, ".venv", "bin", "uvicorn");

async function probe(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** True when something answers on the port but not with a healthy page. */
async function portOccupiedButUnhealthy(url) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    return !res.ok;
  } catch (err) {
    const msg = String(err?.cause?.code || err?.code || err?.message || err);
    // Connection refused → nothing listening (healthy "down").
    if (/ECONNREFUSED|ENOTFOUND|fetch failed/i.test(msg)) return false;
    // Invalid HTTP / reset / empty → occupied but broken.
    return true;
  }
}

function freePort(port) {
  try {
    execSync(`lsof -ti :${port} | xargs -r kill -9`, { stdio: "ignore" });
  } catch {
    /* nothing on port */
  }
  try {
    execSync(`pkill -f 'next dev --webpack --port ${port}' || true`, {
      stdio: "ignore",
      shell: "/bin/bash",
    });
  } catch {
    /* ignore */
  }
}

function clearNextCache() {
  if (existsSync(nextDir)) {
    rmSync(nextDir, { recursive: true, force: true });
    console.log("cleared frontend/.next cache");
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

async function ensureFrontend() {
  const home = "http://127.0.0.1:3000/";
  const spaceWeather = "http://127.0.0.1:3000/space-weather/";

  let uiUp = (await probe(home)) && (await probe(spaceWeather));
  if (uiUp) {
    console.log("Frontend already running on http://127.0.0.1:3000");
    return;
  }

  const broken =
    (await portOccupiedButUnhealthy(home)) ||
    (await portOccupiedButUnhealthy(spaceWeather));

  if (broken) {
    console.log("Frontend on :3000 is unhealthy — restarting with clean cache");
  }

  freePort(3000);
  // Brief pause so the OS releases the socket.
  await new Promise((r) => setTimeout(r, 800));
  clearNextCache();

  start(
    "npx",
    ["next", "dev", "--webpack", "--port", "3000", "--hostname", "127.0.0.1"],
    frontend,
    "frontend :3000",
  );
}

async function main() {
  let apiUp = await probe("http://127.0.0.1:8000/health");

  if (!apiUp) {
    if (!existsSync(uvicornBin)) {
      console.error(
        "Missing .venv — create it and install backend/requirements.txt first.",
      );
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

  await ensureFrontend();

  let uiUp = false;
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    apiUp = await probe("http://127.0.0.1:8000/health");
    uiUp =
      (await probe("http://127.0.0.1:3000/")) &&
      (await probe("http://127.0.0.1:3000/space-weather/"));
    if (apiUp && uiUp) break;
  }

  if (!apiUp || !uiUp) {
    console.error(
      `Not ready yet — API ${apiUp ? "up" : "down"}, UI ${uiUp ? "up" : "down"}`,
    );
    process.exit(1);
  }

  console.log("");
  console.log("ZGIIS is running:");
  console.log("  Frontend       http://127.0.0.1:3000/");
  console.log("  Space Weather  http://127.0.0.1:3000/space-weather/");
  console.log("  API            http://127.0.0.1:8000/health");
  console.log(`  Python         ${existsSync(venvPython) ? venvPython : "n/a"}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
