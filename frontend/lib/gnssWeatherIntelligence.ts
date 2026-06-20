export type ForecastStatus = "excellent" | "moderate" | "warning";

export interface GnssForecastCity {
  city: string;
  emoji: string;
  status: ForecastStatus;
  statusLabel: string;
  fields: { label: string; value: string }[];
  cause?: string;
  recommendation?: string;
  effects?: string[];
}

export interface DigitalTwinSite {
  city: string;
  status: ForecastStatus;
  statusLabel: string;
  rtk: string;
  accuracy: string;
  confidence?: string;
  reason?: string;
  cause?: string;
  recommendations?: string[];
}

export interface IndustryAlert {
  id: string;
  icon: string;
  title: string;
  lines: string[];
}

export const CORS_INPUTS = [
  "TEC",
  "Scintillation",
  "Cycle slips",
  "Multipath",
  "Satellite visibility",
  "RTK success rate",
  "Position error",
];

export const SPACE_WEATHER_INPUTS = [
  "Solar activity",
  "Kp index",
  "Dst index",
  "Solar wind speed",
  "Geomagnetic storms",
  "Solar flares",
];

export const AI_LEARNS = [
  "RTK fixing time",
  "Accuracy",
  "GNSS availability",
  "Drone risk",
];

export const PLATFORM_MODULES = [
  "RTK Correction Engine",
  "Smart CORS Selection",
  "Accuracy Prediction",
  "GNSS Weather Forecast",
  "Space Weather Alerts",
  "Zimbabwe GNSS Digital Twin",
  "User Applications",
  "API Marketplace",
];

export const STATUS_COLORS: Record<ForecastStatus, string> = {
  excellent: "#00ff88",
  moderate: "#ff8c00",
  warning: "#ef4444",
};
