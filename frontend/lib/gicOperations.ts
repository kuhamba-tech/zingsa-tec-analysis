import { getWithRetry } from "./api";
import { resolveClientApiUrl } from "./clientApiBase";

export interface GicSiteConfiguration {
  thresholds_a: number[];
  expected_cadence_seconds: number | null;
  logger_timezone: string | null;
  calibration_id: string | null;
  polarity_convention: string | null;
  transformer_id: string | null;
  transformer_metadata: Record<string, unknown>;
  commissioned: boolean;
  commissioning_reference: string | null;
  engineer_approved_by: string | null;
  engineer_approval_reference: string | null;
  engineer_approved_at: string | null;
}
export interface GicCoverage {
  records: number; valid_records: number; completeness_pct: number | null;
  missing_pct: number | null; expected_slots: number | null; cadence_seconds: number | null;
}
interface Metrics { mae_a: number; rmse_a: number; bias_a: number; samples: number }
export interface GicValidation {
  operationally_validated: boolean; reason: string; state: string[]; inputs: string;
  observation_model: string; uncertainty: string; assumptions: Record<string, number>;
  training_period: { start: string; end: string; purpose: string } | null;
  test_period: { start: string; end: string; method: string } | null;
  metrics: Record<string, Metrics> | null;
}
export interface GicSiteAssessment {
  station_id: string; name: string; coverage: GicCoverage;
  peak_abs_a: number | null; peak_signed_a: number | null;
  positive_samples: number; negative_samples: number;
  above_event_threshold_seconds: number | null; event_threshold_a: number;
  configuration: GicSiteConfiguration; validation: GicValidation;
  latest_valid_observation: string | null; latest_stored_measurement: string | null;
  data_age_seconds: number | null; sensor_health: string; communications: string;
  clock_offset_seconds: number | null; clock_check: string;
  observed_alerts: { time: string; current_a: number; polarity: string; provisional: boolean; fresh: boolean; engineering_action_authorized: boolean; duration_seconds: number | null }[];
}
export interface GicAssessment {
  window_start: string; window_end: string; operational_note: string; stations: GicSiteAssessment[];
  comparison: ({ t: string } & Record<string, string | number>)[];
}
export interface GicContextSource {
  id: string; unit: string; source: string; latest_observation: string | null; age_seconds: number | null;
  points: { t: string; value: number | null }[]; fetch_failed?: boolean; note?: string;
}
export interface GicContext { sources: GicContextSource[] }
export interface GicClimatology { grouping: string; note: string; rows: { period: string; geomagnetic_context: string; samples: number; mean_signed_a: number; median_signed_a: number; peak_abs_a: number; p95_abs_a: number }[] }
export const getGicAssessment = (hours: number) => getWithRetry<GicAssessment>("/gic/assessment", { hours });
export const getGicContext = (station_id: string, hours: number) => getWithRetry<GicContext>("/gic/context", { station_id, hours });
export const getGicClimatology = (station_id: string, grouping: string, seasons?: string) => getWithRetry<GicClimatology>("/gic/climatology", { station_id, grouping, seasons });
export async function saveGicConfiguration(station: string, configuration: GicSiteConfiguration, adminKey: string) {
  const url = new URL(resolveClientApiUrl("/gic/configuration"));
  url.searchParams.set("station_id", station);
  const response = await fetch(url, {
    method: "PUT", headers: { "Content-Type": "application/json", "X-GIC-Admin-Key": adminKey }, body: JSON.stringify(configuration),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(typeof error.detail === "string" ? error.detail : "Configuration validation failed; check engineering approval, cadence and commissioning fields.");
  }
  return response.json();
}
