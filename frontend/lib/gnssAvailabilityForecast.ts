/**
 * GNSS availability star forecast — weather-style outlook from NOAA Kp + live CORS.
 */
import type { ForecastStatus, GnssForecastCity } from "./gnssWeatherIntelligence";
import { effectiveNavigationTone } from "./gnssAudienceNews";
import type { SpaceWeatherCurrent } from "./types";

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export interface GnssAvailabilityPeriod {
  label: string;
  stars: number;
  starsDisplay: string;
  maxKp?: number | null;
}

export interface GnssAvailabilityForecast {
  title: string;
  subtitle: string;
  periods: GnssAvailabilityPeriod[];
  stormAlert?: string | null;
  source: string;
  updatedAt: string;
}

export interface NoaaKpForecastRow {
  time_tag: string;
  kp: number;
  observed?: string;
  noaa_scale?: string | null;
}

function starsDisplay(stars: number): string {
  const filled = Math.max(0, Math.min(5, Math.round(stars)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

function kpToStars(maxKp: number): number {
  if (maxKp >= 6) return 1;
  if (maxKp >= 5) return 2;
  if (maxKp >= 4) return 3;
  if (maxKp >= 3) return 4;
  return 5;
}

function toneCapStars(tone: ForecastStatus): number {
  if (tone === "excellent") return 5;
  if (tone === "moderate") return 3;
  return 2;
}

function meanFeed(forecasts: GnssForecastCity[]): number {
  const feeds = forecasts
    .map((f) => f.feedReliability)
    .filter((v): v is number => v != null);
  if (feeds.length === 0) return 50;
  return feeds.reduce((a, b) => a + b, 0) / feeds.length;
}

function feedPenalty(feed: number): number {
  if (feed >= 90) return 0;
  if (feed >= 72) return 1;
  if (feed >= 50) return 2;
  return 3;
}

function dailyMaxKp(rows: NoaaKpForecastRow[], day: string): number | null {
  const values = rows
    .filter((row) => row.time_tag.startsWith(day))
    .filter((row) => ["predicted", "estimated", "observed"].includes((row.observed ?? "").toLowerCase()))
    .map((row) => Number(row.kp))
    .filter((v) => Number.isFinite(v));
  return values.length ? Math.max(...values) : null;
}

function dailyStormScale(rows: NoaaKpForecastRow[], day: string): string | null {
  const scales = rows
    .filter((row) => row.time_tag.startsWith(day))
    .filter((row) => (row.observed ?? "").toLowerCase() === "predicted" && row.noaa_scale)
    .map((row) => row.noaa_scale as string);
  if (!scales.length) return null;
  const order: Record<string, number> = { G5: 5, G4: 4, G3: 3, G2: 2, G1: 1 };
  return scales.sort((a, b) => (order[b] ?? 0) - (order[a] ?? 0))[0];
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function weekendDays(today: Date): { sat: string; sun: string } {
  const weekday = today.getUTCDay();
  const daysToSat = (6 - weekday + 7) % 7;
  const satOffset = weekday === 6 ? 0 : daysToSat === 0 ? 7 : daysToSat;
  const sat = addDays(today, satOffset);
  const sun = addDays(sat, 1);
  return { sat: isoDate(sat), sun: isoDate(sun) };
}

function starsForDay(
  maxKp: number | null,
  opts?: { tone?: ForecastStatus; feed?: number },
): number | null {
  if (maxKp == null) return null;
  let stars = kpToStars(maxKp);
  if (opts?.feed != null) stars = Math.max(1, stars - feedPenalty(opts.feed));
  if (opts?.tone) stars = Math.min(stars, toneCapStars(opts.tone));
  return Math.max(1, Math.min(5, stars));
}

export async function fetchNoaaKpForecast(): Promise<NoaaKpForecastRow[]> {
  try {
    const res = await fetch(
      "https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json",
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!Array.isArray(data)) return [];
    return data
      .filter((row): row is Record<string, unknown> => row != null && typeof row === "object")
      .map((row) => ({
        time_tag: String(row.time_tag ?? ""),
        kp: Number(row.kp),
        observed: row.observed != null ? String(row.observed) : undefined,
        noaa_scale: row.noaa_scale != null ? String(row.noaa_scale) : null,
      }))
      .filter((row) => row.time_tag && Number.isFinite(row.kp));
  } catch {
    return [];
  }
}

export function buildGnssAvailabilityForecast(
  sw: SpaceWeatherCurrent | null,
  forecasts: GnssForecastCity[],
  kpForecast: NoaaKpForecastRow[],
  tone?: ForecastStatus,
): GnssAvailabilityForecast {
  const now = new Date();
  const today = isoDate(now);
  const tomorrow = isoDate(addDays(now, 1));
  const { sat, sun } = weekendDays(now);

  const navTone = tone ?? effectiveNavigationTone(forecasts, sw);
  const feed = meanFeed(forecasts);

  let todayKp = dailyMaxKp(kpForecast, today);
  if (todayKp == null && sw?.kp != null) todayKp = sw.kp;

  const tomorrowKp = dailyMaxKp(kpForecast, tomorrow);
  const satKp = dailyMaxKp(kpForecast, sat);
  const sunKp = dailyMaxKp(kpForecast, sun);
  const weekendKp =
    satKp != null && sunKp != null ? Math.max(satKp, sunKp) : satKp ?? sunKp;

  const periods: GnssAvailabilityPeriod[] = [];

  const todayStars = starsForDay(todayKp, { tone: navTone, feed });
  if (todayStars != null) {
    periods.push({
      label: "Today",
      stars: todayStars,
      starsDisplay: starsDisplay(todayStars),
      maxKp: todayKp,
    });
  }

  const tomorrowStars = starsForDay(tomorrowKp);
  if (tomorrowStars != null) {
    periods.push({
      label: "Tomorrow",
      stars: tomorrowStars,
      starsDisplay: starsDisplay(tomorrowStars),
      maxKp: tomorrowKp,
    });
  }

  const weekendStars = starsForDay(weekendKp);
  if (weekendStars != null) {
    periods.push({
      label: "Weekend",
      stars: weekendStars,
      starsDisplay: starsDisplay(weekendStars),
      maxKp: weekendKp,
    });
  }

  let stormAlert: string | null = null;
  for (let offset = 1; offset <= 7; offset += 1) {
    const day = isoDate(addDays(now, offset));
    const maxKp = dailyMaxKp(kpForecast, day);
    const scale = dailyStormScale(kpForecast, day);
    if ((maxKp != null && maxKp >= 5) || scale) {
      const d = addDays(now, offset);
      const weekday = WEEKDAY_NAMES[d.getUTCDay()];
      stormAlert = scale ? `Storm ${weekday} (${scale})` : `Storm ${weekday}`;
      break;
    }
  }

  return {
    title: "Zimbabwe Navigation Forecast",
    subtitle: "GNSS Availability",
    periods,
    stormAlert,
    source: "NOAA SWPC Kp forecast + live CORS network",
    updatedAt: now.toISOString().replace(/\.\d{3}Z$/, "Z"),
  };
}
