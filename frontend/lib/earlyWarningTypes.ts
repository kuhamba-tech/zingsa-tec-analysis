export type EarlyWarningAuthority = "official_noaa" | "zingsa_experimental" | "zimbabwe_gnss";
export type EarlyWarningCategory =
  | "solar_activity"
  | "solar_wind_imf"
  | "geomagnetic"
  | "zimbabwe_gnss";
export type EarlyWarningSeverity = "advisory" | "watch" | "warning" | "severe";
export type EarlyWarningStatus = "active" | "watch" | "resolved";

export type EarlyWarningAlert = {
  alert_id: string;
  rule_id: string;
  authority: EarlyWarningAuthority | string;
  category: EarlyWarningCategory | string;
  severity: EarlyWarningSeverity | string;
  status: EarlyWarningStatus | string;
  title: string;
  message: string;
  observed_value: number | null;
  threshold: number | null;
  unit: string | null;
  duration_minutes: number | null;
  observation_time: string | null;
  data_age_minutes: number | null;
  source: string;
  first_detected: string;
  last_updated: string;
  resolved_at: string | null;
  related?: Record<string, unknown>;
  acknowledged_status?: boolean;
};

export type EarlyWarningSummary = {
  highest_severity: string;
  active_count: number;
  by_authority: Record<string, number>;
  cooldown_minutes: number;
  sustain_minutes: number;
};

export type EarlyWarningSnapshot = {
  summary: EarlyWarningSummary;
  active: EarlyWarningAlert[];
  history: EarlyWarningAlert[];
  diagnostics: Record<string, unknown>;
  authority_legend: Record<string, string>;
  notification_settings?: {
    dashboard: boolean;
    email: boolean;
    whatsapp: boolean;
    note: string;
  };
};

export const AUTHORITY_LABELS: Record<string, string> = {
  official_noaa: "International bulletins",
  zingsa_experimental: "ZINGSA heliospheric drivers",
  zimbabwe_gnss: "Zimbabwe GNSS impact",
};

export const CATEGORY_LABELS: Record<string, string> = {
  solar_activity: "Solar activity",
  solar_wind_imf: "Solar wind / IMF",
  geomagnetic: "Geomagnetic activity",
  zimbabwe_gnss: "Zimbabwe GNSS impact",
};
