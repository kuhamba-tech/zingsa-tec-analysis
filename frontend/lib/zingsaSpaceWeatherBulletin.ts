/**
 * Structured ZINGSA Space Weather Bulletin — live values with operational meaning.
 * Regional TEC uses measured CORS samples only; missing bands are omitted, never fabricated.
 */

import type { LiveStationVtecSeries, SolarActivityFull, SpaceWeatherCurrent } from "@/lib/types";
import {
  formatAlertUtc,
  kpWords,
  orientationWords,
  windWords,
  type ZimbabweIndexAlert,
} from "@/lib/zimbabweIndexAlerts";
import {
  normalizeStationCode,
  stationLatLookup,
  zimbabweLatBand,
  ZIMBABWE_LAT_BANDS,
  type ZimbabweLatBandId,
} from "@/lib/zimbabweLatBands";
import { isSurveyorGeneral } from "@/lib/liveStationStatus";

const VTEC_LIMIT = 40;
const S4_LIMIT = 0.35;
const BZ_LIMIT = -5;
const WIND_LIMIT = 550;
const DST_STORM = -50;
const KP_STORM = 5;

export type BulletinSection = {
  title: string;
  bullets: string[];
  values: Record<string, string>;
};

export type RegionalTecReading = {
  id: ZimbabweLatBandId;
  label: string;
  meanTecu: number | null;
  stationCount: number;
  sampleCount: number;
  quietLow: number | null;
  quietHigh: number | null;
  status: "within_expected" | "above_expected" | "below_expected" | "unavailable";
  statusLabel: string;
  note: string;
};

export type ZingsaBulletin = {
  title: string;
  issuedAt: string | null;
  headline: string;
  situation: string;
  sections: {
    solarActivity: BulletinSection;
    solarWind: BulletinSection;
    geomagnetic: BulletinSection;
    zimbabweTec: BulletinSection & { regions: RegionalTecReading[]; networkTecu: number | null };
    gnssGuidance: BulletinSection & { status: string; action: string };
  };
  linkedAlertCodes: string[];
  bodyPlain: string;
};

type SolarBriefLike = {
  earth_facing_region_count?: number | null;
  spotted_region_count?: number | null;
  m_percent?: number | null;
  x_percent?: number | null;
  c_percent?: number | null;
  issued?: string | null;
} | null;

/** Quiet-day Zimbabwe network-mean VTEC envelopes in CAT (UTC+2) — matches report_narrative. */
export const CAT_QUIET_WINDOWS = [
  { id: "morning", title: "Morning", hoursCat: [6, 7, 8, 9, 10], expectedLow: 8, expectedHigh: 30 },
  { id: "noon", title: "Noon / afternoon", hoursCat: [11, 12, 13, 14, 15], expectedLow: 12, expectedHigh: 45 },
  { id: "night", title: "Night", hoursCat: [20, 21, 22, 23, 0, 1, 2, 3], expectedLow: 1, expectedHigh: 12 },
] as const;

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function fmt(value: number | null | undefined, digits: number, suffix = ""): string {
  if (!finite(value)) return "unavailable";
  const text = value.toFixed(digits);
  return suffix ? `${text} ${suffix}` : text;
}

function feedFresh(solar: SolarActivityFull | null, key: string): boolean {
  return Boolean(solar?.feed_status?.[key]?.fresh);
}

function catHourFromUtc(date = new Date()): number {
  return (date.getUTCHours() + 2) % 24;
}

export function quietEnvelopeForCatHour(hourCat: number): {
  title: string;
  expectedLow: number;
  expectedHigh: number;
} | null {
  for (const window of CAT_QUIET_WINDOWS) {
    if (window.hoursCat.includes(hourCat as never)) {
      return {
        title: window.title,
        expectedLow: window.expectedLow,
        expectedHigh: window.expectedHigh,
      };
    }
  }
  return null;
}

