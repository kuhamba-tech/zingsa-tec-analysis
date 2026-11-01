import type { SolarActivityFull, SpaceWeatherCurrent } from "@/lib/types";
import { formatKpDisplay, noaaGScaleFromKp } from "@/lib/spaceWeatherMetrics";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Same window as the flare monitor: a G1 or stronger interval inside 48 hours is an alert. */
const ALERT_WINDOW_MS = 48 * 60 * 60 * 1000;

export const GST_BANDS = [
  { id: "G1", label: "G1", desc: "Minor", color: "#f97316" },
  { id: "G2", label: "G2", desc: "Moderate", color: "#ef4444" },
  { id: "G3", label: "G3", desc: "Strong", color: "#dc2626" },
  { id: "G4", label: "G4", desc: "Severe", color: "#991b1b" },
  { id: "G5", label: "G5", desc: "Extreme", color: "#a855f7" },
] as const;

export type GstBandId = (typeof GST_BANDS)[number]["id"];

export type GstEvent = {
  code: GstBandId;
  kp: number;
  timeMs: number;
  timeLabel: string;
};

export type GeomagneticStormWatch = {
  liveKp: number | null;
  liveLabel: string | null;
  liveCode: GstBandId | null;
  counts: Record<GstBandId, number>;
  recent: GstEvent[];
  newest: GstEvent | null;
  alert: GstEvent | null;
  liveAlert: boolean;
  sourceLabel: string;
};

export function gstBandOf(kp: number | null | undefined): GstBandId | null {
  if (kp == null || !Number.isFinite(kp) || kp < 5) return null;
  if (kp >= 9) return "G5";
  if (kp >= 8) return "G4";
  if (kp >= 7) return "G3";
  if (kp >= 6) return "G2";
  return "G1";
}

function parseTime(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = /Z|[+-]\d{2}:?\d{2}$/i.test(value) ? value : `${value}Z`;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

function formatUtc(ms: number): string {
  const date = new Date(ms);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${date.getUTCFullYear()} ${MONTHS[date.getUTCMonth()]} ${day} ${hour}${minute} UTC`;
}

function sourceLabel(solar: SolarActivityFull | null): string {
  const source = solar?.event_feed_source;
  if (source === "nasa_donki") return "NASA DONKI";
  if (source === "mixed") return "NASA DONKI / NOAA SWPC";
  return "NOAA SWPC Kp";
}

function readEvent(row: Record<string, unknown>): GstEvent | null {
  const samples = Array.isArray(row.allKpIndex) ? row.allKpIndex : [];
  let kp: number | null = null;
  let sampleMs: number | null = null;
  for (const sample of samples) {
    if (!sample || typeof sample !== "object") continue;
    const record = sample as Record<string, unknown>;
    const value = Number(record.kpIndex ?? record.kp);
    if (!Number.isFinite(value)) continue;
    if (kp == null || value >= kp) {
      kp = value;
      sampleMs = parseTime(record.observedTime ?? record.observed_time) ?? sampleMs;
    }
  }
  if (kp == null) {
    const tag = String(row.gstID ?? "");
    const match = tag.match(/G([1-5])/i);
    if (match) kp = Number(match[1]) + 4;
  }
  const code = gstBandOf(kp);
  const timeMs = sampleMs ?? parseTime(row.startTime ?? row.start_time);
  if (kp == null || !code || timeMs == null) return null;
  return { code, kp, timeMs, timeLabel: formatUtc(timeMs) };
}

export function buildGeomagneticStormWatch(
  solar: SolarActivityFull | null,
  sw: SpaceWeatherCurrent | null,
  now = Date.now(),
): GeomagneticStormWatch {
  const counts: Record<GstBandId, number> = { G1: 0, G2: 0, G3: 0, G4: 0, G5: 0 };
  const events: GstEvent[] = [];
  const rows = Array.isArray(solar?.donki_storms) ? solar.donki_storms : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const event = readEvent(row as Record<string, unknown>);
    if (!event) continue;
    counts[event.code] += 1;
    events.push(event);
  }
  events.sort((a, b) => b.timeMs - a.timeMs);
  const newest = events[0] ?? null;
  const alert =
    newest &&
    now - newest.timeMs <= ALERT_WINDOW_MS &&
    newest.timeMs <= now + 5 * 60 * 1000
      ? newest
      : null;
  const liveKp = sw?.kp != null && Number.isFinite(sw.kp) ? sw.kp : null;
  const live = noaaGScaleFromKp(liveKp);
  return {
    liveKp,
    liveLabel: liveKp == null ? null : live.display,
    liveCode: gstBandOf(liveKp),
    counts,
    recent: events.slice(0, 6),
    newest,
    alert,
    liveAlert: liveKp != null && liveKp >= 5,
    sourceLabel: sourceLabel(solar),
  };
}

export function geomagneticStormGuideParagraphs(watch: GeomagneticStormWatch): string[] {
  const live = watch.liveKp != null && watch.liveLabel
    ? `Live Kp is ${formatKpDisplay(watch.liveKp)}, ${watch.liveLabel}.`
    : "Live Kp is not in the current snapshot.";
  const catalog = watch.newest
    ? `This window lists ${watch.recent.length === 1 && Object.values(watch.counts).reduce((sum, n) => sum + n, 0) === 1 ? "1 geomagnetic storm" : `${Object.values(watch.counts).reduce((sum, n) => sum + n, 0)} geomagnetic storms`}. The newest is ${watch.newest.code}, Kp ${formatKpDisplay(watch.newest.kp)}, at ${watch.newest.timeLabel}.`
    : "This window lists no geomagnetic storm.";
  return [
    `${catalog} ${live}`,
    "A geomagnetic storm on this card is a planetary Kp interval at or above 5. NOAA writes that as the G-scale: G1 at Kp 5, then G2, G3, G4, and G5 at Kp 9. Kp 4 is active and stays below the storm line. This is not a flare class and it is not the Dst index.",
    "The five boxes count those storm intervals in the same window as the card. A G2 box means the measured Kp reached 6. The outline marks a G1 or stronger interval inside the last 48 hours, or a live Kp that is still at or above 5.",
    "G1 and above can move TEC over Zimbabwe enough to matter for GNSS. Read the same hours on TEC and S4 from the CORS network, and on Dst and IMF Bz. A catalog interval that has already ended is not the same as a storm still in progress.",
    "This monitor reports the measured Kp intervals. It does not by itself mean a local GNSS outage.",
  ];
}
