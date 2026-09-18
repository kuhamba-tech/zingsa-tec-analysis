/** User-facing labels for live VTEC source / failure states. */

export type LiveVtecSourceKind = "live" | "estimate" | "none" | "stale";

export function liveVtecSourceFromHeatmap(
  source: string | null | undefined,
  obsCount?: number | null,
): LiveVtecSourceKind {
  if (/estimate|interpolated|surface/i.test(source ?? "")) return "estimate";
  if ((obsCount ?? 0) > 0 && /live/i.test(source ?? "")) return "live";
  if ((obsCount ?? 0) > 0) return "live";
  return "none";
}

export function liveVtecSourceLabel(kind: LiveVtecSourceKind): string {
  switch (kind) {
    case "live":
      return "Live NTRIP (measured)";
    case "estimate":
      return "Interpolated estimate (no direct obs)";
    case "stale":
      return "Stale — refresh pending";
    default:
      return "No live VTEC";
  }
}

export function liveVtecBlockerLabel(blocker: string | null | undefined): string {
  switch (blocker) {
    case "awaiting_gps_ephemeris":
      return "Connected — waiting for GPS ephemeris";
    case "msm_without_vtec_decode":
      return "MSM received — VTEC decode pending";
    case "ntrip_connected_no_msm":
      return "NTRIP connected — no MSM yet";
    case "no_recent_vtec_in_db":
      return "Stream active — no recent DB rows";
    case "no_recent_observations":
      return "No recent observations";
    default:
      return blocker ? blocker.replace(/_/g, " ") : "Unknown";
  }
}

export function liveVtecHealthBannerText(health: {
  live_available: boolean;
  degraded: boolean;
  message?: string | null;
  degraded_reason?: string | null;
  stations_with_fresh_vtec?: number;
  newest_obs_age_s?: number | null;
  collector_running?: boolean;
  collector_expected?: boolean;
}): { tone: "ok" | "warn" | "alert"; text: string } {
  if (health.live_available) {
    const age =
      health.newest_obs_age_s != null ? ` · newest ${Math.round(health.newest_obs_age_s)}s ago` : "";
    return {
      tone: "ok",
      text:
        health.message ??
        `Live NTRIP VTEC on ${health.stations_with_fresh_vtec ?? 0} site(s)${age}`,
    };
  }
  if (!health.collector_running && health.collector_expected) {
    return {
      tone: "alert",
      text:
        health.degraded_reason ??
        "Live VTEC unavailable — NTRIP collector is not running. Run ./scripts/run_local_live.sh",
    };
  }
  return {
    tone: "warn",
    text:
      health.degraded_reason ??
      health.message ??
      "Live NTRIP VTEC not available — waiting for MSM observations and ephemeris.",
  };
}