function compareToQuiet(
  tecu: number | null,
  envelope: { expectedLow: number; expectedHigh: number; title: string } | null,
): Pick<RegionalTecReading, "status" | "statusLabel" | "note" | "quietLow" | "quietHigh"> {
  if (tecu == null) {
    return {
      status: "unavailable",
      statusLabel: "No samples",
      note: "No measured CORS TEC for this latitude band in the current window.",
      quietLow: envelope?.expectedLow ?? null,
      quietHigh: envelope?.expectedHigh ?? null,
    };
  }
  if (!envelope) {
    return {
      status: "unavailable",
      statusLabel: "Quiet band unavailable",
      note: `Measured ${tecu.toFixed(1)} TECU. No CAT quiet-day envelope is defined for this local hour.`,
      quietLow: null,
      quietHigh: null,
    };
  }
  const { expectedLow: low, expectedHigh: high, title } = envelope;
  if (tecu < low) {
    return {
      status: "below_expected",
      statusLabel: "Below expected",
      note: `${tecu.toFixed(1)} TECU is below the ${title} quiet band ${low}–${high} TECU (CAT).`,
      quietLow: low,
      quietHigh: high,
    };
  }
  if (tecu > high) {
    return {
      status: "above_expected",
      statusLabel: "Above expected",
      note: `${tecu.toFixed(1)} TECU exceeds the ${title} quiet band ${low}–${high} TECU (CAT).`,
      quietLow: low,
      quietHigh: high,
    };
  }
  return {
    status: "within_expected",
    statusLabel: "Within expected",
    note: `${tecu.toFixed(1)} TECU lies inside the ${title} quiet band ${low}–${high} TECU (CAT).`,
    quietLow: low,
    quietHigh: high,
  };
}

/** Latest measured mean TEC per Zimbabwe latitude band from live station series. */
export function regionalTecFromStationSeries(
  series: LiveStationVtecSeries[] | null | undefined,
  now = new Date(),
): RegionalTecReading[] {
  const lats = stationLatLookup();
  const envelope = quietEnvelopeForCatHour(catHourFromUtc(now));
  const buckets = new Map<ZimbabweLatBandId, { values: number[]; stations: Set<string> }>();
  for (const band of ZIMBABWE_LAT_BANDS) {
    buckets.set(band.id, { values: [], stations: new Set() });
  }

  for (const row of series ?? []) {
    const code = normalizeStationCode(row.station);
    if (isSurveyorGeneral(code)) continue;
    const lat = lats.get(code);
    if (lat == null || !Number.isFinite(lat)) continue;
    const band = zimbabweLatBand(lat);
    const bucket = buckets.get(band)!;
    const points = (row.points ?? []).filter(
      (p) => p.vtec_tecu != null && Number.isFinite(p.vtec_tecu) && p.vtec_tecu > 0 && p.vtec_tecu <= 100,
    );
    if (!points.length) continue;
    // Prefer the most recent sample per station (real observation only).
    const latest = [...points].sort((a, b) => Date.parse(b.time) - Date.parse(a.time))[0];
    if (!latest || latest.vtec_tecu == null) continue;
    bucket.values.push(latest.vtec_tecu);
    bucket.stations.add(code);
  }

  return ZIMBABWE_LAT_BANDS.map((band) => {
    const bucket = buckets.get(band.id)!;
    const meanTecu = bucket.values.length
      ? Math.round((bucket.values.reduce((a, b) => a + b, 0) / bucket.values.length) * 10) / 10
      : null;
    const compared = compareToQuiet(meanTecu, envelope);
    return {
      id: band.id,
      label: band.label,
      meanTecu,
      stationCount: bucket.stations.size,
      sampleCount: bucket.values.length,
      ...compared,
    };
  });
}

function windMeaning(speed: number): string {
  if (speed >= 700) {
    return "Very fast stream: elevated dynamic pressure on Earth's magnetic field, but a geomagnetic storm still needs sustained southward Bz plus rising Kp or falling Dst.";
  }
  if (speed >= WIND_LIMIT) {
    return `Fast stream (ZINGSA threshold ${WIND_LIMIT} km/s): coupling can strengthen if Bz turns south; speed alone does not open a G-scale storm.`;
  }
  if (speed >= 450) {
    return "Moderately enhanced wind: near-Earth plasma is slightly elevated; storm risk is still set by Bz, Kp and Dst.";
  }
  return "Typical or slow wind: background drive is modest unless Bz, Kp or Dst show a disturbance.";
}

function bzMeaning(bz: number): string {
  const orient = orientationWords(bz);
  if (bz <= -10) {
    return `Strong southward coupling (${orient}): solar wind can efficiently transfer energy into the magnetosphere.`;
  }
  if (bz <= BZ_LIMIT) {
    return `Southward past ZINGSA’s ${BZ_LIMIT} nT watch line (${orient}): geomagnetic activity can build if this holds.`;
  }
  if (bz < 0) {
    return `Mild southward orientation (${orient}): some coupling is possible, still below the ${BZ_LIMIT} nT watch line.`;
  }
  if (bz >= 0.5) {
    return `Northward field (${orient}): coupling is weak; a high-speed stream is less likely to drive a storm while Bz stays north.`;
  }
  return `Near-zero north–south field (${orient}): coupling is weak or intermittent.`;
}

