import type {
  CelestrakAnalysisResponse,
  CelestrakDailyPoint,
  GfzKpAnalysisResponse,
  GfzKpDailyPoint,
  OmniAnalysisResponse,
  OmniDailyPoint,
  WdcKyotoAnalysisResponse,
  WdcKyotoDailyPoint,
} from "./types";

export type GeomagneticSourceId = "omni" | "celestrak" | "gfz" | "kyoto";

export interface SourceBundle {
  omni: OmniAnalysisResponse | null;
  celestrak: CelestrakAnalysisResponse | null;
  gfz: GfzKpAnalysisResponse | null;
  kyoto: WdcKyotoAnalysisResponse | null;
}

const SOURCE_COLORS: Record<GeomagneticSourceId, string> = {
  omni: "#168bd2",
  celestrak: "#ff8c00",
  gfz: "#00ff88",
  kyoto: "#f472b6",
};

const SOURCE_LABELS: Record<GeomagneticSourceId, string> = {
  omni: "NASA OMNIWeb",
  celestrak: "CelesTrak",
  gfz: "GFZ Potsdam (DE)",
  kyoto: "WDC Kyoto (JP)",
};

function byDate<T extends { date: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((r) => [r.date, r]));
}

export function unionDates(bundle: SourceBundle): string[] {
  const dates = new Set<string>();
  for (const row of bundle.omni?.series ?? []) dates.add(row.date);
  for (const row of bundle.celestrak?.series ?? []) dates.add(row.date);
  for (const row of bundle.gfz?.series ?? []) dates.add(row.date);
  for (const row of bundle.kyoto?.series ?? []) dates.add(row.date);
  return [...dates].sort();
}

function pick<T extends { date: string }>(
  dates: string[],
  rows: T[],
  getter: (row: T) => number | null | undefined,
): (number | null)[] {
  const map = byDate(rows);
  return dates.map((d) => {
    const row = map.get(d);
    if (!row) return null;
    const v = getter(row);
    return v === null || v === undefined ? null : v;
  });
}

export function kpComparison(bundle: SourceBundle, dates: string[]) {
  return (["omni", "celestrak", "gfz", "kyoto"] as const)
    .filter((id) => bundle[id]?.series.length)
    .map((id) => ({
      id,
      label: `${SOURCE_LABELS[id]} Kp`,
      color: SOURCE_COLORS[id],
      data:
        id === "omni"
          ? pick(dates, bundle.omni!.series, (r: OmniDailyPoint) => r.kp)
          : id === "celestrak"
            ? pick(dates, bundle.celestrak!.series, (r: CelestrakDailyPoint) => r.kp)
            : id === "gfz"
              ? pick(dates, bundle.gfz!.series, (r: GfzKpDailyPoint) => r.kp)
              : pick(dates, bundle.kyoto!.series, (r: WdcKyotoDailyPoint) => r.kp),
    }));
}

export function dstComparison(bundle: SourceBundle, dates: string[]) {
  const out: { id: GeomagneticSourceId; label: string; color: string; data: (number | null)[] }[] = [];
  if (bundle.omni?.series.length) {
    out.push({
      id: "omni",
      label: "NASA OMNIWeb Dst (daily min, nT)",
      color: SOURCE_COLORS.omni,
      data: pick(dates, bundle.omni.series, (r) => r.dst),
    });
  }
  if (bundle.kyoto?.series.length) {
    out.push({
      id: "kyoto",
      label: "WDC Kyoto Dst (daily min, nT)",
      color: SOURCE_COLORS.kyoto,
      data: pick(dates, bundle.kyoto.series, (r) => r.dst),
    });
  }
  return out;
}

/** Dst (NASA + Kyoto) and Ap (CelesTrak + Kyoto) on one dual-axis chart timeline. */
export function dstApDualAxisComparison(bundle: SourceBundle, dates: string[]) {
  const dstLines: {
    label: string;
    color: string;
    data: (number | null)[];
    yAxisId: "y";
  }[] = [];
  if (bundle.omni?.series.length) {
    dstLines.push({
      label: "NASA OMNIWeb Dst (nT)",
      color: SOURCE_COLORS.omni,
      data: pick(dates, bundle.omni.series, (r) => r.dst),
      yAxisId: "y",
    });
  }
  if (bundle.kyoto?.series.length) {
    dstLines.push({
      label: "WDC Kyoto Dst (nT)",
      color: SOURCE_COLORS.kyoto,
      data: pick(dates, bundle.kyoto.series, (r) => r.dst),
      yAxisId: "y",
    });
  }
  const apLines: {
    label: string;
    color: string;
    data: (number | null)[];
    yAxisId: "y2";
    dashed?: boolean;
  }[] = [];
  if (bundle.celestrak?.series.length) {
    apLines.push({
      label: "CelesTrak Ap (daily mean)",
      color: SOURCE_COLORS.celestrak,
      data: pick(dates, bundle.celestrak.series, (r) => r.ap),
      yAxisId: "y2",
    });
  }
  if (bundle.kyoto?.series.length) {
    apLines.push({
      label: "WDC Kyoto Ap (definitive daily)",
      color: SOURCE_COLORS.kyoto,
      data: pick(dates, bundle.kyoto.series, (r) => r.ap_daily ?? r.ap),
      yAxisId: "y2",
      dashed: true,
    });
  }
  return { dstLines, apLines, datasets: [...dstLines, ...apLines] };
}

