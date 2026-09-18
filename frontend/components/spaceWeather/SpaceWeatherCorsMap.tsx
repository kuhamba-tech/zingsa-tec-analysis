"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { getStations, getTecHeatmap } from "@/lib/api";
import {
  countLiveStationStatuses,
  countSpiderLiveStationStatuses,
} from "@/lib/liveStationStatus";
import { peekSpaceWeather, subscribeSpaceWeather } from "@/lib/spaceWeatherStore";
import { peekStations, subscribeStations, stationsAreSpiderAuthoritative } from "@/lib/stationsStore";
import { mergeTecHeatmapWithStations } from "@/lib/tecHeatmapMerge";
import type { Station, TecHeatmapResponse } from "@/lib/types";

const CorsMapWithLayers = dynamic(() => import("@/components/maps/CorsMapWithLayers"), {
  ssr: false,
  loading: () => (
    <div className="home-map-loading" role="status" aria-live="polite">
      <span className="home-map-loading-spinner" aria-hidden="true" />
      <span>Loading interactive CORS map…</span>
    </div>
  ),
});

/**
 * Zimbabwe CORS Network map — placed after local ionosphere observations and
 * before Solar Drivers on Live Space Weather (and home when embedded there).
 */
export default function SpaceWeatherCorsMap({ height = 440 }: { height?: number }) {
  const [stations, setStations] = useState<Station[]>(() => peekStations());
  const [stationsLoading, setStationsLoading] = useState(() => peekStations().length === 0);
  const [heatmap, setHeatmap] = useState<TecHeatmapResponse | null>(null);
  const [riskLevel, setRiskLevel] = useState(() => peekSpaceWeather()?.gnss_risk ?? "Low");

  useEffect(() => subscribeStations(setStations), []);
  useEffect(
    () =>
      subscribeSpaceWeather((next) => {
        if (next?.gnss_risk) setRiskLevel(next.gnss_risk);
      }),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    setStationsLoading(peekStations().length === 0);
    Promise.allSettled([getStations(false), getTecHeatmap(0.05, true).catch(() => null)]).then(
      ([st, hm]) => {
        if (cancelled) return;
        if (st.status === "fulfilled") setStations(st.value);
        if (hm.status === "fulfilled" && hm.value) setHeatmap(hm.value);
        setStationsLoading(false);
      },
    );
    return () => {
      cancelled = true;
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
        stationsLoading={stationsLoading}
        heatmap={displayHeatmap}
      />
    </div>
  );
}