function buildHeadline(input: {
  speed: number | null;
  bz: number | null;
  kp: number | null;
  dst: number | null;
  alertCodes: string[];
}): string {
  const { speed, bz, kp, dst, alertCodes } = input;
  const stormKp = kp != null && kp >= KP_STORM;
  const stormDst = dst != null && dst <= DST_STORM;
  const south = bz != null && bz <= BZ_LIMIT;
  const fast = speed != null && speed >= WIND_LIMIT;
  const quietGeo = (kp == null || kp < 3) && (dst == null || dst > -30) && (bz == null || bz > BZ_LIMIT);

  if (alertCodes.length && (stormKp || stormDst || south)) {
    return `ZINGSA Index Alerts Active — ${alertCodes.join(", ")}`;
  }
  if (stormKp || stormDst) {
    return "Geomagnetic Storm Conditions Observed — Confirm Zimbabwe CORS Impact";
  }
  if (south && fast) {
    return "Fast Solar Wind with Southward IMF Bz — Coupling Elevated";
  }
  if (south) {
    return "Southward IMF Bz — Monitor Geomagnetic Response";
  }
  if (fast && quietGeo) {
    return "Elevated Solar Wind — Geomagnetic Conditions Currently Quiet";
  }
  if (fast) {
    return "Elevated Solar Wind — Assess Bz, Kp and Dst Together";
  }
  if (quietGeo) {
    return "Quiet Geomagnetic Conditions — Routine Zimbabwe Monitoring";
  }
  return "ZINGSA Space Weather Bulletin — Live Observed Conditions";
}

