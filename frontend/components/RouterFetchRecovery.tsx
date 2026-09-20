"use client";

import { useEffect } from "react";

const RELOAD_KEY = "zgiis:rsc-fetch-reload";

function isRouterFetchFailure(value: unknown): boolean {
  if (!value) return false;
  if (typeof value === "string") {
    return /Failed to fetch|fetchServerResponse|Load failed|NetworkError/i.test(value);
  }
  if (typeof value === "object") {
    const err = value as { name?: string; message?: string; digest?: string };
    const message = String(err.message ?? "");
    const name = String(err.name ?? "");
    return (
      name === "TypeError" && /Failed to fetch|Load failed|NetworkError/i.test(message)
    ) || /fetchServerResponse|RSC payload/i.test(message);
  }
  return false;
}

/**
 * Next soft-nav sometimes fails to fetch the RSC payload after Fast Refresh or
 * when the URL is missing a trailing slash (`/space-weather` vs `/space-weather/`).
 * Recover with a single hard navigation instead of leaving the red overlay up.
 */
export default function RouterFetchRecovery() {
  useEffect(() => {
    let cleared = false;
    const clearLock = window.setTimeout(() => {
      cleared = true;
      try {
        sessionStorage.removeItem(RELOAD_KEY);
      } catch {
        /* ignore */
      }
    }, 15_000);

    const hardNavOnce = (href?: string) => {
      try {
        if (sessionStorage.getItem(RELOAD_KEY) === "1") return;
        sessionStorage.setItem(RELOAD_KEY, "1");
      } catch {
        /* ignore */
      }
      if (cleared) return;
      try {
        const url = new URL(href || window.location.href, window.location.origin);
        if (!url.pathname.endsWith("/") && !url.pathname.split("/").pop()?.includes(".")) {
          url.pathname = `${url.pathname}/`;
        }
        url.searchParams.set("_nav", String(Date.now()));
        window.location.replace(url.toString());
      } catch {
        window.location.reload();
      }
    };

    // Keep app routes on trailing-slash URLs (next.config trailingSlash: true).
    try {
      const here = new URL(window.location.href);
      if (
        here.pathname.length > 1 &&
        !here.pathname.endsWith("/") &&
        !here.pathname.split("/").pop()?.includes(".")
      ) {
        here.pathname = `${here.pathname}/`;
        window.history.replaceState(window.history.state, "", here.toString());
      }
    } catch {
      /* ignore */
    }

    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isRouterFetchFailure(event.reason)) return;
      event.preventDefault();
      hardNavOnce();
    };
    const onError = (event: ErrorEvent) => {
      if (!isRouterFetchFailure(event.error) && !isRouterFetchFailure(event.message)) return;
      hardNavOnce();
    };

    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      window.clearTimeout(clearLock);
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return null;
}
