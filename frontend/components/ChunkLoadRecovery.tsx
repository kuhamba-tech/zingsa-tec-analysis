"use client";

import { useEffect } from "react";

const RELOAD_KEY = "zgiis:chunk-load-reload";

function isChunkLoadFailure(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === "string") {
    return /ChunkLoadError|Loading chunk .+ failed/i.test(value);
  }
  if (typeof value === "object") {
    const err = value as { name?: string; message?: string };
    return (
      err.name === "ChunkLoadError" ||
      /ChunkLoadError|Loading chunk .+ failed/i.test(String(err.message ?? ""))
    );
  }
  return false;
}

/**
 * After a webpack HMR / Fast Refresh thrash, browsers can keep requesting a
 * stale chunk URL until ChunkLoadError times out. One hard reload usually
 * recovers; avoid loops with a short sessionStorage lock.
 */
export default function ChunkLoadRecovery() {
  useEffect(() => {
    let cleared = false;
    const clearLock = window.setTimeout(() => {
      cleared = true;
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch {
        /* ignore */
      }
    }, 8_000);

    const reloadOnce = () => {
      try {
        if (sessionStorage.getItem(RELOAD_KEY) === "1") return;
        sessionStorage.setItem(RELOAD_KEY, "1");
      } catch {
        // If storage is blocked, still attempt a single reload.
      }
      if (cleared) return;
      window.location.reload();
    };

    const onError = (event: ErrorEvent) => {
      if (isChunkLoadFailure(event.error) || isChunkLoadFailure(event.message)) {
        reloadOnce();
      }
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isChunkLoadFailure(event.reason)) {
        reloadOnce();
      }
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.clearTimeout(clearLock);
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
