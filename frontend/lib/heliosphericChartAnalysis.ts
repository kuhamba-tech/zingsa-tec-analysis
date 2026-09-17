import type { ChartAnalysisBlock } from "./multiSourceChartAnalysis";
import type { HeliosphericMonitorResponse } from "./types";

export type HeliosphericPanelId =
  | "overview"
  | "protons"
  | "imf"
  | "solar_wind"
  | "kp";

/** Shared Sun→Earth chain framing for the heliospheric monitor stack. */
export const HELIOSPHERIC_CHAIN_LEAD =
  "These panels put the Sun → solar wind → interplanetary magnetic field → Earth’s magnetosphere chain on one timeline so you can judge whether an ionospheric disturbance is flare-driven, particle-driven, or storm-driven.";

export function analyzeHeliosphericOverview(): ChartAnalysisBlock {
  return {
    lead: HELIOSPHERIC_CHAIN_LEAD,
    bullets: [
      "Read left-to-right in physical order: GOES X-rays (flares), GOES protons (SEP), IMF/Bz and solar-wind speed at L1 (coupling drivers), then Kp (global geomagnetic response).",
      "For Zimbabwe TEC work, do not interpret VTEC alone. Compare local TEC / ΔTEC / ROTI against these drivers plus Dst/SYM-H when available.",
      "Daytime TEC rise over Zimbabwe is often a quiet solar-EUV/diurnal pattern. A storm-time response needs supporting Bz, solar-wind, and Kp/Dst evidence together.",
      "Architecture: GOES X-rays → flare detection; ACE/DSCOVR L1 wind+Bz → coupling; Kp+Dst → geomagnetic state; Zimbabwe CORS → VTEC, ΔTEC, ROT/ROTI, scintillation → local GNSS impact.",
    ],
  };
}

export function analyzeGoesXrayExplanation(opts?: {
  flareClass?: string;
  sampleCount?: number;
  latest?: number | null;
  peak?: number | null;
}): ChartAnalysisBlock {
  const flareClass = opts?.flareClass ?? "Unavailable";
  const liveBits: string[] = [];
  if (opts?.sampleCount) {
    liveBits.push(`${opts.sampleCount} samples in the displayed window`);
  }
  if (opts?.latest != null && Number.isFinite(opts.latest)) {
    liveBits.push(`latest ${opts.latest.toFixed(3)} ×10⁻⁷ W/m²`);
  }
  if (opts?.peak != null && Number.isFinite(opts.peak)) {
    liveBits.push(`peak ${opts.peak.toFixed(3)} ×10⁻⁷ W/m²`);
  }

  return {
    lead: `GOES X-ray flux measures soft X-rays from the Sun and is the standard way to identify and classify solar flares. Current class on this dashboard: ${flareClass}.`,
    bullets: [
      "Flare classes by peak flux (W/m²): A ≈ 10⁻⁸–10⁻⁷, B ≈ 10⁻⁷–10⁻⁶, C ≈ 10⁻⁶–10⁻⁵, M ≈ 10⁻⁵–10⁻⁴, X ≥ 10⁻⁴.",
      "Flare X-rays reach Earth in about 8 minutes. They can rapidly ionise the dayside lower ionosphere, causing HF radio blackouts and sometimes GNSS observation impacts on the sunlit hemisphere.",
      "If TEC jumps at almost the same time as an X-ray flare, investigate a solar-flare / solar-ionospheric response first — do not immediately call it a geomagnetic storm.",
      "X-ray class alone does not quantify GNSS positioning error. Confirm with TEC gradients, S4/ROTI, tracking loss, and residuals.",
      ...(liveBits.length ? [`In this plot: ${liveBits.join("; ")}.`] : []),
    ],
  };
}

export function analyzeProtonFluxPanel(data: HeliosphericMonitorResponse | null): ChartAnalysisBlock {
  const series = data?.protons.series ?? {};
  const channel10 = series[">=10 MeV"] ?? [];
  const vals = channel10.filter((v): v is number => v != null && Number.isFinite(v));
  const peak10 = vals.length ? Math.max(...vals) : null;
  const latest10 = vals.length ? vals[vals.length - 1] : null;

  return {
    lead: "GOES integral proton flux tracks energetic particle intensity at thresholds such as >10, >50, >100 and >500 MeV. A major rise can indicate a solar energetic particle (SEP) event.",
    bullets: [
      "SEP events matter most for satellite radiation, spacecraft electronics, and aviation at high latitudes/altitudes.",
      "For ordinary Zimbabwe VTEC variation this is usually not the first explanatory parameter — use it as supporting context for extreme particle storms, not as a default TEC driver.",
      "Compare timing with X-ray flares and L1 solar-wind/IMF panels: particle enhancements can arrive later than the flare X-ray flash.",
      peak10 != null && latest10 != null
        ? `In the ≥10 MeV channel: latest ${latest10.toFixed(2)} pfu, peak ${peak10.toFixed(2)} pfu over the plotted window.`
        : "No ≥10 MeV samples are available in the current NOAA feed window.",
    ],
  };
}

