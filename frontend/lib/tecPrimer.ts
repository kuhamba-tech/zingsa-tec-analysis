/** Shared TEC education copy for metric cards and VTEC timeline panels. */

export const TEC_DEFINITION =
  "TEC (Total Electron Content) is the line integral of electron density Ne along the GNSS signal path through the ionosphere.";

export const TEC_FORMULA = "TEC = ∫_path Ne ds";

export const TEC_UNIT = "1 TECU = 10¹⁶ electrons/m²";

export const TEC_TYPICAL_VALUES: { condition: string; range: string }[] = [
  { condition: "Night, quiet sun", range: "1–10 TECU" },
  { condition: "Day, quiet sun", range: "10–40 TECU" },
  { condition: "Day, high solar activity", range: "50–100 TECU" },
  { condition: "Extreme solar storm", range: ">200 TECU" },
];

export const TEC_OPERATIONAL_NOTE =
  "Zimbabwe reports VTEC (vertical TEC) from live CORS/GNSS. High VTEC alone is not ionospheric disturbance — ΔTEC relative to a quiet reference and ROTI are under development. Do not classify local disturbance solely from Kp.";

/** Place a live VTEC reading in the typical-value context. */
export function tecTypicalContext(vtec: number): string {
  if (!Number.isFinite(vtec)) return "";
  if (vtec < 1) return "Below typical night quiet-sun levels.";
  if (vtec <= 10) return "Within the night / quiet-sun band (≈1–10 TECU).";
  if (vtec <= 40) return "Within the day / quiet-sun band (≈10–40 TECU).";
  if (vtec <= 100) return "Elevated — typical of day / high solar activity (≈50–100 TECU).";
  if (vtec <= 200) return "Very high — above usual high-activity daytime levels.";
  return "Extreme — exceeds typical extreme-storm thresholds (>200 TECU).";
}
