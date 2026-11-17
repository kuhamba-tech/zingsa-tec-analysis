import type { TrigNetStation } from "./types";

/** Match Zimbabwe: map G uses the shared pipeline's screened station value. */
export function trigNetTecReading(row: TrigNetStation, now = Date.now(), collectorAgeS?: number) {
  if (collectorAgeS != null && collectorAgeS > 180) return null;
  const valid = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0 && value < 200;
  const fresh = (time: string | null | undefined) => {
    const age = now - Date.parse(time ?? "");
    return Number.isFinite(age) && age >= -120_000 && age <= 600_000;
  };
  if (valid(row.vtec) && fresh(row.vtec_time)) {
    return { value: row.vtec, observedAt: row.vtec_time, provisional: false };
  }
  // Raw estimates remain diagnostics; rejected values must not reappear as G.
  return null;
}