export function buildZingsaBulletin(options: {
  sw: SpaceWeatherCurrent | null;
  solar: SolarActivityFull | null;
  brief?: SolarBriefLike;
  stationSeries?: LiveStationVtecSeries[] | null;
  alerts?: ZimbabweIndexAlert[];
  now?: Date;
}): ZingsaBulletin {
  const now = options.now ?? new Date();
  const sw = options.sw;
  const solar = options.solar;
  const brief = options.brief ?? null;
  const alerts = options.alerts ?? [];
  const linkedAlertCodes = alerts.map((a) => a.code);

  const windFresh = feedFresh(solar, "solar_wind_plasma");
  const magFresh = feedFresh(solar, "solar_wind_mag");
  const speed =
    windFresh && finite(solar?.solar_wind?.speed) && solar.solar_wind.speed > 0
      ? solar.solar_wind.speed
      : finite(sw?.plasma_speed) && sw.plasma_speed > 0
        ? sw.plasma_speed
        : null;
  const bz = magFresh && finite(solar?.solar_wind?.bz) ? solar.solar_wind.bz : null;
  const kp = finite(sw?.kp) ? sw.kp : null;
  const dst = finite(sw?.dst) ? sw.dst : null;
  const vtec = finite(sw?.mean_vtec) ? sw.mean_vtec : null;
  const s4 = finite(sw?.s4) ? sw.s4 : null;

  const regions = brief?.earth_facing_region_count ?? brief?.spotted_region_count ?? null;
  const allRegional = regionalTecFromStationSeries(options.stationSeries, now);

  const issuedAt = formatAlertUtc(sw?.updated_utc) ?? formatAlertUtc(solar?.updated) ?? formatAlertUtc(brief?.issued ?? null);
  const headline = buildHeadline({ speed, bz, kp, dst, alertCodes: linkedAlertCodes });

  const situationParts = [
    issuedAt ? `At ${issuedAt}` : "At the latest available sample",
    speed != null ? `solar-wind speed is ${fmt(speed, 0, "km/s")}` : "solar-wind speed is unavailable",
    bz != null ? `IMF Bz is ${fmt(bz, 1, "nT")} (${orientationWords(bz)})` : "IMF Bz is unavailable",
    kp != null ? `Kp is ${fmt(kp, 1)} (${kpWords(kp)})` : "Kp is unavailable",
    dst != null ? `Dst is ${fmt(dst, 0, "nT")}` : "Dst is unavailable",
  ];
  let situation = `${situationParts[0]}, ${situationParts.slice(1).join(", ")}. `;
  if (speed != null && speed >= WIND_LIMIT && (kp == null || kp < KP_STORM) && (dst == null || dst > DST_STORM)) {
    situation += "These values indicate elevated solar-wind speed without a confirmed geomagnetic storm at this observation time. ";
  } else if ((kp != null && kp >= KP_STORM) || (dst != null && dst <= DST_STORM)) {
    situation += "Geomagnetic indicators meet storm-level thresholds in the global indices; Zimbabwe impact still requires measured CORS TEC or S4. ";
  } else {
    situation += "Global indices describe the near-Earth environment; they do not by themselves prove a Zimbabwe GNSS outage. ";
  }
  if (linkedAlertCodes.length) {
    situation += `Active ZINGSA Index Alert codes: ${linkedAlertCodes.join(", ")}.`;
  } else {
    situation += "No ZINGSA Index Alert codes are past limit.";
  }

  const solarActivity: BulletinSection = {
    title: "Solar activity",
    values: {
      regions: regions == null ? "unavailable" : String(regions),
      c_percent: brief?.c_percent == null ? "unavailable" : `${brief.c_percent}%`,
      m_percent: brief?.m_percent == null ? "unavailable" : `${brief.m_percent}%`,
      x_percent: brief?.x_percent == null ? "unavailable" : `${brief.x_percent}%`,
    },
    bullets: [
      regions == null
        ? "Earth-facing sunspot region count is unavailable."
        : `${regions} Earth-facing sunspot region${regions === 1 ? "" : "s"} reported.`,
      `Flare chances (NOAA whole-disk, forecast day): C ${brief?.c_percent ?? "—"}% · M ${brief?.m_percent ?? "—"}% · X ${brief?.x_percent ?? "—"}. These are probabilities, not a guarantee of an Earth-directed eruption.`,
      "A flare’s radio/HF effects on the sunlit ionosphere begin when the flare light reaches Earth (GOES detection already includes that travel time).",
    ],
  };

  const solarWind: BulletinSection = {
    title: "Solar wind",
    values: {
      speed: speed == null ? "unavailable" : `${fmt(speed, 0)} km/s (${windWords(speed)})`,
      source: "NOAA/SWPC L1",
    },
    bullets: [
      speed == null
        ? "Solar wind speed at L1 is unavailable from the current NOAA/SWPC sample."
        : `Solar wind at L1 is ${fmt(speed, 0, "km/s")} (NOAA/SWPC). ${windMeaning(speed)}`,
    ],
  };

  const geomagnetic: BulletinSection = {
    title: "Geomagnetic conditions",
    values: {
      bz: bz == null ? "unavailable" : `${fmt(bz, 1)} nT (${orientationWords(bz)})`,
      kp: kp == null ? "unavailable" : `${fmt(kp, 1)} (${kpWords(kp)})`,
      dst: dst == null ? "unavailable" : `${fmt(dst, 0)} nT`,
    },
    bullets: [
      bz == null ? "IMF Bz unavailable — southward coupling cannot be confirmed." : `IMF Bz ${fmt(bz, 1, "nT")}: ${bzMeaning(bz)}`,
      kp == null
        ? "Kp unavailable — NOAA G-scale cannot be assigned."
        : `Kp ${fmt(kp, 1)} (${kpWords(kp)}): ${
            kp < 3
              ? "quiet planetary activity (below unsettled Kp 3 and well below G1 at Kp 5)."
              : kp < 5
                ? "below NOAA G1 (Kp 5); write Active/Unsettled, not storm."
                : "at or above NOAA G1 — global storm context elevated."
          }`,
      dst == null
        ? "Dst unavailable — ring-current storm phase cannot be confirmed."
        : `Dst ${fmt(dst, 0, "nT")}: ${
            dst <= DST_STORM
              ? "storm-time ring-current depression (through about −50 nT)."
              : "near quiet or mild ring-current levels — no confirmed main-phase storm signature."
          }`,
    ],
  };

  const envelope = quietEnvelopeForCatHour(catHourFromUtc(now));
  const networkCompared = compareToQuiet(vtec, envelope);
  const zimbabweTec = {
    title: "Zimbabwe TEC observations",
    networkTecu: vtec,
    regions: allRegional,
    values: {
      network: vtec == null ? "unavailable" : `${fmt(vtec, 1)} TECU`,
      northern: allRegional.find((r) => r.id === "northern")?.meanTecu == null
        ? "unavailable"
        : `${fmt(allRegional.find((r) => r.id === "northern")!.meanTecu, 1)} TECU`,
      central: allRegional.find((r) => r.id === "central")?.meanTecu == null
        ? "unavailable"
        : `${fmt(allRegional.find((r) => r.id === "central")!.meanTecu, 1)} TECU`,
      southern: allRegional.find((r) => r.id === "southern")?.meanTecu == null
        ? "unavailable"
        : `${fmt(allRegional.find((r) => r.id === "southern")!.meanTecu, 1)} TECU`,
    },
    bullets: [
      vtec == null
        ? "Network-mean VTEC is unavailable."
        : `Network VTEC ${fmt(vtec, 1, "TECU")}. ${networkCompared.note}`,
      ...allRegional
        .filter((r) => r.meanTecu != null)
        .map(
          (r) =>
            `${r.label}: ${fmt(r.meanTecu, 1, "TECU")} from ${r.stationCount} CORS station${r.stationCount === 1 ? "" : "s"} — ${r.statusLabel}. ${r.note}`,
        ),
      allRegional.every((r) => r.meanTecu == null)
        ? "North, Central and South band means are unavailable until measured CORS TEC arrives for those latitudes."
        : "Regional means use the latest real GOPI/CORS sample per station; Surveyor General sites are excluded.",
    ],
  };

  const scintillationElevated = s4 != null && s4 >= S4_LIMIT;
  const tecElevated = vtec != null && vtec >= VTEC_LIMIT;
  const regionAnomaly = allRegional.some((r) => r.status === "above_expected" || r.status === "below_expected");
  let gnssStatus = "No local positioning degradation is confirmed by the measurements shown.";
  if (scintillationElevated) {
    gnssStatus = `Elevated scintillation is measured (S4 ${fmt(s4, 2)}) — GNSS fading risk may rise on affected links.`;
  } else if (tecElevated || regionAnomaly) {
    gnssStatus = "Ionospheric TEC is elevated or outside the quiet CAT band in at least one reading — potential delay/gradient risk; measured receiver degradation is not yet proven by S4 alone.";
  } else if (s4 == null && vtec == null) {
    gnssStatus = "Local TEC and S4 are unavailable — GNSS impact cannot be confirmed or ruled out from planetary indices.";
  }

  const gnssGuidance = {
    title: "GNSS guidance",
    status: gnssStatus,
    action:
      "Continue monitoring CORS performance, TEC variability by region, IMF Bz, Kp and Dst. Confirm operational decisions with station-level tracking quality — never from Kp or solar-wind speed alone.",
    values: {
      s4: s4 == null ? "unavailable" : fmt(s4, 2),
      status: gnssStatus,
    },
    bullets: [
      s4 == null ? "S4 is unavailable in this sample." : `S4 ${fmt(s4, 2)}${scintillationElevated ? ` (at or above ZINGSA watch line ${S4_LIMIT})` : " (quiet to mild)"}.`,
      gnssStatus,
      "Local Zimbabwe impact is confirmed only when measured CORS TEC or S4 changes with the disturbance.",
    ],
  };

  const bodyPlain = [
    headline,
    situation,
    ...solarActivity.bullets,
    ...solarWind.bullets,
    ...geomagnetic.bullets,
    ...zimbabweTec.bullets,
    ...gnssGuidance.bullets,
  ].join(" ");

  return {
    title: "ZINGSA Space Weather Bulletin",
    issuedAt,
    headline,
    situation,
    sections: {
      solarActivity,
      solarWind,
      geomagnetic,
      zimbabweTec,
      gnssGuidance,
    },
    linkedAlertCodes,
    bodyPlain,
  };
}

/** Backward-compatible paragraph form used by older call sites. */
export function bulletinToLegacyUpdate(bulletin: ZingsaBulletin): {
  title: string;
  body: string;
  couplingLine: string;
  localLine: string;
} {
  return {
    title: bulletin.title,
    body: bulletin.bodyPlain,
    couplingLine: bulletin.sections.geomagnetic.bullets.join(" "),
    localLine: [
      ...bulletin.sections.zimbabweTec.bullets.slice(0, 2),
      bulletin.sections.gnssGuidance.action,
    ].join(" "),
  };
}
