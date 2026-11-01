import type { SolarActivityFull, TimelinePoint } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Same lines as the solar-wind card and the Zimbabwe index alerts. */
const FAST_KMS = 550;
const VERY_FAST_KMS = 700;
const DENSITY_LIMIT = 10;
const BT_LIMIT = 10;
const BZ_LIMIT = -5;

export const WIND_BANDS = [
  { id: "slow", label: "Slow", desc: "<350", color: "#38bdf8" },
  { id: "typical", label: "Typical", desc: "<450", color: "#22c55e" },
  { id: "enhanced", label: "Enhanced", desc: "<550", color: "#eab308" },
  { id: "fast", label: "Fast", desc: "<700", color: "#f97316" },
  { id: "very", label: "Very fast", desc: "≥700", color: "#ef4444" },
] as const;

export type WindBandId = (typeof WIND_BANDS)[number]["id"];

export type WindEpisode = {
  band: "fast" | "very";
  label: string;
  speed: number;
  timeLabel: string;
};

export type SolarWindWatch = {
  speed: number | null;
  band: WindBandId | null;
  bandLabel: string | null;
  density: number | null;
  temperature: number | null;
  bz: number | null;
  bt: number | null;
  pressure: number | null;
  observedLabel: string | null;
  counts: Record<WindBandId, number>;
  episodes: WindEpisode[];
  alerts: string[];
};

export function windBandOf(speed: number | null | undefined): WindBandId | null {
  if (speed == null || !Number.isFinite(speed) || speed <= 0) return null;
  if (speed < 350) return "slow";
  if (speed < 450) return "typical";
  if (speed < FAST_KMS) return "enhanced";
  if (speed < VERY_FAST_KMS) return "fast";
  return "very";
}

export function windBandLabel(band: WindBandId | null): string | null {
  return WIND_BANDS.find((item) => item.id === band)?.label ?? null;
}

function formatUtc(value: string | number | null | undefined): string | null {
  if (value == null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${date.getUTCFullYear()} ${MONTHS[date.getUTCMonth()]} ${day} ${hour}${minute} UTC`;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function reading(solar: SolarActivityFull | null, key: string, value: number | null | undefined, positive = true): number | null {
  if (!finite(value)) return null;
  if (positive && value <= 0) return null;
  const feed = solar?.feed_status?.[key];
  if (feed && feed.fresh === false) return null;
  return value;
}

function feedTime(solar: SolarActivityFull | null, key: string): string | null {
  const stamp = solar?.feed_status?.[key]?.timestamp;
  return typeof stamp === "string" && stamp.trim() ? stamp : null;
}

function countBands(points: TimelinePoint[] | null | undefined, current: WindBandId | null): Record<WindBandId, number> {
  const counts: Record<WindBandId, number> = { slow: 0, typical: 0, enhanced: 0, fast: 0, very: 0 };
  const samples = (points ?? []).filter((point) => finite(point.v) && point.v > 0);
  if (!samples.length) {
    if (current) counts[current] = 1;
    return counts;
  }
  for (const point of samples) {
    const band = windBandOf(point.v);
    if (band) counts[band] += 1;
  }
  return counts;
}

function fastEpisodes(points: TimelinePoint[] | null | undefined): WindEpisode[] {
  const samples = (points ?? [])
    .map((point) => ({ t: Date.parse(point.t), v: point.v }))
    .filter((point) => Number.isFinite(point.t) && finite(point.v) && point.v > 0)
    .sort((a, b) => a.t - b.t);
  const episodes: WindEpisode[] = [];
  let open: { speed: number; time: number } | null = null;
  const close = () => {
    if (!open) return;
    const band = windBandOf(open.speed);
    const label = formatUtc(open.time);
    if ((band === "fast" || band === "very") && label) {
      episodes.push({ band, label: windBandLabel(band) ?? band, speed: Math.round(open.speed), timeLabel: label });
    }
    open = null;
  };
  for (const sample of samples) {
    if (sample.v >= FAST_KMS) {
      if (!open || sample.v >= open.speed) open = { speed: sample.v, time: sample.t };
    } else {
      close();
    }
  }
  close();
  return episodes.slice(-6).reverse();
}

export function buildSolarWindWatch(
  solar: SolarActivityFull | null,
  points?: TimelinePoint[] | null,
): SolarWindWatch {
  const wind = solar?.solar_wind;
  const speed = reading(solar, "solar_wind_plasma", wind?.speed);
  const density = reading(solar, "solar_wind_plasma", wind?.density);
  const temperature = reading(solar, "solar_wind_plasma", wind?.temperature);
  const pressure = reading(solar, "solar_wind_plasma", wind?.dynamic_pressure);
  const bz = reading(solar, "solar_wind_mag", wind?.bz, false);
  const bt = reading(solar, "solar_wind_mag", wind?.bt);
  const band = windBandOf(speed);
  const alerts: string[] = [];
  if (speed != null && speed >= FAST_KMS) {
    alerts.push(`Speed ${Math.round(speed)} km/s is ${windBandLabel(band)}, past the fast-wind line at ${FAST_KMS} km/s.`);
  }
  if (density != null && density >= DENSITY_LIMIT) {
    alerts.push(`Density ${density.toFixed(1)} /cm³ is past the high-density line at ${DENSITY_LIMIT} /cm³.`);
  }
  if (bz != null && bz <= BZ_LIMIT) {
    alerts.push(`Bz ${bz.toFixed(1)} nT is south of the coupling line at ${BZ_LIMIT} nT.`);
  }
  if (bt != null && bt >= BT_LIMIT) {
    alerts.push(`Bt ${bt.toFixed(1)} nT is past the strong-field line at ${BT_LIMIT} nT.`);
  }
  return {
    speed,
    band,
    bandLabel: windBandLabel(band),
    density,
    temperature,
    bz,
    bt,
    pressure,
    observedLabel: formatUtc(feedTime(solar, "solar_wind_plasma") ?? feedTime(solar, "solar_wind_mag") ?? solar?.updated ?? null),
    counts: countBands(points, band),
    episodes: fastEpisodes(points),
    alerts,
  };
}

export function solarWindGuideParagraphs(watch: SolarWindWatch): string[] {
  const now = watch.speed != null && watch.bandLabel
    ? `The measured solar wind is ${Math.round(watch.speed)} km/s, class ${watch.bandLabel}${watch.observedLabel ? `, at ${watch.observedLabel}` : ""}.`
    : "Solar wind speed is not in the current RTSW sample.";
  return [
    now,
    "Solar wind is the stream of charged particles leaving the Sun. NOAA RTSW reads its speed, density, and proton temperature at L1, about an hour upstream of Earth.",
    "The speed classes on this card are Slow below 350 km/s, Typical below 450, Enhanced below 550, Fast below 700, and Very fast from 700 upward. Enhanced is a raised stream. The alert starts at Fast.",
    "Density, proton temperature, and dynamic pressure describe how heavy that stream is. A fast and dense stream presses on Earth's magnetic field. Density alerts at 10 particles per cubic centimetre.",
    "IMF Bz and Bt travel with the stream. Southward Bz at or below −5 nT connects the wind to Earth's field, and Bt at or above 10 nT is a strong field. Over Zimbabwe the check after that coupling is a change in TEC or S4 on the CORS network. A coronal-hole stream and a coronal mass ejection can both raise the speed. This monitor reports the measured wind. It does not assign the stream to one eruption.",
  ];
}
