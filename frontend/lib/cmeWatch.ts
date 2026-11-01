import type { SolarActivityFull } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Earth-directed plasma in the existing card text can still be in transit for about three days. */
const ARRIVAL_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export const CME_BANDS = [
  { id: "away", label: "Away", desc: "Limb", color: "#38bdf8" },
  { id: "glancing", label: "Glancing", desc: "Edge", color: "#eab308" },
  { id: "earth", label: "Earth", desc: "Aimed", color: "#f97316" },
  { id: "halo", label: "Halo", desc: "Full", color: "#ef4444" },
  { id: "open", label: "Unset", desc: "No aim", color: "#94a3b8" },
] as const;

export type CmeBandId = (typeof CME_BANDS)[number]["id"];

export type CmeEvent = {
  band: CmeBandId;
  label: string;
  speed: number | null;
  timeMs: number;
  timeLabel: string;
};

export type CmeWatch = {
  counts: Record<CmeBandId, number>;
  recent: CmeEvent[];
  newest: CmeEvent | null;
  alert: CmeEvent | null;
  sourceLabel: string;
};

const BAND_LABEL: Record<CmeBandId, string> = {
  away: "directed away",
  glancing: "a glancing edge",
  earth: "Earth-directed",
  halo: "a halo",
  open: "not assessed",
};

export function cmeBandLabel(band: CmeBandId): string {
  return BAND_LABEL[band];
}

function parseTime(value: unknown): number | null {
  if (typeof value !== "string" || !value.trim()) return null;
  let text = value.trim().replace(" ", "T");
  if (!/Z|[+-]\d{2}:?\d{2}$/i.test(text)) text = `${text}Z`;
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
  return "NOAA SWPC";
}

function analysisOf(row: Record<string, unknown>): Record<string, unknown> | null {
  const analyses = Array.isArray(row.cmeAnalyses) ? row.cmeAnalyses : [];
  const chosen = analyses.find((item) => item && typeof item === "object" && (item as Record<string, unknown>).isMostAccurate) ?? analyses[0];
  return chosen && typeof chosen === "object" ? chosen as Record<string, unknown> : null;
}

/** Direction comes from an explicit catalog note. Cone angle and a linked-event flag do not set it. */
function bandOf(row: Record<string, unknown>, analysis: Record<string, unknown> | null): CmeBandId {
  const text = [analysis?.note, row.note, row.cmeNote]
    .filter((part) => typeof part === "string")
    .join(" ")
    .toLowerCase();
  if (/\bhalo\b/.test(text)) return "halo";
  if (/earth[-\s]?directed|geoeffective/.test(text)) return "earth";
  if (/glancing/.test(text)) return "glancing";
  if (/\blimb\b|farside|far-side|directed away/.test(text)) return "away";
  return "open";
}

function readEvent(row: Record<string, unknown>): CmeEvent | null {
  const analysis = analysisOf(row);
  const timeMs = parseTime(row.startTime ?? row.start_time);
  if (timeMs == null) return null;
  const speedRaw = Number(analysis?.speed);
  const speed = Number.isFinite(speedRaw) && speedRaw > 0 ? speedRaw : null;
  const band = bandOf(row, analysis);
  return {
    band,
    label: cmeBandLabel(band),
    speed,
    timeMs,
    timeLabel: formatUtc(timeMs),
  };
}

export function buildCmeWatch(solar: SolarActivityFull | null, now = Date.now()): CmeWatch {
  const counts: Record<CmeBandId, number> = { away: 0, glancing: 0, earth: 0, halo: 0, open: 0 };
  const events: CmeEvent[] = [];
  const rows = Array.isArray(solar?.donki_cmes) ? solar.donki_cmes : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const event = readEvent(row as Record<string, unknown>);
    if (!event) continue;
    counts[event.band] += 1;
    events.push(event);
  }
  events.sort((a, b) => b.timeMs - a.timeMs);
  const newest = events[0] ?? null;
  const alert =
    newest &&
    (newest.band === "earth" || newest.band === "halo") &&
    now - newest.timeMs <= ARRIVAL_WINDOW_MS &&
    newest.timeMs <= now + 5 * 60 * 1000
      ? newest
      : null;
  return {
    counts,
    recent: events.slice(0, 6),
    newest,
    alert,
    sourceLabel: sourceLabel(solar),
  };
}

export function cmeGuideParagraphs(watch: CmeWatch): string[] {
  const total = Object.values(watch.counts).reduce((sum, count) => sum + count, 0);
  const newest = watch.newest
    ? `The newest is ${watch.newest.label}${watch.newest.speed != null ? `, ${Math.round(watch.newest.speed)} km/s` : ""}, at ${watch.newest.timeLabel}.`
    : "This window lists no coronal mass ejection.";
  const countLine = total === 1
    ? "This window lists 1 coronal mass ejection."
    : `This window lists ${total} coronal mass ejections.`;
  return [
    watch.newest ? `${countLine} ${newest}` : newest,
    "A coronal mass ejection is an eruption of solar plasma together with magnetic field. It is separate from the GOES flare class. If the cloud is aimed at Earth, it usually takes one to three days to arrive.",
    "The classes are Away for a limb or farside ejection, Glancing for an edge, Earth when the catalog says the cloud is Earth-directed, Halo when the catalog says the front surrounds the occulting disk, and Unset when the aim is not assessed. The alert is only Earth or Halo, and only while that start is still inside the three-day arrival window.",
    "Cone angle and a linked-event flag do not establish arrival. The CME table on this page marks halo and impact as not established unless a measured direction is in the record. A storm follows only if the structure arrives and the field inside it stays southward.",
    "Over Zimbabwe that arrival is read on TEC and S4 from the CORS network, together with Kp, Dst, and IMF Bz. This monitor reports the catalog. It does not by itself mean a geomagnetic storm or a local GNSS outage.",
  ];
}
