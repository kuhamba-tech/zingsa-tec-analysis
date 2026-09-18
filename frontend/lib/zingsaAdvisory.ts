/**
 * ZINGSA Navigation News advisory — Zimbabwe GNSS impact intelligence language.
 *
 * Separates global geomagnetic conditions from local ionosphere and GNSS performance.
 * Never invents ΔTEC/ROTI; never equates Kp≥5 with automatic Zimbabwe GNSS failure.
 */
import {
  formatDstDisplay,
  formatKpDisplay,
  formatVtecDisplay,
  noaaGScaleFromKp,
} from "./spaceWeatherMetrics";
import type { ForecastStatus } from "./gnssWeatherIntelligence";
import type { SpaceWeatherCurrent } from "./types";

export interface ZingsaAdvisory {
  /** e.g. "No geomagnetic storm — G0." */
  stormLine: string;
  /** Local ionosphere line — never fabricated ΔTEC/ROTI. */
  ionosphereLine: string;
  /** e.g. "Zimbabwe GNSS Risk: LOW (provisional)" */
  gnssRiskLine: string;
  /** Full advisory block for the bulletin. */
  paragraphs: string[];
  /** Evidence for “Why this status?” */
  evidence: string[];
  tone: ForecastStatus;
}

function riskLabel(sw: SpaceWeatherCurrent | null): string {
  const raw = (sw?.gnss_risk ?? "").trim();
  if (!raw) return "UNAVAILABLE";
  return raw.toUpperCase();
}

function riskTone(sw: SpaceWeatherCurrent | null, gIsStorm: boolean): ForecastStatus {
  const r = (sw?.gnss_risk ?? "").toLowerCase();
  if (r === "critical" || r === "high") return "warning";
  if (r === "moderate") return "moderate";
  // Global storm alone must not force a GNSS warning when local risk is Low.
  if (gIsStorm && r === "low") return "moderate";
  if (gIsStorm) return "moderate";
  return "excellent";
}

/**
 * Build the national ZINGSA advisory shown in Navigation News.
 * Supports the two critical event states:
 *   A) Global G-storm with quiet Zimbabwe GNSS → do not auto-raise GNSS risk
 *   B) G0 with local disturbance → raise local risk when validated local metrics exist
 */
export function buildZingsaAdvisory(sw: SpaceWeatherCurrent | null): ZingsaAdvisory {
  const g = noaaGScaleFromKp(sw?.kp);
  const vtec = sw?.mean_vtec ?? null;
  const risk = riskLabel(sw);
  const tone = riskTone(sw, g.isStorm);

  const stormLine = g.isStorm
    ? `${g.code} — ${g.title} geomagnetic storm detected globally (Kp ${formatKpDisplay(sw?.kp)}).`
    : g.code === "G0" && g.title === "Active"
      ? `No NOAA G1–G5 geomagnetic storm — G0 Active (Kp ${formatKpDisplay(sw?.kp)}, below G1 threshold).`
      : `No geomagnetic storm — ${g.display}${sw?.kp != null ? ` (Kp ${formatKpDisplay(sw.kp)})` : ""}.`;

  let ionosphereLine: string;
  if (vtec == null) {
    ionosphereLine =
      "Zimbabwe ionosphere: live VTEC updating. ΔTEC and ROTI — reference baseline under development (not invented from Kp).";
  } else {
    ionosphereLine =
      `Zimbabwe CORS network VTEC ${formatVtecDisplay(vtec)}. ` +
      `ΔTEC / ROTI not yet classified — quiet-time reference under development. ` +
      `Local ionospheric disturbance is not inferred from planetary Kp alone.`;
  }

  const gnssRiskLine = `Zimbabwe GNSS Risk: ${risk}${risk === "UNAVAILABLE" ? "" : " (provisional until validated local ΔTEC/ROTI/RTK rules)"}`;

  const paragraphs: string[] = [stormLine];

  if (g.isStorm) {
    // Case A pattern: global storm does not automatically mean Zimbabwe GNSS is degraded.
    paragraphs.push(
      `Zimbabwe ionospheric impact: not automatically elevated by a global ${g.code} storm. ${ionosphereLine}`,
    );
    if ((sw?.gnss_risk ?? "").toLowerCase() === "low") {
      paragraphs.push(
        "GNSS performance indicators available so far remain consistent with largely normal operations. A geomagnetic storm does not automatically mean Zimbabwe GNSS failure.",
      );
    } else {
      paragraphs.push(
        "Check Zimbabwe CORS VTEC, sector advisories, and RTK/CORS health before postponing precision work — do not use NOAA G-scale alone.",
      );
    }
  } else {
    // Case B awareness: quiet global conditions can still host local post-sunset irregularities.
    paragraphs.push(ionosphereLine);
    paragraphs.push(
      "Local/regional ionospheric irregularities can occur during G0 conditions (especially post-sunset). Validated ΔTEC/ROTI will flag those cases; they are not invented here.",
    );
  }

  paragraphs.push(gnssRiskLine);

  const evidence: string[] = [];
  if (sw?.kp != null) evidence.push(`Kp ${formatKpDisplay(sw.kp)} → ${g.display}`);
  if (sw?.dst != null) evidence.push(`Dst ${formatDstDisplay(sw.dst)} (magnetospheric context, not G-scale)`);
  if (vtec != null) evidence.push(`Network VTEC ${formatVtecDisplay(vtec)}`);
  else evidence.push("Network VTEC unavailable");
  evidence.push("ΔTEC: reference baseline under development");
  evidence.push("ROTI: unavailable until validated sampling window");
  if (sw?.s4 != null) evidence.push(`S4 ${sw.s4.toFixed(2)} (scintillation archive)`);
  if (sw?.gnss_risk) evidence.push(`Provisional GNSS risk label: ${sw.gnss_risk}`);
  if (sw?.stations_online != null && sw?.stations_total) {
    evidence.push(`CORS online ${sw.stations_online}/${sw.stations_total}`);
  }
  evidence.push(
    "Chain: Sun → solar wind → IMF coupling → magnetosphere → Zimbabwe ionosphere → GNSS performance → user impact → ZINGSA advisory",
  );

  return {
    stormLine,
    ionosphereLine,
    gnssRiskLine,
    paragraphs,
    evidence,
    tone,
  };
}
