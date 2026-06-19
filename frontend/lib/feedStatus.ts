"use client";

import { useEffect, useState } from "react";

export type FeedStatus = "pending" | "ok" | "down";

const PREFIX = "zgiis:last-ok:";

function readLastOk(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(PREFIX + key);
  } catch {
    return null;
  }
}

function writeLastOk(key: string, iso: string) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFIX + key, iso);
  } catch {
    // localStorage unavailable (private mode, etc.) — freshness tracking is best-effort.
  }
}

function formatUtc(iso: string): string {
  return `${iso.slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Distinguishes "feed temporarily unavailable" from "never connected" without
 * ever substituting a fabricated value for the feed itself — only the
 * timestamp of the last successful fetch is persisted, never the data.
 */
export function useFeedFreshness(feedKey: string, status: FeedStatus): string | null {
  const [lastOk, setLastOk] = useState<string | null>(null);

  useEffect(() => {
    setLastOk(readLastOk(feedKey));
  }, [feedKey]);

  useEffect(() => {
    if (status === "ok") {
      const now = new Date().toISOString();
      writeLastOk(feedKey, now);
      setLastOk(now);
    }
  }, [status, feedKey]);

  if (status !== "down") return null;
  return lastOk
    ? `Live feed unavailable since ${formatUtc(lastOk)} — figures below show N/A until it reconnects.`
    : "Live feed has not connected yet this session — figures below show N/A until a successful connection is made.";
}
