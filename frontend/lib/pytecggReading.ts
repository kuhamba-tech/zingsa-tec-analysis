export type PytecggReading = {
  gg_engine?: string;
  gg_version?: string;
  gg_vtec?: number | null;
  gg_time?: string | null;
  gg_veq?: number | null;
  gg_status?: string;
  gg_batch_cutoff?: string;
};

/** One freshness and engine rule for both Zimbabwe and South Africa. */
export function freshPytecggReading(row: PytecggReading, collectorAgeS = 0, now = Date.now()): boolean {
  const age = now - Date.parse(row.gg_time ?? "");
  return collectorAgeS <= 180 && row.gg_engine === "pytecgg" && row.gg_version === "1.3.0"
    && typeof row.gg_vtec === "number" && Number.isFinite(row.gg_vtec) && row.gg_vtec > 0
    && Number.isFinite(age) && age >= -120000 && age <= 600000;
}