export function analyzeImfPanel(data: HeliosphericMonitorResponse | null): ChartAnalysisBlock {
  const bz = (data?.imf.bz ?? []).filter((v): v is number => v != null && Number.isFinite(v));
  const latestBz = bz.length ? bz[bz.length - 1] : null;
  const minBz = bz.length ? Math.min(...bz) : null;

  return {
    lead: "Interplanetary Magnetic Field (IMF) near Sun–Earth L1 is one of the most useful panels for GNSS/ionosphere work — especially the GSM Bz component.",
    bullets: [
      "Bz positive (northward) is generally less favourable for strong solar-wind–magnetosphere coupling.",
      "Bz negative (southward) favours magnetic reconnection and energy transfer into Earth’s magnetosphere.",
      "A brief negative Bz is not automatically a geomagnetic storm. Strong, sustained southward Bz (for example ≈ −15 nT for several hours), especially with elevated solar-wind speed/density, deserves far more attention.",
      "Use Bt for overall field strength, By for east–west orientation, and Bz for coupling potential.",
      latestBz != null && minBz != null
        ? `In this plot: latest Bz ${latestBz.toFixed(1)} nT; most southward Bz ${minBz.toFixed(1)} nT.`
        : "No IMF Bz samples are available in the current RTSW window.",
    ],
  };
}

export function analyzeSolarWindPanel(data: HeliosphericMonitorResponse | null): ChartAnalysisBlock {
  const speeds = (data?.solar_wind.speed ?? []).filter((v): v is number => v != null && Number.isFinite(v));
  const densities = (data?.solar_wind.density ?? []).filter((v): v is number => v != null && Number.isFinite(v));
  const temps = (data?.solar_wind.temperature ?? []).filter((v): v is number => v != null && Number.isFinite(v));
  const latest = speeds.length ? speeds[speeds.length - 1] : null;
  const peak = speeds.length ? Math.max(...speeds) : null;
  const latestN = densities.length ? densities[densities.length - 1] : null;
  const latestT = temps.length ? temps[temps.length - 1] : null;

  return {
    lead: "Solar-wind speed, density and proton temperature near L1 describe the plasma stream arriving at Earth — none of them alone determines storm strength.",
    bullets: [
      "Rough speed guide: ~300–400 km/s relatively slow/quiet; ~400–500 moderate; ~500–700 enhanced; >700 very fast.",
      "Density (cm⁻³) and proton temperature (K) help identify shocks/CME sheaths when they jump with speed.",
      "700 km/s with northward Bz may produce much less geomagnetic activity than 600 km/s with sustained Bz ≈ −15 nT.",
      "Do not raise geomagnetic warnings from solar-wind thresholds alone — always cross-check IMF Bz, Kp, and Dst/SYM-H.",
      latest != null
        ? `In this plot: latest speed ${Math.round(latest)} km/s${peak != null ? ` (peak ${Math.round(peak)})` : ""}${latestN != null ? `; density ${latestN.toFixed(1)} cm⁻³` : ""}${latestT != null ? `; proton temp. ${Math.round(latestT).toLocaleString()} K` : ""}.`
        : "No solar-wind plasma samples are available in the current RTSW window.",
    ],
  };
}

export function analyzeKpForecastPanel(data: HeliosphericMonitorResponse | null): ChartAnalysisBlock {
  const observed = (data?.kp.observed ?? []).filter((v): v is number => v != null && Number.isFinite(v));
  const predicted = (data?.kp.predicted ?? []).filter((v): v is number => v != null && Number.isFinite(v));
  const latestObs = observed.length ? observed[observed.length - 1] : null;
  const maxObs = observed.length ? Math.max(...observed) : null;
  const maxPred = predicted.length ? Math.max(...predicted) : null;

  return {
    lead: "Planetary Kp (0–9) summarises global geomagnetic activity. Green bars are observed, amber estimated, cyan NOAA predicted.",
    bullets: [
      "Practical scale: Kp 0–2 quiet; 3 unsettled; 4 active; 5 = G1; 6 = G2; 7 = G3; 8 = G4; 9 = G5.",
      "Kp ≥ 5 indicates geomagnetic-storm conditions on NOAA’s G-scale.",
      "Use Kp to compare the international geomagnetic state with what Zimbabwe CORS TEC / scintillation actually show.",
      "Strongest Zimbabwe storm evidence couples: sustained southward Bz + elevated solar-wind speed + Kp ≥ 5 + falling Dst + TEC departing from the quiet-day baseline.",
      latestObs != null
        ? `Latest observed Kp ${latestObs.toFixed(2)}${maxObs != null ? `; peak observed ${maxObs.toFixed(2)}` : ""}${maxPred != null ? `; peak predicted ${maxPred.toFixed(2)}` : ""}.`
        : "No observed Kp bars are available in the current NOAA forecast product window.",
    ],
  };
}

export function analyzeHeliosphericPanel(
  id: HeliosphericPanelId,
  data: HeliosphericMonitorResponse | null,
): ChartAnalysisBlock {
  switch (id) {
    case "overview":
      return analyzeHeliosphericOverview();
    case "protons":
      return analyzeProtonFluxPanel(data);
    case "imf":
      return analyzeImfPanel(data);
    case "solar_wind":
      return analyzeSolarWindPanel(data);
    case "kp":
      return analyzeKpForecastPanel(data);
  }
}
