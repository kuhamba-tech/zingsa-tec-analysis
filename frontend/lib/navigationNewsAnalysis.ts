import type { ChartAnalysisBlock } from "./multiSourceChartAnalysis";
import type { NavigationNewsBrief } from "./gnssAudienceNews";
import { effectiveNavigationTone, spaceWeatherFloor } from "./gnssAudienceNews";
import type { GnssForecastCity } from "./gnssWeatherIntelligence";
import type { GnssForecastBundle } from "./gnssForecastEngine";
import type { SpaceWeatherCurrent } from "./types";
import { formatVtecDisplay, noaaGScaleFromKp } from "./spaceWeatherMetrics";
import { buildZingsaAdvisory } from "./zingsaAdvisory";

function fmt(v: number | null | undefined, digits = 1, suffix = ""): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return `${v.toFixed(digits)}${suffix}`;
}

function isStormIndices(sw: SpaceWeatherCurrent | null): boolean {
  if (!sw) return false;
  return (sw.kp != null && sw.kp >= 5) || (sw.dst != null && sw.dst <= -50);
}

const AUDIENCE_PRIORITY: Record<NavigationNewsBrief["id"], string> = {
  surveyor: "highest precision need — RTK and cm-level work fails first when local ionosphere or S4 rises",
  aviation: "RNAV/GPS approaches and BVLOS drones — confirm with local evidence, not G-scale alone",
  farmer: "autosteer and field mapping — needs continuous RTK; pauses cost planting/harvest windows",
  driver: "ride-hailing and fleet routing — metre-level phone GPS can degrade before survey-grade kit",
  citizen: "everyday maps and emergency location — usually tolerates brief wobble unless local GNSS is degraded",
  scientist: "research and QC — TEC gradients, CORS residuals, and storm tags need careful review",
};

export function analyzeNavigationNewsSection(
  bundle: GnssForecastBundle,
  sw: SpaceWeatherCurrent | null,
): ChartAnalysisBlock {
  const briefs = bundle.audienceNews;
  const forecasts = bundle.forecasts;
  if (!briefs.length) {
    return {
      lead: "Navigation News is Zimbabwe GNSS impact intelligence — not a generic space-weather dashboard.",
      bullets: ["Load live Kp, Dst, VTEC, S4, and CORS data to generate the ZINGSA advisory."],
    };
  }

  const tone = briefs[0]?.statusTone ?? "excellent";
  const swFloor = spaceWeatherFloor(sw);
  const forecastOnly = forecasts.some((f) => f.status === "warning")
    ? "warning"
    : forecasts.some((f) => f.status === "moderate")
      ? "moderate"
      : "excellent";
  const storm = isStormIndices(sw);
  const g = noaaGScaleFromKp(sw?.kp);
  const kp = sw?.kp;
  const dst = sw?.dst;
  const s4 = sw?.s4;
  const risk = sw?.gnss_risk;
  const vtec = sw?.mean_vtec;
  const advisory = buildZingsaAdvisory(sw);

  const bullets: string[] = [
    "Architecture: Sun → solar wind → IMF coupling → magnetosphere (G-scale) → Zimbabwe ionosphere → GNSS performance → user impact → ZINGSA advisory.",
    "Geomagnetic storm ≠ automatic Zimbabwe ionospheric disturbance. Ionospheric disturbance ≠ automatic GNSS failure.",
    ...advisory.paragraphs,
  ];

  if (kp != null || dst != null || s4 != null) {
    bullets.push(
      `Evidence now: ${g.display}, Dst ${fmt(dst, 0)} nT, S4 ${fmt(s4, 2)}, provisional GNSS risk ${risk ?? "n/a"}${vtec != null ? `, network VTEC ${formatVtecDisplay(vtec)}` : ""}. ΔTEC/ROTI not invented.`,
    );
  }

  if (storm) {
    bullets.push(
      `Global ${g.code} conditions are present (Kp ≥ 5 and/or storm-time Dst). That is planetary context — Zimbabwe GNSS risk stays provisional until local ΔTEC/ROTI/RTK rules are validated.`,
    );
    if (swFloor === "warning") {
      bullets.push(
        "Briefs are elevated because strong planetary thresholds were crossed and/or provisional GNSS risk is high — still cross-check CORS/VTEC.",
      );
    }
  } else if (tone === "excellent") {
    bullets.push(
      "No NOAA G1–G5 storm and regional outlook is quiet — still remember local post-sunset irregularities can occur during G0.",
    );
  } else {
    bullets.push(
      "Conditions are disturbed without a classic G1+ storm — possible local/regional impact; do not require Kp ≥ 5 to take local CORS evidence seriously.",
    );
  }

  if (storm && forecastOnly === "excellent" && (risk ?? "").toLowerCase() === "low") {
    bullets.push(
      "Case A pattern: global storm with quiet provisional GNSS risk — do not auto-raise Zimbabwe GNSS to HIGH from G-scale alone.",
    );
  }

  if (forecasts.length) {
    const regional = forecasts
      .map((f) => `${f.city.replace("VICTORIA FALLS", "Vic Falls")}: ${f.statusLabel}`)
      .join("; ");
    bullets.push(`Regional GNSS outlook: ${regional}.`);
  }

  if (bundle.sources) {
    const parts = [
      bundle.sources.spaceWeather ? "NOAA space weather" : null,
      bundle.sources.corsStations ? "CORS stations" : null,
      bundle.sources.ntripProbe ? "NTRIP probe" : null,
    ].filter(Boolean);
    bullets.push(`Sources: ${parts.join(", ") || "updating"}. ${bundle.inputSummary}`);
  }

  return {
    lead: advisory.stormLine,
    bullets,
  };
}

