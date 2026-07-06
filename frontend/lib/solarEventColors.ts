/** GOES flare-class and DONKI 7-day event count colours — aligned with the flare scale legend. */
export const FLARE_SCALE = [
  { cls: "A", color: "#22c55e", label: "A-Class", desc: "Background" },
  { cls: "B", color: "#eab308", label: "B-Class", desc: "Minor" },
  { cls: "C", color: "#f97316", label: "C-Class", desc: "Moderate" },
  { cls: "M", color: "#ef4444", label: "M-Class", desc: "Major" },
  { cls: "X", color: "#a855f7", label: "X-Class", desc: "Extreme" },
] as const;

const QUIET = "#22c55e";
const MINOR = "#eab308";
const MODERATE = "#f97316";
const MAJOR = "#ef4444";
const EXTREME = "#a855f7";
const MUTED = "#94a3b8";

const FLARE_RANK: Record<string, number> = { A: 1, B: 2, C: 3, M: 4, X: 5 };

function flareLetter(value: string | null | undefined): string {
  const letter = (value || "A")[0]?.toUpperCase();
  return letter && letter in FLARE_RANK ? letter : "A";
}

export function flareClassColor(flareClass: string | null | undefined): string {
  if (!flareClass || flareClass === "N/A") return MUTED;
  return FLARE_SCALE.find((f) => f.cls === flareLetter(flareClass))?.color ?? "#ffffff";
}

function worstFlareLetter(flares: Record<string, unknown>[]): string {
  let worst = "A";
  for (const flare of flares) {
    const letter = flareLetter(String(flare.classType ?? flare.class ?? "A"));
    if ((FLARE_RANK[letter] ?? 0) > (FLARE_RANK[worst] ?? 0)) worst = letter;
  }
  return worst;
}

function cmeHasEarthDirected(cmes: Record<string, unknown>[]): boolean {
  return cmes.some((cme) => {
    const analyses = (cme.cmeAnalyses as Record<string, unknown>[] | undefined) ?? [];
    const analysis = analyses.find((a) => a.isMostAccurate) ?? analyses[0];
    const halfAngle = Number(analysis?.halfAngle ?? 0);
    return Boolean(cme.linkedEvents) || halfAngle >= 120;
  });
}

function maxGstKp(storms: Record<string, unknown>[]): number | null {
  let max: number | null = null;
  for (const storm of storms) {
    const rows = (storm.allKpIndex as { kpIndex?: number }[] | undefined) ?? [];
    for (const row of rows) {
      const kp = row.kpIndex;
      if (kp != null && Number.isFinite(kp) && (max == null || kp > max)) max = kp;
    }
  }
  return max;
}

/** 7-day flare count — worst class in the window, then event-rate fallback. */
export function donkiFlareCountColor(
  count: number,
  flares: Record<string, unknown>[],
): string {
  if (count === 0) return QUIET;
  if (flares.length > 0) return flareClassColor(worstFlareLetter(flares));
  if (count >= 40) return MAJOR;
  if (count >= 15) return MODERATE;
  if (count >= 5) return MINOR;
  return QUIET;
}

/** 7-day CME count — earth-directed/halo CMEs elevate severity. */
export function donkiCmeCountColor(count: number, cmes: Record<string, unknown>[]): string {
  if (count === 0) return QUIET;
  if (cmeHasEarthDirected(cmes)) return MAJOR;
  if (count >= 30) return MAJOR;
  if (count >= 12) return MODERATE;
  if (count >= 4) return MINOR;
  return QUIET;
}

/** 7-day geomagnetic storm count — uses peak Kp from GST records when available. */
export function donkiStormCountColor(
  count: number,
  storms: Record<string, unknown>[],
): string {
  if (count === 0) return QUIET;
  const peakKp = maxGstKp(storms);
  if (peakKp != null && peakKp >= 8) return EXTREME;
  if (peakKp != null && peakKp >= 6) return MAJOR;
  if (peakKp != null && peakKp >= 5) return MODERATE;
  if (count >= 3) return MAJOR;
  if (count >= 1) return MINOR;
  return QUIET;
}
