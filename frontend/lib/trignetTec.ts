import type { TrigNetStation } from "./types";

/** Display actual calculations without treating rejected raw estimates as screened G. */
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
  const rawTime = row.raw_code_vtec_time
    ?? row.tec_diagnostics?.last_code_vtec_at
    ?? row.tec_diagnostics?.last_vtec_at;
  if (valid(row.raw_code_vtec) && fresh(rawTime)) {
    return { value: row.raw_code_vtec, observedAt: rawTime, provisional: true };
  }
  return null;
}
