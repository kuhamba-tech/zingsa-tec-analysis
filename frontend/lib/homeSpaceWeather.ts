import type { EkfStatus, SpaceWeatherCurrent } from "./types";

export interface HomeSwMergeResult {
  data: SpaceWeatherCurrent;
  ekfFilled: Set<string>;
  source: "live" | "ekf" | "mixed";
}

function latestEkfPredicted(
  series: { points: { predicted: number | null }[] } | undefined,
): number | null {
  const points = series?.points ?? [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p = points[i]?.predicted;
    if (p != null && Number.isFinite(p)) return p;
  }
  return null;
}

export function kpConditionFromValue(kp: number): { label: string; color: string } {
  if (kp < 3) return { label: "Quiet", color: "#00f5a0" };
  if (kp < 4) return { label: "Unsettled", color: "#eab308" };
  if (kp < 5) return { label: "Active", color: "#f97316" };
  if (kp < 6) return { label: "Minor storm", color: "#ef4444" };
  return { label: "Storm", color: "#dc2626" };
}

/** Fill null headline fields from the latest EKF prediction (real history only). */
export function mergeSpaceWeatherWithEkf(
  sw: SpaceWeatherCurrent | null,
  ekf: EkfStatus | null,
): HomeSwMergeResult | null {
  if (!sw && !ekf) return null;

  const base: SpaceWeatherCurrent = sw ?? {
    kp: null,
    kp_condition: null,
    kp_color: null,
    dst: null,
    f107: null,
    s4: null,
    gnss_risk: null,
    gnss_risk_color: null,
    stations_online: null,
    stations_total: 24,
    plasma_speed: null,
    updated_utc: null,
  };

  const ekfFilled = new Set<string>();
  const series = ekf?.series ?? {};
  const out = { ...base };

  const fill = (key: keyof SpaceWeatherCurrent, ekfKey: string, transform?: (v: number) => number) => {
    if (out[key] != null) return;
    const pred = latestEkfPredicted(series[ekfKey]);
    if (pred == null) return;
    (out as Record<string, unknown>)[key] = transform ? transform(pred) : pred;
    ekfFilled.add(String(key));
  };

  fill("kp", "kp");
  fill("dst", "dst");
  fill("f107", "f107");
  fill("plasma_speed", "solar_wind");
  fill("s4", "s4");
  fill("stations_online", "stations_online", (v) => Math.round(v));

  if (out.kp != null && (out.kp_condition == null || ekfFilled.has("kp"))) {
    const cond = kpConditionFromValue(out.kp);
    out.kp_condition = cond.label;
    out.kp_color = cond.color;
    if (ekfFilled.has("kp")) ekfFilled.add("kp_condition");
  }

  const source =
    !sw && ekfFilled.size > 0 ? "ekf" : ekfFilled.size > 0 ? "mixed" : "live";

  return { data: out, ekfFilled, source };
}

export function ekfNoteForKey(key: string, ekfFilled: Set<string>): string | null {
  return ekfFilled.has(key) ? "EKF predicted" : null;
}
