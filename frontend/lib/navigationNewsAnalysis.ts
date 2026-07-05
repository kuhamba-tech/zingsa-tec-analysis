import type { ChartAnalysisBlock } from "./multiSourceChartAnalysis";
import type { NavigationNewsBrief } from "./gnssAudienceNews";
import { effectiveNavigationTone, spaceWeatherFloor } from "./gnssAudienceNews";
import type { GnssForecastCity } from "./gnssWeatherIntelligence";
import type { GnssForecastBundle } from "./gnssForecastEngine";
import type { SpaceWeatherCurrent } from "./types";

function fmt(v: number | null | undefined, digits = 1, suffix = ""): string {
  if (v == null || !Number.isFinite(v)) return "n/a";
  return `${v.toFixed(digits)}${suffix}`;
}

function kpStormClass(kp: number): string {
  if (kp >= 9) return "G5 extreme storm";
  if (kp >= 8) return "G4 severe storm";
  if (kp >= 7) return "G3 strong storm";
  if (kp >= 6) return "G2 moderate storm";
  if (kp >= 5) return "G1 minor storm";
  if (kp >= 4) return "active";
  return "quiet";
}

function isStormIndices(sw: SpaceWeatherCurrent | null): boolean {
  if (!sw) return false;
  return (
    (sw.kp != null && sw.kp >= 5) ||
    (sw.dst != null && sw.dst <= -50) ||
    (sw.s4 != null && sw.s4 >= 0.5) ||
    /high|critical/i.test(sw.gnss_risk ?? "")
  );
}

const AUDIENCE_PRIORITY: Record<NavigationNewsBrief["id"], string> = {
  surveyor: "highest precision need — RTK and cm-level work fails first when S4 or Kp rise",
  aviation: "RNAV/GPS approaches and BVLOS drones — high-altitude GNSS and HF links degrade early in storms",
  farmer: "autosteer and field mapping — needs continuous RTK; pauses cost planting/harvest windows",
  driver: "ride-hailing and fleet routing — metre-level phone GPS degrades before survey-grade kit",
  citizen: "everyday maps and emergency location — usually tolerates brief wobble unless storm is severe",
  scientist: "research and QC workflows - TEC gradients, CORS residuals, and storm tags need careful review",
};

