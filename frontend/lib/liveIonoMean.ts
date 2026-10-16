/**
 * Shared Zimbabwe ionosphere mean — same rule as LocalIonosphereObservations:
 * mean of each station's trusted live VTEC within the freshness window.
 */
import type { LiveStationVtecSeries } from "@/lib/types";
import { trustedLiveVtec } from "@/lib/mergeLiveVtecStations";
import { monitoringFreshness, observationEpoch } from "@/lib/monitoringStatus";

export type LiveIonoMeanSnapshot = {
  mean: number | null;
  contributing: number;
  total: number;
  live: boolean;
  at: number;
};

type Listener = (snap: LiveIonoMeanSnapshot) => void;

let snapshot: LiveIonoMeanSnapshot = {
  mean: null,
  contributing: 0,
  total: 0,
  live: false,
  at: 0,
};
const listeners = new Set<Listener>();

export function computeLiveIonoMean(
  stations: LiveStationVtecSeries[],
  now = Date.now(),
  maxAgeMinutes = 15,
): LiveIonoMeanSnapshot {
  const rows = stations.map((station) => {
    // Match /space-weather/current: ignore near-zero leftovers (≤1 TECU).
    const latest = station.points
      .filter(
        (point) =>
          Number.isFinite(point.vtec_tecu) &&
          point.vtec_tecu > 1.0 &&
          observationEpoch(point.time) !== null,
      )
      .reduce<(typeof station.points)[number] | null>(
        (last, point) =>
          !last || observationEpoch(point.time)! > observationEpoch(last.time)! ? point : last,
        null,
      );
    const status = monitoringFreshness(
      latest?.time,
      now,
      Boolean(latest),
      false,
      maxAgeMinutes,
    );
    const vtec = trustedLiveVtec(station);
    return { latest, status, vtec };
  });
  const fresh = rows.filter((row) => row.status === "LIVE" && row.latest);
  const delayed = rows.filter((row) => row.status === "DELAYED" && row.latest);
  const contributing = fresh.length > 0 ? fresh : delayed;
  const values = contributing
    .map((row) => row.vtec)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  const mean =
    values.length > 0
      ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100
      : null;
  return {
    mean,
    contributing: contributing.length,
    total: rows.length,
    live: fresh.length > 0,
    at: now,
  };
}

export function publishLiveIonoMean(snap: LiveIonoMeanSnapshot): LiveIonoMeanSnapshot {
  snapshot = snap;
  listeners.forEach((listener) => listener(snap));
  return snap;
}

export function publishLiveIonoFromStations(
  stations: LiveStationVtecSeries[],
  now = Date.now(),
): LiveIonoMeanSnapshot {
  return publishLiveIonoMean(computeLiveIonoMean(stations, now));
}

export function peekLiveIonoMean(): LiveIonoMeanSnapshot {
  return snapshot;
}

export function subscribeLiveIonoMean(listener: Listener): () => void {
  listeners.add(listener);
  listener(snapshot);
  return () => {
    listeners.delete(listener);
  };
}
