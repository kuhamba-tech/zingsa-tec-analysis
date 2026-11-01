import type { ImfSeries, SolarActivityFull, TimelinePoint } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Southward coupling line already used by the Zimbabwe Bz alert. */
const COUPLING_NT = -5;

export const BZ_BANDS = [
  { id: "strong-north", label: "N strong", desc: "≥5", color: "#00ff88" },
  { id: "north", label: "North", desc: "≥0.5", color: "#38bdf8" },
  { id: "mixed", label: "Mixed", desc: "~0", color: "#eab308" },
  { id: "south", label: "South", desc: "≤−0.5", color: "#f97316" },
  { id: "coupling", label: "Coupling", desc: "≤−5", color: "#ef4444" },
] as const;

export type BzBandId = (typeof BZ_BANDS)[number]["id"];

export type BzEpisode = {
  bz: number;
  timeLabel: string;
};

export type ImfBzWatch = {
  bz: number | null;
  bt: number | null;
  southMinutes: number | null;
  band: BzBandId | null;
  bandLabel: string | null;
  observedLabel: string | null;
  counts: Record<BzBandId, number>;
  episodes: BzEpisode[];
  alert: string | null;
};

export function bzBandOf(bz: number | null | undefined): BzBandId | null {
  if (bz == null || !Number.isFinite(bz)) return null;
  if (bz >= 5) return "strong-north";
  if (bz >= 0.5) return "north";
  if (bz > -0.5) return "mixed";
  if (bz > COUPLING_NT) return "south";
  return "coupling";
}

export function bzBandLabel(band: BzBandId | null): string | null {
  return BZ_BANDS.find((item) => item.id === band)?.label ?? null;
}

export function imfSeriesPoints(imf: ImfSeries | null | undefined): TimelinePoint[] {
  if (!imf || !Array.isArray(imf.bz) || !Array.isArray(imf.times)) return [];
  return imf.times.map((time, index) => ({ t: time, v: imf.bz[index] ?? null }));
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

function signed(value: number): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}`;
}

function countBands(points: TimelinePoint[] | null | undefined, current: BzBandId | null): Record<BzBandId, number> {
  const counts: Record<BzBandId, number> = {
    "strong-north": 0,
    north: 0,
    mixed: 0,
    south: 0,
    coupling: 0,
  };
  const samples = (points ?? []).filter((point) => finite(point.v));
  if (!samples.length) {
    if (current) counts[current] = 1;
    return counts;
  }
  for (const point of samples) {
    const band = bzBandOf(point.v);
    if (band) counts[band] += 1;
  }
  return counts;
}

function couplingEpisodes(points: TimelinePoint[] | null | undefined): BzEpisode[] {
  const samples = (points ?? [])
    .map((point) => ({ t: Date.parse(point.t), v: point.v }))
    .filter((point) => Number.isFinite(point.t) && finite(point.v))
    .sort((a, b) => a.t - b.t);
  const episodes: BzEpisode[] = [];
  let open: { bz: number; time: number } | null = null;
  const close = () => {
    if (!open) return;
    const label = formatUtc(open.time);
    if (label) episodes.push({ bz: open.bz, timeLabel: label });
    open = null;
  };
  for (const sample of samples) {
    if (sample.v <= COUPLING_NT) {
      if (!open || sample.v <= open.bz) open = { bz: sample.v, time: sample.t };
    } else {
      close();
    }
  }
  close();
  return episodes.slice(-6).reverse();
}

export function buildImfBzWatch(
  solar: SolarActivityFull | null,
  points?: TimelinePoint[] | null,
): ImfBzWatch {
  const wind = solar?.solar_wind;
  const feed = solar?.feed_status?.solar_wind_mag;
  const stale = feed?.fresh === false;
  const bz = !stale && finite(wind?.bz) ? wind.bz : null;
  const bt = !stale && finite(wind?.bt) && wind.bt > 0 ? wind.bt : null;
  const southMinutes = finite(wind?.southward_duration_minutes) ? wind.southward_duration_minutes : null;
  const band = bzBandOf(bz);
  const alert = bz != null && bz <= COUPLING_NT
    ? `Bz ${signed(bz)} nT is south of the coupling line at ${COUPLING_NT} nT.`
    : null;
  return {
    bz,
    bt,
    southMinutes,
    band,
    bandLabel: bzBandLabel(band),
    observedLabel: formatUtc(typeof feed?.timestamp === "string" ? feed.timestamp : solar?.updated ?? null),
    counts: countBands(points, band),
    episodes: couplingEpisodes(points),
    alert,
  };
}

export function imfBzGuideParagraphs(watch: ImfBzWatch): string[] {
  const now = watch.bz != null && watch.bandLabel
    ? `The measured IMF Bz is ${signed(watch.bz)} nT, class ${watch.bandLabel}${watch.observedLabel ? `, at ${watch.observedLabel}` : ""}.`
    : "IMF Bz is not in the current RTSW sample.";
  const duration = watch.southMinutes != null && watch.southMinutes > 0
    ? ` This sample ends a southward run of ${Math.round(watch.southMinutes)} minutes.`
    : "";
  return [
    `${now}${duration}`,
    "IMF Bz is the north-south part of the interplanetary magnetic field carried by the solar wind. NOAA RTSW measures it at L1 in GSM coordinates. Negative Bz points south.",
    "The classes are strong north at 5 nT and above, north from 0.5 nT, mixed near zero, south from −0.5 nT, and coupling at −5 nT and further south. South on the card is a direction. The alert starts at the coupling line.",
    "Southward Bz connects the solar wind to Earth's magnetic field. A brief spike is a fluctuation. A run of southward Bz near −5 to −10 nT, with a fast stream, is the coupling that can lift Kp and Dst. Bt says how strong the whole field is.",
    "Over Zimbabwe the check after that coupling is a change in TEC or S4 on the CORS network. This monitor reports the measured field. It does not by itself mean a geomagnetic storm.",
  ];
}
