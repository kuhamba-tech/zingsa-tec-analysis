/**
 * Top-of-dashboard Space Weather Event Summary for Zimbabwe.
 * Causal chain language — never invents ΔTEC/ROTI or claims flare→GNSS causation.
 */
import type { SolarActivityFull, SpaceWeatherCurrent } from "./types";
import type { ForecastStatus } from "./gnssWeatherIntelligence";
import {
  formatBzDisplay,
  formatDstDisplay,
  formatFlareClassDisplay,
  formatKpDisplay,
  formatSolarWindDisplay,
  formatSouthwardDuration,
  formatVtecDisplay,
  noaaGScaleFromKp,
} from "./spaceWeatherMetrics";

export type ChainStageStatus = "NORMAL" | "ELEVATED" | "DISTURBED" | "UNAVAILABLE" | "STORM" | "ACTIVE";

export interface ChainStage {
  id: string;
  label: string;
  detail: string;
  status: ChainStageStatus;
}

export interface SpaceWeatherEventSummary {
  title: string;
  globalHeadline: string;
  globalBody: string;
  ionosphereHeadline: string;
  ionosphereBody: string;
  gnssHeadline: string;
  gnssBody: string;
  caveat: string;
  updatedLabel: string;
  tone: ForecastStatus;
  stages: ChainStage[];
}

function windInterpretation(speed: number | null): string {
  if (speed == null) return "unavailable";
  if (speed < 350) return "slow";
  if (speed < 450) return "typical";
  if (speed < 550) return "enhanced";
  if (speed < 700) return "fast";
  return "very fast";
}

function formatCatFromUtc(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return iso.slice(0, 16).replace("T", " ") + " UTC";
  }
  // Zimbabwe is CAT (UTC+2) year-round.
  const cat = new Date(d.getTime() + 2 * 60 * 60 * 1000);
  const dd = String(cat.getUTCDate()).padStart(2, "0");
  const mon = cat.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  const hh = String(cat.getUTCHours()).padStart(2, "0");
  const mm = String(cat.getUTCMinutes()).padStart(2, "0");
  return `${dd} ${mon} ${hh}:${mm} CAT`;
}

function gnssTone(sw: SpaceWeatherCurrent | null, gIsStorm: boolean): ForecastStatus {
  const r = (sw?.gnss_risk ?? "").toLowerCase();
  if (r === "critical" || r === "high") return "warning";
  if (r === "moderate") return "moderate";
  if (gIsStorm && r === "low") return "excellent"; // Case A: storm but limited local GNSS impact
  if (gIsStorm) return "moderate";
  return "excellent";
}

function ionosphereStatus(vtec: number | null): ChainStageStatus {
  if (vtec == null) return "UNAVAILABLE";
  // Absolute VTEC alone is not disturbance — stay NORMAL until ΔTEC/ROTI exist.
  return "NORMAL";
}

function gnssStatus(sw: SpaceWeatherCurrent | null): ChainStageStatus {
  const r = (sw?.gnss_risk ?? "").toLowerCase();
  if (!r) return "UNAVAILABLE";
  if (r === "critical" || r === "high") return "DISTURBED";
  if (r === "moderate") return "ELEVATED";
  return "NORMAL";
}

