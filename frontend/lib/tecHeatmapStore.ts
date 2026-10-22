"use client";

import { getTecHeatmap } from "@/lib/api";
import type { TecHeatmapResponse } from "@/lib/types";

const TTL_MS = 20_000;
const REFRESH_MS = 30_000;

type Listener = (heatmap: TecHeatmapResponse | null) => void;

let latest: TecHeatmapResponse | null = null;
let savedAt = 0;
let inflight: Promise<TecHeatmapResponse | null> | null = null;
let timer: number | null = null;
const listeners = new Set<Listener>();

function publish(next: TecHeatmapResponse | null) {
  latest = next;
  savedAt = Date.now();
  listeners.forEach((listener) => listener(next));
}

export function peekTecHeatmap(): TecHeatmapResponse | null {
  return latest;
}

export function subscribeTecHeatmap(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Shared live-TEC fetch so the map, strip, and page boot do not each wait on a new build. */
export function loadTecHeatmap(force = false): Promise<TecHeatmapResponse | null> {
  if (!force && latest && Date.now() - savedAt < TTL_MS) {
    return Promise.resolve(latest);
  }
  if (inflight) return inflight;
  inflight = getTecHeatmap(0.05, false)
    .then((heatmap) => {
      publish(heatmap);
      return heatmap;
    })
    .catch(() => latest)
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Start the live TEC sample as soon as the page opens, then keep it current. */
export function ensureLiveTecHeatmap(): void {
  if (typeof window === "undefined") return;
  void loadTecHeatmap();
  if (timer != null) return;
  timer = window.setInterval(() => {
    void loadTecHeatmap(true);
  }, REFRESH_MS);
}
