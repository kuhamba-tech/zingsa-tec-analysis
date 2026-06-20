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

export const GNSS_ARCHITECTURE_ASCII = `                    SUN
                     |
             Solar Activity Data
                     |
       -----------------------------
       |                           |
 NOAA / Space Weather        Zimbabwe CORS
 Kp, Dst, Solar Wind          TEC, GNSS errors

                     |
                     v

        GNSS WEATHER AI ENGINE

                     |
                     v

        National Positioning Forecast`;

export const NATIONAL_ARCHITECTURE_ASCII = `             GNSS Satellites

                    v

          Zimbabwe CORS Network

                    v

================================

 NATIONAL POSITIONING INTELLIGENCE

================================


Modules:

  RTK Correction Engine
  Smart CORS Selection
  Accuracy Prediction
  GNSS Weather Forecast
  Space Weather Alerts
  Zimbabwe GNSS Digital Twin
  User Applications
  API Marketplace


                    v


Survey | Drone | Farming | Transport | Mining`;

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

/** Illustrative product examples — vision layer, not live operational forecasts yet. */
export const SAMPLE_FORECASTS: GnssForecastCity[] = [
  {
    city: "HARARE",
    emoji: "🟢",
    status: "excellent",
    statusLabel: "Excellent",
    fields: [
      { label: "GNSS Condition", value: "Excellent" },
      { label: "RTK Reliability", value: "98%" },
      { label: "Expected Accuracy", value: "1–2 cm" },
      { label: "Best Survey Window", value: "07:00 – 14:00" },
      { label: "Satellites", value: "Good geometry" },
    ],
  },
  {
    city: "MUTARE",
    emoji: "🟡",
    status: "moderate",
    statusLabel: "Moderate",
    fields: [
      { label: "GNSS Condition", value: "Moderate" },
      { label: "Expected Accuracy", value: "~10 cm" },
    ],
    cause: "Ionosphere activity increasing",
    recommendation: "Use network correction",
  },
  {
    city: "VICTORIA FALLS",
    emoji: "🟠",
    status: "warning",
    statusLabel: "Warning",
    fields: [{ label: "Time", value: "After 16:00" }],
    cause: "Possible ionosphere disturbance",
    effects: [
      "Longer RTK fixing time",
      "Reduced accuracy",
      "Drone mapping risk",
    ],
  },
];

export const DIGITAL_TWIN_SITES: DigitalTwinSite[] = [
  {
    city: "Harare",
    status: "excellent",
    statusLabel: "Available",
    rtk: "Available",
    accuracy: "2 cm possible",
    confidence: "97%",
    recommendations: [],
  },
  {
    city: "Mutare",
    status: "moderate",
    statusLabel: "Elevated variation",
    rtk: "Use network correction",
    accuracy: "~10 cm expected",
    reason: "High TEC variation",
    cause: "Ionospheric activity",
    recommendations: ["Survey: morning preferred", "Drone: medium risk", "Transport: normal"],
  },
];

export const INDUSTRY_ALERTS: IndustryAlert[] = [
  {
    id: "surveyor",
    icon: "⚠️",
    title: "Surveyor Alert — GNSS Accuracy",
    lines: [
      "Location: Mutare",
      "RTK risk: Medium",
      "Expected accuracy reduced: 2 cm → 10 cm",
      "Recommended work: Before 11:00",
    ],
  },
  {
    id: "drone",
    icon: "🚁",
    title: "Drone GNSS Alert",
    lines: [
      "Area: Victoria Falls",
      "After 16:00 — Risk: HIGH",
      "Possible RTK interruptions",
      "Recommended: Fly earlier",
    ],
  },
  {
    id: "farmer",
    icon: "🌱",
    title: "Smart Agriculture Alert",
    lines: [
      "Tomorrow — GNSS Quality: Excellent",
      "✓ Boundary mapping",
      "✓ Precision spraying",
      "✓ Tractor guidance",
      "Window: 08:00 – 13:00",
    ],
  },
  {
    id: "transport",
    icon: "🚗",
    title: "Transport Position Alert",
    lines: [
      "GNSS Quality: Normal",
      "Expected positioning: 0.8 – 1.5 m",
      "No action required",
    ],
  },
];

export const STATUS_COLORS: Record<ForecastStatus, string> = {
  excellent: "#00ff88",
  moderate: "#ff8c00",
  warning: "#ef4444",
};