export function analyzeNavigationNewsBrief(
  brief: NavigationNewsBrief,
  sw: SpaceWeatherCurrent | null,
  forecasts: GnssForecastCity[],
): ChartAnalysisBlock {
  const kp = sw?.kp;
  const dst = sw?.dst;
  const s4 = sw?.s4;
  const storm = isStormIndices(sw);
  const g = noaaGScaleFromKp(kp);
  const expectedTone = effectiveNavigationTone(forecasts, sw);
  const bullets: string[] = [];

  bullets.push(
    `Global geomagnetic status: ${g.display}. This does not by itself classify Zimbabwe ionosphere or GNSS.`,
  );

  if (storm && brief.statusTone === "excellent") {
    bullets.push(
      "Case A awareness: planetary storm indices are active while this sector still reads quiet — trust local CORS/VTEC/RTK evidence over G-scale alone.",
    );
  } else if (storm) {
    bullets.push(
      `This ${brief.audience.toLowerCase()} brief is ${brief.statusTone === "warning" ? "on alert" : "cautionary"} with ${g.code} context — confirm with Zimbabwe observations.`,
    );
  } else {
    bullets.push(
      `This brief is ${brief.statusTone === "warning" ? "on alert" : brief.statusTone === "moderate" ? "cautionary" : "reassuring"} — aligned with ${expectedTone} national tone. Local irregularities can still occur at G0.`,
    );
  }

  bullets.push(AUDIENCE_PRIORITY[brief.id]);

  if (brief.spaceWeatherBullets.length) {
    bullets.push(`Evidence quoted in the brief: ${brief.spaceWeatherBullets.slice(0, 3).join("; ")}.`);
  }

  const cityHint =
    forecasts.find((f) => f.status === "warning") ?? forecasts.find((f) => f.status === "moderate");
  if (cityHint) {
    bullets.push(
      `Regional signal: ${cityHint.city} ${cityHint.statusLabel}${cityHint.cause ? ` (${cityHint.cause})` : ""}.`,
    );
  }

  if (kp != null && kp >= 5) {
    bullets.push(
      `${g.display} (Kp ${fmt(kp)}) is global storm context — ${
        brief.id === "surveyor" || brief.id === "farmer"
          ? "verify RTK/autosteer with local CORS health before postponing"
          : brief.id === "aviation"
            ? "verify navaid backups if local GNSS degrades"
            : brief.id === "scientist"
              ? "flag CORS arcs and widen TEC product uncertainty when local metrics support it"
              : "expect possible map/route errors if local ionosphere is disturbed"
      }.`,
    );
  }
  if (dst != null && dst <= -50) {
    bullets.push(`Dst ${fmt(dst, 0)} nT is magnetospheric ring-current context, not a NOAA G-scale label.`);
  }
  if (s4 != null && s4 >= 0.3) {
    bullets.push(`S4 ${fmt(s4, 2)} — scintillation can break carrier-phase GPS locally even without G1+.`);
  }

  bullets.push(`Action: ${brief.action}`);

  const lead =
    storm && brief.statusTone !== "warning"
      ? `${brief.headline} — global ${g.code} is context; decide from Zimbabwe evidence.`
      : brief.headline;

  return { lead, bullets };
}
