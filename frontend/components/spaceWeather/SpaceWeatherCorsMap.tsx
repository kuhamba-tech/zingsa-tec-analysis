"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { getStations } from "@/lib/api";
import { ensureLiveTecHeatmap, peekTecHeatmap, subscribeTecHeatmap } from "@/lib/tecHeatmapStore";
import { getLoadProfile, scheduleSecondary } from "@/lib/loadBudget";
import { loadCorsMapWithLayers } from "@/lib/loadCorsMapWithLayers";
import {
  countLiveStationStatuses,
  countSpiderLiveStationStatuses,
} from "@/lib/liveStationStatus";
import { peekSpaceWeather, subscribeSpaceWeather } from "@/lib/spaceWeatherStore";
import { peekStations, subscribeStations, stationsAreSpiderAuthoritative, stationsAreLiveAuthoritative } from "@/lib/stationsStore";
import { mergeTecHeatmapWithStations } from "@/lib/tecHeatmapMerge";
import { corsRegistryStations } from "@/lib/corsStationCatalog";
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
    if (w <= 560) return 360;
    if (w <= 768) return 400;
    return preferred;
  });

  useEffect(() => {
    const apply = () => {
      const w = window.innerWidth;
      if (w <= 560) setHeight(360);
      else if (w <= 768) setHeight(400);
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
  const [stations, setStations] = useState<Station[]>(() => {
    const cached = peekStations();
    // Plot known sites immediately. Live Spider/NTRIP replaces these rows.
    return cached.length ? cached : corsRegistryStations();
  });
  const [stationsLoading, setStationsLoading] = useState(() => peekStations().length === 0);
  const [statusNote, setStatusNote] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [heatmap, setHeatmap] = useState<TecHeatmapResponse | null>(() => peekTecHeatmap());
  const [riskLevel, setRiskLevel] = useState(() => peekSpaceWeather()?.gnss_risk ?? "Low");

  useEffect(() => subscribeStations((next) => {
    if (next.length) {
      setStations(next);
      setStationsLoading(false);
      setStatusNote(null);
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
    let inFlight = false;
    const cached = peekStations();
    if (cached.length) {
      setStations(cached);
      setStationsLoading(false);
    }

    // Markers first — same /cors/stations feed the metric cards already use.
    const applyLive = (rows: Station[]) => {
      if (cancelled) return;
      const live = stationsAreLiveAuthoritative(rows);
      if (live) {
        setStations(rows);
        setStationsLoading(false);
        setStatusNote(null);
      } else {
        setStationsLoading(false);
        setStatusNote("Live station status is still loading. Site locations are shown; colours will update automatically.");
      }
    };
    const pull = () => {
      if (cancelled || inFlight) return;
      inFlight = true;
      getStations(false).then(applyLive).catch(() => {
        if (!cancelled) {
          setStationsLoading(false);
          setStatusNote("Station status could not be refreshed. Retrying automatically; grey sites do not mean they are offline.");
        }
      }).finally(() => { inFlight = false; });
    };
    pull();
    // Registry dots stay up immediately. Replace them once Spider/NTRIP answers.
    const liveTimer = window.setInterval(() => {
      if (!document.hidden) pull();
    }, 15_000);
    const onVisible = () => { if (!document.hidden) pull(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", pull);

    // Station markers use /cors/stations. TEC grid is optional overlay — defer
    // until after first paint so a slow heatmap cannot starve the map chunk.
    const cancelHeat = scheduleSecondary(() => {
      if (!cancelled) ensureLiveTecHeatmap();
    }, getLoadProfile());
    const unsubscribeHeatmap = subscribeTecHeatmap((next) => {
      if (!cancelled && next) setHeatmap(next);
    });
    const cachedHeatmap = peekTecHeatmap();
    if (cachedHeatmap) setHeatmap(cachedHeatmap);

    return () => {
      cancelled = true;
      window.clearInterval(liveTimer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", pull);
      cancelHeat();
      unsubscribeHeatmap();
    };
  }, [retry]);

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
      {statusNote && (
        <div className="banner banner-info" role="status">
          {statusNote}{" "}
          <button type="button" className="btn" onClick={() => setRetry(value => value + 1)}>Refresh station status</button>
        </div>
      )}
      <CorsMapWithLayers
        stations={stations}
        height={height}
        riskLevel={riskLevel}
        liveCounts={liveCounts}
        ntripProbedAt={ntripProbedAt}
        stationsLoading={stationsLoading && stations.length === 0}
        heatmap={displayHeatmap}
        initialLayer="TEC Heat Map"
      />
    </div>
  );
}
