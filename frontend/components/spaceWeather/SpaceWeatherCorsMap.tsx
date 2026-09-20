"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { getStations, getTecHeatmap } from "@/lib/api";
import { loadCorsMapWithLayers } from "@/lib/loadCorsMapWithLayers";
import {
  countLiveStationStatuses,
  countSpiderLiveStationStatuses,
} from "@/lib/liveStationStatus";
import { peekSpaceWeather, subscribeSpaceWeather } from "@/lib/spaceWeatherStore";
import { peekStations, subscribeStations, stationsAreSpiderAuthoritative } from "@/lib/stationsStore";
import { mergeTecHeatmapWithStations } from "@/lib/tecHeatmapMerge";
import type { Station, TecHeatmapResponse } from "@/lib/types";

const CorsMapWithLayers = dynamic(
  () => loadCorsMapWithLayers().then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="home-map-loading" role="status" aria-live="polite">
        <span className="home-map-loading-spinner" aria-hidden="true" />
        <span>Loading interactive CORS map…</span>
      </div>
    ),
  },
);

function useCorsMapHeight(preferred = 440): number {
  const [height, setHeight] = useState(() => {
    if (typeof window === "undefined") return preferred;
    const w = window.innerWidth;
    if (w <= 560) return 260;
    if (w <= 768) return 320;
    return preferred;
  });

  useEffect(() => {
    const apply = () => {
      const w = window.innerWidth;
      if (w <= 560) setHeight(260);
      else if (w <= 768) setHeight(320);
      else setHeight(preferred);
    };
    apply();
    window.addEventListener("resize", apply, { passive: true });
    return () => window.removeEventListener("resize", apply);
  }, [preferred]);

  return height;
}

/**
 * Zimbabwe CORS Network map — markers use the same Spider station snapshot as
 * the CORS Connected metric card. Heatmap is optional and must never block markers.
 */
export default function SpaceWeatherCorsMap({ height: preferredHeight = 440 }: { height?: number }) {
  const height = useCorsMapHeight(preferredHeight);
  const [stations, setStations] = useState<Station[]>(() => peekStations());
  const [stationsLoading, setStationsLoading] = useState(() => peekStations().length === 0);
  const [heatmap, setHeatmap] = useState<TecHeatmapResponse | null>(null);
  const [riskLevel, setRiskLevel] = useState(() => peekSpaceWeather()?.gnss_risk ?? "Low");

  useEffect(() => subscribeStations((next) => {
    if (next.length) {
      setStations(next);
      setStationsLoading(false);
    }
  }), []);
  useEffect(
    () =>
      subscribeSpaceWeather((next) => {
        if (next?.gnss_risk) setRiskLevel(next.gnss_risk);
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    const cached = peekStations();
    if (cached.length) {
      setStations(cached);
      setStationsLoading(false);
    }

    // Markers first — same /cors/stations feed the metric cards already use.
    getStations(false)
      .then((rows) => {
        if (cancelled) return;
        if (rows.length) setStations(rows);
      })
      .catch(() => null)
      .finally(() => {
        if (!cancelled) setStationsLoading(false);
      });

    // Heatmap is decorative for the Hybrid layer — never block station dots.
    // On narrow viewports, wait longer so metric paint and scroll stay responsive.
    const loadHeatmap = () => {
      void getTecHeatmap(0.05, false)
        .then((hm) => {
          if (!cancelled && hm) setHeatmap(hm);
        })
        .catch(() => null);
    };
    const narrow =
      typeof window !== "undefined" && window.matchMedia("(max-width: 768px)").matches;
    const idleTimeout = narrow ? 6000 : 2500;
    const fallbackDelay = narrow ? 1800 : 400;

    let idleId: number | undefined;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    if (typeof window !== "undefined" && "requestIdleCallback" in window) {
      idleId = window.requestIdleCallback(() => loadHeatmap(), { timeout: idleTimeout });
    } else {
      timeoutId = globalThis.setTimeout(loadHeatmap, fallbackDelay);
    }

    return () => {
      cancelled = true;
      if (idleId != null && "cancelIdleCallback" in window) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId != null) globalThis.clearTimeout(timeoutId);
    };
  }, []);

  const spiderLive = stationsAreSpiderAuthoritative(stations);
  const liveCounts = useMemo(() => {
    if (spiderLive) {
      return countSpiderLiveStationStatuses(stations) ?? countLiveStationStatuses(stations);
    }
    return countLiveStationStatuses(stations);
  }, [stations, spiderLive]);
  const displayHeatmap = useMemo(
    () => mergeTecHeatmapWithStations(heatmap, stations),
    [heatmap, stations],
  );
  const ntripProbedAt =
    stations.find((s) => s.ntrip_probed_at)?.ntrip_probed_at ?? null;

  return (
    <div id="cors-network" className="sw-cors-map-section home-cors-map-section">
      <CorsMapWithLayers
        stations={stations}
        height={height}
        riskLevel={riskLevel}
        liveCounts={liveCounts}
        ntripProbedAt={ntripProbedAt}
        stationsLoading={stationsLoading && stations.length === 0}
        heatmap={displayHeatmap}
      />
    </div>
  );
}
