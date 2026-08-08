import type { Station } from "@/lib/types";

export type LiveStationStatus = "online" | "offline" | "unavailable";

export interface LiveStationCounts {
  online: number;
  offline: number;
  unavailable: number;
  total: number;
}

/**
 * Online only when MSM is streaming to us. Connected-but-silent (no MSM / no
 * RTCM) is offline — no data ⇒ down.
 */
export function getLiveStationStatus(station: Station): LiveStationStatus {
  switch (station.ntrip_verdict) {
    case "msm_streaming":
      return "online";
    case "rtcm_no_msm":
    case "connected_no_data":
    case "offline":
      return "offline";
    default:
      if (station.status_source === "ntrip") {
        return station.status === "online" ? "online" : "offline";
      }
      return "unavailable";
  }
}

export function countLiveStationStatuses(stations: Station[], expectedTotal = 24): LiveStationCounts {
  const counts: LiveStationCounts = {
    online: 0,
    offline: 0,
    unavailable: 0,
    total: stations.length || expectedTotal,
  };

  for (const station of stations) counts[getLiveStationStatus(station)] += 1;
  if (stations.length === 0) counts.unavailable = expectedTotal;

  return counts;
}

/** Stations actively streaming MSM — used for X/24 “CORS Connected” display. */
export function connectedStreamCount(counts: LiveStationCounts): number {
  return counts.online;
}

export interface CorsConnectedDisplay {
  value: string;
  note: string;
  connected: number;
  total: number;
}

/** Compact one-line CORS status for home metric cards. */
export function formatCorsConnectedShort(counts: LiveStationCounts): string {
  const down = counts.offline + counts.unavailable;
  return `${counts.online}/${counts.total} streaming · ${down} offline`;
}

/** Shared CORS connected readout — same on home, space weather, dashboard, and live pipeline. */
export function formatCorsConnectedDisplay(counts: LiveStationCounts): CorsConnectedDisplay {
  return {
    value: `${counts.online}/${counts.total}`,
    note: `Streaming ${counts.online} · Offline ${counts.offline} · Unavailable ${counts.unavailable}`,
    connected: connectedStreamCount(counts),
    total: counts.total,
  };
}
