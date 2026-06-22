import type { Station } from "@/lib/types";

export type LiveStationStatus = "online" | "degraded" | "offline" | "unavailable";

export interface LiveStationCounts {
  online: number;
  degraded: number;
  offline: number;
  unavailable: number;
  total: number;
}

export function getLiveStationStatus(station: Station): LiveStationStatus {
  switch (station.ntrip_verdict) {
    case "msm_streaming":
      return "online";
    case "rtcm_no_msm":
    case "connected_no_data":
      return "degraded";
    case "offline":
      return "offline";
    default:
      if (
        station.status_source === "ntrip" &&
        (station.status === "online" || station.status === "degraded" || station.status === "offline")
      ) {
        return station.status;
      }
      return "unavailable";
  }
}

export function countLiveStationStatuses(stations: Station[], expectedTotal = 24): LiveStationCounts {
  const counts: LiveStationCounts = {
    online: 0,
    degraded: 0,
    offline: 0,
    unavailable: 0,
    total: stations.length || expectedTotal,
  };

  for (const station of stations) counts[getLiveStationStatus(station)] += 1;
  if (stations.length === 0) counts.unavailable = expectedTotal;

  return counts;
}
