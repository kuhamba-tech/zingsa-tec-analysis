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
  ionoStress?: number;
  feedReliability?: number;
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

export interface GnssPerformanceStage {
  stage: string;
  title: string;
  output: string;
  detail: string;
  confidence: number;
}

export interface GnssPerformanceForecast {
  stormProbability: number;
  expectedKp: number;
  expectedDst: number;
  currentTec: number | null;
  forecastTec30m: number;
  forecastTec1h: number;
  forecastTec6h: number;
  forecastTec24h: number;
  rotiCurrent: number;
  roti30m: number;
  roti1h: number;
  scintillationProbability: number;
  cycleSlipProbability: number;
  expectedCycleSlipsPerHour: number;
  pppConvergenceMinutes: number;
  horizontalErrorM: number;
  verticalErrorM: number;
  integrityIndex: number;
  integrityLabel: "Excellent" | "Good" | "Moderate" | "Poor";
  advisory: string;
  stages: GnssPerformanceStage[];
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