export function buildSpaceWeatherEventSummary(
  sw: SpaceWeatherCurrent | null,
  solar: SolarActivityFull | null = null,
): SpaceWeatherEventSummary {
  const g = noaaGScaleFromKp(sw?.kp);
  const wind = sw?.plasma_speed ?? solar?.solar_wind?.speed ?? null;
  const bz = solar?.solar_wind?.bz ?? null;
  const south = formatSouthwardDuration(solar?.solar_wind?.southward_duration_minutes);
  const flare = formatFlareClassDisplay(solar?.flare_class);
  const vtec = sw?.mean_vtec ?? null;
  const dst = sw?.dst ?? null;
  const risk = (sw?.gnss_risk ?? "").trim();
  const tone = gnssTone(sw, g.isStorm);
  const updated =
    formatCatFromUtc(sw?.updated_utc) ??
    formatCatFromUtc(solar?.updated) ??
    "Updating…";

  const windBits: string[] = [];
  if (wind != null) {
    windBits.push(`solar wind is ${windInterpretation(wind)} at ${formatSolarWindDisplay(wind)}`);
  }
  if (bz != null) {
    const orient = bz < 0 ? "southward" : bz > 0 ? "northward" : "near-zero";
    windBits.push(`IMF Bz ${formatBzDisplay(bz)} (${orient})`);
    if (south && bz < 0) windBits.push(south.replace(/^Southward duration:\s*/i, "southward for "));
  }

  let globalHeadline: string;
  let globalBody: string;
  if (g.isStorm) {
    globalHeadline = `${g.code} ${g.title} Geomagnetic Storm`;
    globalBody =
      (windBits.length
        ? `${windBits.join(", ")}. `
        : "") +
      `Global geomagnetic activity has reached Kp ${formatKpDisplay(sw?.kp)} (${g.display}).` +
      (dst != null ? ` Dst ${formatDstDisplay(dst)} provides magnetospheric ring-current context.` : "");
  } else if (g.code === "G0" && g.title === "Active") {
    globalHeadline = "G0 — Active (below G1 storm threshold)";
    globalBody =
      (windBits.length ? `${windBits.join(", ")}. ` : "") +
      `Kp ${formatKpDisplay(sw?.kp)} is active but below the NOAA G1 threshold (Kp ≥ 5).` +
      (flare !== "N/A" ? ` Current GOES X-ray class ${flare} is solar emission context, not a storm rating.` : "");
  } else {
    globalHeadline = g.display === "N/A" ? "Geomagnetic Status Unavailable" : `${g.display}`;
    globalBody =
      (windBits.length ? `${windBits.join(", ")}. ` : "") +
      (sw?.kp != null
        ? `No NOAA G1–G5 geomagnetic storm (Kp ${formatKpDisplay(sw.kp)}).`
        : "Kp feed unavailable.") +
      (flare !== "N/A" ? ` GOES flare class ${flare}.` : "");
  }

  let ionosphereHeadline: string;
  let ionosphereBody: string;
  if (vtec == null) {
    ionosphereHeadline = "Zimbabwe Ionosphere: Updating";
    ionosphereBody =
      "Live CORS VTEC is not yet available. ΔTEC and ROTI remain unavailable — quiet-time reference baseline under development. Local disturbance is never inferred from Kp alone.";
  } else if (g.isStorm && (risk || "").toLowerCase() === "low") {
    ionosphereHeadline = "Zimbabwe Ionosphere: No automatic disturbance from global storm";
    ionosphereBody =
      `Network VTEC ${formatVtecDisplay(vtec)}. ΔTEC% and ROTI are not yet classified against a validated quiet-time reference. ` +
      `A global ${g.code} storm does not by itself mean Zimbabwe's ionosphere is disturbed.`;
  } else {
    ionosphereHeadline = "Zimbabwe Ionosphere: Observation available — classification pending";
    ionosphereBody =
      `Network VTEC ${formatVtecDisplay(vtec)}. ` +
      `ΔTEC and ROTI thresholds require station × local-time × season baselines from the CORS network — not arbitrary global cut-offs. ` +
      `Local post-sunset irregularities can still occur during G0 conditions once those products are validated.`;
  }

  let gnssHeadline: string;
  let gnssBody: string;
  const riskUp = risk ? risk.toUpperCase() : "UNAVAILABLE";
  if (!risk) {
    gnssHeadline = "GNSS Impact: Unavailable";
    gnssBody =
      "Provisional GNSS risk label not yet available. RTK fix rate, cycle slips, and positioning error products are the next validation layer.";
  } else if (g.isStorm && risk.toLowerCase() === "low") {
    gnssHeadline = "GNSS Impact: Limited observed impact over Zimbabwe";
    gnssBody =
      `${g.code} geomagnetic storm — limited observed GNSS impact over Zimbabwe so far (provisional risk ${riskUp}). ` +
      `Do not turn operations red from G-scale alone; confirm with CORS health and future RTK/fix-of-lock metrics.`;
  } else if (risk.toLowerCase() === "low") {
    gnssHeadline = "GNSS Impact: Low (provisional)";
    gnssBody =
      "Available indicators are consistent with largely normal positioning. Sector users should still treat this as provisional until local ΔTEC/ROTI/RTK rules are validated.";
  } else if (risk.toLowerCase() === "moderate") {
    gnssHeadline = "GNSS Impact: Moderate (provisional)";
    gnssBody =
      "Provisional risk is elevated. Precision users should verify RTK fixes and CORS health. This is not automatically caused by any single solar flare observation.";
  } else {
    gnssHeadline = `GNSS Impact: ${riskUp} (provisional)`;
    gnssBody =
      "Elevated provisional GNSS risk. Confirm with Zimbabwe CORS observations before critical operations. Event association requires the full evidence chain, not temporal coincidence alone.";
  }

  const caveat =
    "Association language only: “associated with / coincident with / conditions favourable for” until the evidence chain (solar event → L1 → sustained Bz → storm → Zimbabwe TEC anomaly → GNSS degradation) is complete. Causation is not claimed from a flare and a later ROTI rise alone.";

  const stages: ChainStage[] = [
    {
      id: "sun",
      label: "Sun",
      detail: flare === "N/A" ? "GOES X-ray updating" : `Flare ${flare}`,
      status: flare === "N/A" ? "UNAVAILABLE" : flare.startsWith("M") || flare.startsWith("X") ? "ELEVATED" : "NORMAL",
    },
    {
      id: "wind",
      label: "Solar wind / L1",
      detail: wind != null ? formatSolarWindDisplay(wind) : "Updating",
      status: wind == null ? "UNAVAILABLE" : wind >= 550 ? "ELEVATED" : "NORMAL",
    },
    {
      id: "imf",
      label: "IMF / coupling",
      detail: bz != null ? `${formatBzDisplay(bz)}${bz < 0 ? " south" : ""}` : "Updating",
      status: bz == null ? "UNAVAILABLE" : bz <= -10 ? "DISTURBED" : bz < 0 ? "ELEVATED" : "NORMAL",
    },
    {
      id: "magnetosphere",
      label: "Magnetosphere",
      detail: g.display,
      status: g.isStorm ? "STORM" : g.title === "Active" ? "ACTIVE" : g.display === "N/A" ? "UNAVAILABLE" : "NORMAL",
    },
    {
      id: "iono",
      label: "Zimbabwe ionosphere",
      detail: vtec != null ? formatVtecDisplay(vtec) : "VTEC updating",
      status: ionosphereStatus(vtec),
    },
    {
      id: "gnss",
      label: "GNSS performance",
      detail: risk ? `Risk ${riskUp}` : "Provisional",
      status: gnssStatus(sw),
    },
    {
      id: "sectors",
      label: "Sector impact",
      detail: "See Navigation News",
      status: tone === "warning" ? "DISTURBED" : tone === "moderate" ? "ELEVATED" : "NORMAL",
    },
    {
      id: "advisory",
      label: "Advisory",
      detail: "ZINGSA",
      status: tone === "warning" ? "DISTURBED" : tone === "moderate" ? "ELEVATED" : "NORMAL",
    },
  ];

  return {
    title: "CURRENT SPACE WEATHER — ZIMBABWE",
    globalHeadline,
    globalBody,
    ionosphereHeadline,
    ionosphereBody,
    gnssHeadline,
    gnssBody,
    caveat,
    updatedLabel: `Updated: ${updated}`,
    tone,
    stages,
  };
}