export function f107Comparison(bundle: SourceBundle, dates: string[]) {
  return (["omni", "celestrak"] as const)
    .filter((id) => bundle[id]?.series.length)
    .map((id) => ({
      id,
      label: `${SOURCE_LABELS[id]} F10.7`,
      color: SOURCE_COLORS[id],
      data:
        id === "omni"
          ? pick(dates, bundle.omni!.series, (r: OmniDailyPoint) => r.f107)
          : pick(dates, bundle.celestrak!.series, (r: CelestrakDailyPoint) => r.f107),
    }));
}

export function ssnComparison(bundle: SourceBundle, dates: string[]) {
  return (["omni", "celestrak"] as const)
    .filter((id) => bundle[id]?.series.length)
    .map((id) => ({
      id,
      label: `${SOURCE_LABELS[id]} SSN`,
      color: SOURCE_COLORS[id],
      data:
        id === "omni"
          ? pick(dates, bundle.omni!.series, (r: OmniDailyPoint) => r.ssn)
          : pick(dates, bundle.celestrak!.series, (r: CelestrakDailyPoint) => r.ssn),
    }));
}

export function apComparison(bundle: SourceBundle, dates: string[]) {
  const out: { id: GeomagneticSourceId; label: string; color: string; data: (number | null)[] }[] = [];
  if (bundle.celestrak?.series.length) {
    out.push({
      id: "celestrak",
      label: "CelesTrak Ap (daily mean)",
      color: SOURCE_COLORS.celestrak,
      data: pick(dates, bundle.celestrak.series, (r) => r.ap),
    });
  }
  if (bundle.gfz?.series.length) {
    out.push({
      id: "gfz",
      label: "GFZ Ap (daily planetary)",
      color: SOURCE_COLORS.gfz,
      data: pick(dates, bundle.gfz.series, (r) => r.ap_daily ?? r.ap),
    });
  }
  if (bundle.kyoto?.series.length) {
    out.push({
      id: "kyoto",
      label: "WDC Kyoto Ap (definitive daily)",
      color: SOURCE_COLORS.kyoto,
      data: pick(dates, bundle.kyoto.series, (r) => r.ap_daily ?? r.ap),
    });
  }
  return out;
}

export function cpGfzOnly(bundle: SourceBundle, dates: string[]) {
  if (!bundle.gfz?.series.length) return null;
  return {
    label: "GFZ Cp (daily planetary)",
    color: SOURCE_COLORS.gfz,
    data: pick(dates, bundle.gfz.series, (r) => r.cp),
  };
}

export interface KpDiffRow {
  date: string;
  omni: number | null;
  celestrak: number | null;
  gfz: number | null;
  kyoto: number | null;
  maxSpread: number | null;
}

export function kpDifferenceTable(bundle: SourceBundle, dates: string[]): KpDiffRow[] {
  const omni = byDate(bundle.omni?.series ?? []);
  const cel = byDate(bundle.celestrak?.series ?? []);
  const gfz = byDate(bundle.gfz?.series ?? []);
  const kyoto = byDate(bundle.kyoto?.series ?? []);

  return dates
    .map((date) => {
      const o = omni.get(date)?.kp ?? null;
      const c = cel.get(date)?.kp ?? null;
      const g = gfz.get(date)?.kp ?? null;
      const j = kyoto.get(date)?.kp ?? null;
      const vals = [o, c, g, j].filter((v): v is number => v !== null);
      const maxSpread = vals.length >= 2 ? Math.max(...vals) - Math.min(...vals) : null;
      return { date, omni: o, celestrak: c, gfz: g, kyoto: j, maxSpread };
    })
    .filter((row) => row.omni !== null || row.celestrak !== null || row.gfz !== null || row.kyoto !== null);
}

export function stormDatesUnion(bundle: SourceBundle): string[] {
  const dates = new Set<string>();
  for (const s of bundle.omni?.storms ?? []) dates.add(s.date);
  for (const s of bundle.celestrak?.storms ?? []) dates.add(s.date);
  for (const s of bundle.gfz?.storms ?? []) dates.add(s.date);
  for (const s of bundle.kyoto?.storms ?? []) dates.add(s.date);
  return [...dates].sort();
}

export function loadedSourceCount(bundle: SourceBundle): number {
  return [bundle.omni, bundle.celestrak, bundle.gfz, bundle.kyoto].filter(
    (s) => s && s.series.length > 0,
  ).length;
}

export function fmt(v: number | null | undefined, digits = 1, suffix = ""): string {
  if (v === null || v === undefined) return "—";
  return `${v.toFixed(digits)}${suffix}`;
}
