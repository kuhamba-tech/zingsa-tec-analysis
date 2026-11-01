import type { SolarActivityFull } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LETTERS = ["A", "B", "C", "M", "X"] as const;
export type FlareLetter = (typeof LETTERS)[number];

const RANK: Record<FlareLetter, number> = { A: 1, B: 2, C: 3, M: 4, X: 5 };
/** A C, M, or X peak inside this window is an eruption alert. */
const ALERT_WINDOW_MS = 48 * 60 * 60 * 1000;

export type FlarePeak = {
  classText: string;
  letter: FlareLetter;
  peakMs: number;
  peakLabel: string;
};

export type FlareWatch = {
  currentClass: string | null;
  currentLetter: FlareLetter | null;
  counts: Record<FlareLetter, number>;
  recent: FlarePeak[];
  latest: FlarePeak | null;
  /** Newest C, M, or X peak in the feed, including one outside the alert window. */
  lastSignificant: FlarePeak | null;
  /** Newest C, M, or X peak inside the alert window. */
  alert: FlarePeak | null;
  cmeNearAlert: boolean;
};

export function flareLetterOf(value: string | null | undefined): FlareLetter | null {
  const match = (value || "").trim().match(/^([ABCMX])/i);
  if (!match) return null;
  const letter = match[1].toUpperCase();
  return letter in RANK ? (letter as FlareLetter) : null;
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

function readClass(row: Record<string, unknown>): string | null {
  const raw = String(row.classType ?? row.class ?? row.max_class ?? "").trim();
  const match = raw.match(/^([ABCMX])(\d+(?:\.\d+)?)?/i);
  if (!match) return null;
  return match[2] ? `${match[1].toUpperCase()}${match[2]}` : match[1].toUpperCase();
}

function readPeak(row: Record<string, unknown>): FlarePeak | null {
  const classText = readClass(row);
  const letter = flareLetterOf(classText);
  const peakMs = parseTime(row.peakTime ?? row.max_time ?? row.beginTime ?? row.begin_time);
  if (!classText || !letter || peakMs == null) return null;
  return { classText, letter, peakMs, peakLabel: formatUtc(peakMs) };
}

function cmeNear(cmes: Record<string, unknown>[], peakMs: number): boolean {
  return cmes.some((cme) => {
    const start = parseTime(cme.startTime ?? cme.start_time);
    if (start == null) return false;
    const gap = start - peakMs;
    return gap >= -60 * 60 * 1000 && gap <= 12 * 60 * 60 * 1000;
  });
}

export function buildFlareWatch(solar: SolarActivityFull | null, now = Date.now()): FlareWatch {
  const counts: Record<FlareLetter, number> = { A: 0, B: 0, C: 0, M: 0, X: 0 };
  const peaks: FlarePeak[] = [];
  const rows = Array.isArray(solar?.donki_flares) ? solar.donki_flares : [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const peak = readPeak(row as Record<string, unknown>);
    if (!peak) continue;
    counts[peak.letter] += 1;
    peaks.push(peak);
  }
  peaks.sort((a, b) => b.peakMs - a.peakMs);
  const latest = peaks[0] ?? null;
  const lastSignificant = peaks.find((peak) => RANK[peak.letter] >= RANK.C) ?? null;
  const alert =
    lastSignificant &&
    now - lastSignificant.peakMs <= ALERT_WINDOW_MS &&
    lastSignificant.peakMs <= now + 5 * 60 * 1000
      ? lastSignificant
      : null;
  const currentClass = flareLetterOf(solar?.flare_class) ? solar?.flare_class?.trim() ?? null : null;
  const cmes = Array.isArray(solar?.donki_cmes) ? solar.donki_cmes : [];
  return {
    currentClass,
    currentLetter: flareLetterOf(currentClass),
    counts,
    recent: peaks.slice(0, 6),
    latest,
    lastSignificant,
    alert,
    cmeNearAlert: alert ? cmeNear(cmes as Record<string, unknown>[], alert.peakMs) : false,
  };
}

function classPlace(letter: FlareLetter): string {
  if (letter === "X") return "X is the highest class.";
  if (letter === "M") return "M is the second-highest class.";
  if (letter === "C") return "C is a small flare, below M and X.";
  if (letter === "B") return "B is a low flare, below the C, M, and X alert line.";
  return "A is the quiet end of the scale.";
}

/** Paraphrased class guide. The measured class and peak time come from GOES, not from a social post. */
export function flareGuideParagraphs(watch: FlareWatch): string[] {
  const subject = watch.alert ?? watch.latest;
  const named = subject
    ? `This feed's ${subject === watch.alert ? "alerted" : "newest"} flare is ${subject.classText}, with the soft X-ray peak at ${subject.peakLabel}. ${classPlace(subject.letter)}`
    : "No flare peak is listed in the current GOES feed.";
  const cme = watch.alert
    ? watch.cmeNearAlert
      ? "A coronal mass ejection is listed with a start near this peak. The class alone does not say it is aimed at Earth."
      : "No coronal mass ejection in this feed starts near the peak. The class alone cannot say whether one left the Sun."
    : "A flare class does not by itself mean a coronal mass ejection left the Sun.";
  return [
    named,
    "A solar flare is a burst of radiation when magnetic fields on the Sun reconnect and heat the surrounding plasma. GOES times that burst in the 0.1–0.8 nm soft X-ray band.",
    "The classes run A, B, C, M, then X. Each letter is about ten times the X-ray flux of the letter before it. The number is the size inside that letter.",
    "From C class upward, high-frequency radio on the sunlit side of Earth can fade for minutes. The X-rays arrive in about eight minutes. Zimbabwe is in that path only while the country is in daylight. The GNSS check on this page is a change in TEC or S4 on the CORS network.",
    `${cme} If an ejection is aimed at Earth, it usually takes one to several days to arrive. That later arrival is what can disturb the geomagnetic field, navigation, satellites, and power systems. SDO images the disk. NOAA SWPC publishes the GOES class. The follow-up is whether any ejection is Earth-directed.`,
  ];
}
