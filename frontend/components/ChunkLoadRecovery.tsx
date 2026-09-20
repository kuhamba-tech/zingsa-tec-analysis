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
 * Backup recovery after layout.js has loaded. Primary recovery lives in
 * /zgiis-sw-boot.js so layout-chunk timeouts can still hard-reload.
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
    }, 12_000);

    const reloadOnce = () => {
      try {
        if (sessionStorage.getItem(RELOAD_KEY) === "1") return;
        sessionStorage.setItem(RELOAD_KEY, "1");
      } catch {
        // If storage is blocked, still attempt a single reload.
      }
      if (cleared) return;
      try {
        const url = new URL(window.location.href);
        url.searchParams.set("_chunk", String(Date.now()));
        window.location.replace(url.toString());
      } catch {
        window.location.reload();
      }
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
