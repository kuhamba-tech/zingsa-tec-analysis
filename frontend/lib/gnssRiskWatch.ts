import type { SpaceWeatherCurrent, TimelinePoint } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Dashboard warning. High and Critical are the lines already used for GNSS risk warnings. */
const WARNING_SCORE = 2;

export const GNSS_RISK_BANDS = [
  { id: "low", label: "Low", desc: "Below Kp 3", color: "#00ff88", score: 0 },
  { id: "moderate", label: "Moderate", desc: "Kp ≥3", color: "#EF9F27", score: 1 },
  { id: "high", label: "High", desc: "Kp ≥4", color: "#ef4444", score: 2 },
  { id: "critical", label: "Critical", desc: "Kp ≥5", color: "#dc2626", score: 3 },
] as const;

export type GnssRiskBandId = (typeof GNSS_RISK_BANDS)[number]["id"];

export type GnssRiskEpisode = {
  label: string;
  score: number;
  timeLabel: string;
};

export type GnssRiskWatch = {
  label: string | null;
  band: GnssRiskBandId | null;
  observedLabel: string | null;
  counts: Record<GnssRiskBandId, number>;
  episodes: GnssRiskEpisode[];
  alert: string | null;
};

function finite(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value);
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

export function gnssRiskBandOf(label: string | null | undefined): GnssRiskBandId | null {
  const key = (label ?? "").trim().toLowerCase();
  if (key === "low") return "low";
  if (key === "moderate") return "moderate";
  if (key === "high") return "high";
  if (key === "critical" || key === "severe") return "critical";
  return null;
}

function bandOfScore(score: number): GnssRiskBandId {
  const rounded = Math.max(0, Math.min(3, Math.round(score)));
  return GNSS_RISK_BANDS[rounded].id;
}

function bandLabel(band: GnssRiskBandId | null): string | null {
  return GNSS_RISK_BANDS.find((item) => item.id === band)?.label ?? null;
}

function countBands(points: TimelinePoint[] | null | undefined, current: GnssRiskBandId | null): Record<GnssRiskBandId, number> {
  const counts: Record<GnssRiskBandId, number> = { low: 0, moderate: 0, high: 0, critical: 0 };
  const samples = (points ?? []).filter((point): point is TimelinePoint & { v: number } => finite(point.v));
  if (!samples.length) {
    if (current) counts[current] = 1;
    return counts;
  }
  for (const point of samples) {
    counts[bandOfScore(point.v)] += 1;
  }
  return counts;
}

function warningEpisodes(points: TimelinePoint[] | null | undefined): GnssRiskEpisode[] {
  const samples = (points ?? [])
    .map((point) => ({ t: Date.parse(point.t), v: point.v }))
    .filter((point): point is { t: number; v: number } => Number.isFinite(point.t) && finite(point.v))
    .sort((a, b) => a.t - b.t);
  const episodes: GnssRiskEpisode[] = [];
  let open: { score: number; time: number } | null = null;
  const close = () => {
    if (!open) return;
    const timeLabel = formatUtc(open.time);
    if (timeLabel) {
      episodes.push({
        score: open.score,
        label: open.score >= 3 ? "Critical" : "High",
        timeLabel,
      });
    }
    open = null;
  };
  for (const sample of samples) {
    if (sample.v >= WARNING_SCORE) {
      if (!open || sample.v >= open.score) open = { score: sample.v, time: sample.t };
    } else {
      close();
    }
  }
  close();
  return episodes.slice(-6).reverse();
}

function alertSentence(label: string): string | null {
  if (label === "Critical") {
    return "GNSS risk is Critical. The warning on this dashboard starts at High, and Critical is the top of the scale.";
  }
  if (label === "High") {
    return "GNSS risk is High. The warning on this dashboard starts at High.";
  }
  return null;
}

export function buildGnssRiskWatch(
  sw: SpaceWeatherCurrent | null,
  points?: TimelinePoint[] | null,
): GnssRiskWatch {
  const band = gnssRiskBandOf(sw?.gnss_risk);
  const label = bandLabel(band);
  return {
    label,
    band,
    observedLabel: formatUtc(sw?.updated_utc),
    counts: countBands(points, band),
    episodes: warningEpisodes(points),
    alert: label ? alertSentence(label) : null,
  };
}

export function gnssRiskGuideParagraphs(watch: GnssRiskWatch): string[] {
  const now = watch.label
    ? `The estimated GNSS risk is ${watch.label}${watch.observedLabel ? `, snapshot ${watch.observedLabel}` : ""}.`
    : "The GNSS risk label is not in the current snapshot.";
  return [
    now,
    "This label is a provisional operations line. It is built from Kp, and from S4 or the archive daily TEC change when those measurements are present. It is not proof that a receiver has failed.",
    "The classes are Low below Kp 3, Moderate from Kp 3 or S4 0.35 or a 4 TECU daily change, High from Kp 4 or S4 0.5 or an 8 TECU daily change, and Critical from Kp 5 or S4 0.7. The warning on this dashboard starts at High.",
    "Moderate means verify precision fixes and watch the Zimbabwe VTEC and the CORS count. High and Critical are the lines already used for a GNSS risk warning. ΔTEC, ROTI, and RTK rules stay unpublished until a quiet-day reference is validated.",
    "Over Zimbabwe the check is whether TEC or S4 on the CORS network has actually moved. This monitor reports the provisional label. It does not by itself mean a local GNSS outage.",
  ];
}
