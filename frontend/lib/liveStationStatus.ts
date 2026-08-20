import type { Station } from "@/lib/types";

export type LiveStationStatus = "online" | "offline" | "unavailable";

export interface LiveStationCounts {
  online: number;
  offline: number;
  unavailable: number;
  total: number;
}

/**
 * Map marker status: prefer Spider Site Status from the API.
 * Do not promote NTRIP "connected without MSM" to online — that caused
 * false greens vs Spider (BULA/CHIM/GWER red while caster session still up).
 */
export function getLiveStationStatus(station: Station): LiveStationStatus {
  if (station.status_source === "spider") {
    return station.status === "online" ? "online" : "offline";
  }
  if (station.status_source === "ntrip" || station.status_source === "catalog") {
    if (station.status === "online" || station.status === "linked") return "online";
    if (station.status === "offline") return "offline";
  }
  // Probe verdict is MSM quality, not Spider site status.
  if (station.ntrip_verdict === "msm_streaming") return "online";
  if (station.status === "online" || station.status === "linked") return "online";
  if (station.status === "offline") return "offline";
  return "unavailable";
}

/**
 * Apply a stations snapshot without flicker.
 * Catalog-only fetches must not overwrite live online/offline markers.
 * Keep a site online through brief reconnect gaps unless explicitly offline.
 */
export function mergeStationsPreferLive(
  prev: Station[],
  next: Station[],
  opts?: { nextIsLiveProbe?: boolean; lockLiveStatus?: boolean },
): Station[] {
  if (next.length === 0) return prev.length > 0 ? prev : next;

  const lockLive = Boolean(opts?.lockLiveStatus) && !opts?.nextIsLiveProbe;
  if (lockLive) {
    const prevByCode = new Map(prev.map((s) => [s.code.toLowerCase(), s]));
    return next.map((s) => {
      const old = prevByCode.get(s.code.toLowerCase());
      if (!old) return s;
      // Spider Site Status always wins — never freeze a false green over it.
      if (s.status_source === "spider") return s;
      if (getLiveStationStatus(s) === "online") return s;
      return {
        ...s,
        status: old.status,
        status_source: old.status_source,
        ntrip_verdict: old.ntrip_verdict,
        ntrip_probed_at: old.ntrip_probed_at,
        site_status_label: old.site_status_label ?? s.site_status_label,
        catalog_status: old.catalog_status ?? s.catalog_status,
        current_tec: s.current_tec ?? old.current_tec,
        sourcetable_mismatch: s.sourcetable_mismatch || old.sourcetable_mismatch,
        sourcetable_identifier: s.sourcetable_identifier ?? old.sourcetable_identifier,
        sourcetable_note: s.sourcetable_note ?? old.sourcetable_note,
        connected_rovers: s.connected_rovers ?? old.connected_rovers,
        rover_peak_24h: s.rover_peak_24h ?? old.rover_peak_24h,
        rover_share_pct: s.rover_share_pct ?? old.rover_share_pct,
        rover_rank: s.rover_rank ?? old.rover_rank,
      };
    });
  }

  if (!opts?.nextIsLiveProbe || prev.length === 0) return next;

  const prevByCode = new Map(prev.map((s) => [s.code.toLowerCase(), s]));
  return next.map((s) => {
    const old = prevByCode.get(s.code.toLowerCase());
    if (!old) return s;
    // Spider Site Status is authoritative — never sticky-hold a false green.
    if (s.status_source === "spider" || old.status_source === "spider") return s;

    const wasOnline = getLiveStationStatus(old) === "online";
    const nowOnline = getLiveStationStatus(s) === "online";

    if (nowOnline) return s;
    if (!wasOnline) return s;

    if (s.status === "offline" && (s.status_source === "ntrip" || s.status_source === "spider")) {
      return s;
    }
    if (s.ntrip_verdict === "offline") return s;

    return {
      ...s,
      status: old.status,
      status_source: old.status_source,
      ntrip_verdict: old.ntrip_verdict,
      ntrip_probed_at: s.ntrip_probed_at ?? old.ntrip_probed_at,
      site_status_label: old.site_status_label ?? s.site_status_label,
    };
  });
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

/** Online sites — used for X/24 “CORS Connected” display. */
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
  return `${counts.online}/${counts.total} online · ${down} offline`;
}

/** Shared CORS connected readout — same on home, space weather, dashboard, and live pipeline. */
export function formatCorsConnectedDisplay(counts: LiveStationCounts): CorsConnectedDisplay {
  return {
    value: `${counts.online}/${counts.total}`,
    note: `Online ${counts.online} · Offline ${counts.offline} · Unavailable ${counts.unavailable}`,
    connected: connectedStreamCount(counts),
    total: counts.total,
  };
}