export function analyzeNavigationNewsSection(
  bundle: GnssForecastBundle,
  sw: SpaceWeatherCurrent | null,
): ChartAnalysisBlock {
  const briefs = bundle.audienceNews;
  const forecasts = bundle.forecasts;
  if (!briefs.length) {
    return {
      lead: "Navigation News translates live space weather into plain language for Zimbabwe users.",
      bullets: ["Load live Kp, Dst, S4, and CORS data to generate audience briefs."],
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
  const kp = sw?.kp;
  const dst = sw?.dst;
  const s4 = sw?.s4;
  const risk = sw?.gnss_risk;
  const vtec = sw?.mean_vtec;
  const wind = sw?.plasma_speed;

  const bullets: string[] = [
    "All briefs use the same live NOAA/SWPC indices plus ZINGSA CORS health. Tone is the worse of regional GNSS outlook and live Kp/Dst/S4 — a geomagnetic storm cannot read as ‘good news’ just because caster feeds are online.",
  ];

  if (kp != null || dst != null || s4 != null) {
    bullets.push(
      `Live indices now: Kp ${fmt(kp)}${kp != null ? ` (${kpStormClass(kp)})` : ""}, Dst ${fmt(dst, 0)} nT, S4 ${fmt(s4, 2)}, GNSS risk ${risk ?? "n/a"}${vtec != null ? `, mean TEC ${fmt(vtec, 2)} TECU` : ""}${wind != null ? `, solar wind ${fmt(wind, 0)} km/s` : ""}.`,
    );
  }

  if (storm) {
    bullets.push(
      "This is not a ‘good’ navigation day at the planetary level — Kp ≥ 5 and/or Dst ≤ −50 nT means a geomagnetic storm is underway. Phone maps, RTK, and fleet GPS can all degrade even when local CORS sites stay connected.",
    );
    if (swFloor === "warning") {
      bullets.push(
        "Briefs are on warning because indices crossed strong storm thresholds (e.g. Kp ≥ 7, Dst ≤ −100 nT, or Kp ≥ 5 together with Dst ≤ −50 nT).",
      );
    } else {
      bullets.push(
        "Briefs are at least moderate — storm thresholds are met. Precision users (farmers, surveyors) should not treat headlines as ‘all clear’.",
      );
    }
  } else if (tone === "excellent") {
    bullets.push(
      "Indices are below storm thresholds and regional GNSS outlook is excellent — only then is it fair to call today’s navigation news reassuring.",
    );
  } else {
    bullets.push(
      "Conditions are disturbed but below classic storm thresholds — briefs flag moderate impact without a full geomagnetic storm alert.",
    );
  }

  if (storm && forecastOnly === "excellent") {
    bullets.push(
      "Note: regional CORS/NTRIP status alone looked ‘excellent’, but live Kp/Dst forced the news tone up — always trust Kp/Dst/S4 for storms, not only green station icons.",
    );
  }

  if (forecasts.length) {
    const regional = forecasts
      .map((f) => `${f.city.replace("VICTORIA FALLS", "Vic Falls")}: ${f.statusLabel}`)
      .join("; ");
    bullets.push(`Regional GNSS outlook: ${regional}.`);
  }

  bullets.push(
    storm
      ? "Surveyors, aviation, and farmers should delay RTK/autosteer and non-essential drone ops; citizens and drivers should expect wider map pins and slower GPS lock until Kp and Dst recover."
      : "Precision users should still watch afternoon S4 even on calmer days.",
  );

  if (bundle.sources) {
    const parts = [
      bundle.sources.spaceWeather ? "NOAA space weather" : null,
      bundle.sources.corsStations ? "CORS stations" : null,
      bundle.sources.ntripProbe ? "NTRIP probe" : null,
    ].filter(Boolean);
    bullets.push(`Sources: ${parts.join(", ") || "updating"}. ${bundle.inputSummary}`);
  }

  const lead = storm
    ? tone === "warning"
      ? `Navigation News — storm day (not ‘good news’). Kp ${fmt(kp)} and Dst ${fmt(dst, 0)} nT mean positioning problems are likely until conditions ease.`
      : `Navigation News — geomagnetic storm active (Kp ${fmt(kp)}, Dst ${fmt(dst, 0)} nT). Briefs are cautionary even if some headlines sound mild.`
    : tone === "warning"
      ? "Navigation News — regional GNSS warning from CORS/scintillation even without a planetary storm."
      : tone === "moderate"
        ? "Navigation News — mild disturbance. Some GPS wobble possible; not a full storm day."
        : "Navigation News — quiet day. Indices and regional outlook both support normal navigation.";

  return { lead, bullets };
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
  const expectedTone = effectiveNavigationTone(forecasts, sw);
  const bullets: string[] = [];

  if (storm && brief.statusTone === "excellent") {
    bullets.push(
      "Caution: live Kp/Dst show a geomagnetic storm, but this card still reads ‘excellent’ — treat Kp, Dst, and S4 as authoritative over the green tone.",
    );
  } else if (storm) {
    bullets.push(
      `This ${brief.audience.toLowerCase()} brief is ${brief.statusTone === "warning" ? "on alert" : "cautionary"} because Kp/Dst/S4 confirm disturbed conditions — not a ‘good’ navigation day for precision work.`,
    );
  } else {
    bullets.push(
      `This brief is ${brief.statusTone === "warning" ? "on alert" : brief.statusTone === "moderate" ? "cautionary" : "reassuring"} — aligned with ${expectedTone} national tone from live inputs.`,
    );
  }

  bullets.push(AUDIENCE_PRIORITY[brief.id]);

  if (brief.spaceWeatherBullets.length) {
    bullets.push(`Evidence quoted in the brief: ${brief.spaceWeatherBullets.slice(0, 3).join("; ")}.`);
  }

  const cityHint = forecasts.find((f) => f.status === "warning") ?? forecasts.find((f) => f.status === "moderate");
  if (cityHint) {
    bullets.push(
      `Regional signal: ${cityHint.city} ${cityHint.statusLabel}${cityHint.cause ? ` (${cityHint.cause})` : ""}.`,
    );
  }

  if (kp != null && kp >= 5) {
    bullets.push(
      `Kp ${fmt(kp)} = geomagnetic storm — ${
        brief.id === "surveyor" || brief.id === "farmer"
          ? "do not rely on RTK/autosteer today"
          : brief.id === "aviation"
            ? "verify navaid backups and delay BVLOS drone ops"
            : brief.id === "scientist"
              ? "flag CORS arcs and widen TEC product uncertainty"
              : "expect map and route errors"
      }.`,
    );
  }
  if (dst != null && dst <= -50) {
    bullets.push(`Dst ${fmt(dst, 0)} nT confirms ring-current disturbance at Earth.`);
  }
  if (s4 != null && s4 >= 0.3) {
    bullets.push(`S4 ${fmt(s4, 2)} — scintillation can break carrier-phase GPS.`);
  }

  bullets.push(`Action: ${brief.action}`);

  const lead =
    storm && brief.statusTone !== "warning"
      ? `${brief.headline} — but Kp/Dst show an active storm; take the action line seriously.`
      : brief.headline;

  return { lead, bullets };
}
