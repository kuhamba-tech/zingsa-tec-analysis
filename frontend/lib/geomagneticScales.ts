/** Shared geomagnetic index colour scales (dashboard + sidebar reference). */

export type ScaleItem = { range: string; text: string; color: string };
export type ScaleRow = { id: string; label: string; items: ScaleItem[] };

export const KP_SCALE_ROW: ScaleRow = {
  id: "kp",
  label: "Kp Scale",
  items: [
    { range: "0-2", text: "Quiet", color: "#00ff88" },
    { range: "3", text: "Unsettled", color: "#52e34f" },
    { range: "4", text: "Active", color: "#c8f018" },
    { range: "5", text: "G1", color: "#ffb000" },
    { range: "6", text: "G2", color: "#ff7a00" },
    { range: "7", text: "G3", color: "#ff2e2e" },
    { range: "8", text: "G4", color: "#ff0080" },
    { range: "9", text: "G5", color: "#b000ff" },
  ],
};

export const GEOMAGNETIC_CONDITION_ROW: ScaleRow = {
  id: "geomagnetic",
  label: "Geomagnetic",
  items: [
    { range: "Quiet", text: "Kp 0-2", color: "#00ff88" },
    { range: "Unsettled", text: "Kp 3", color: "#52e34f" },
    { range: "Active", text: "Kp 4", color: "#c8f018" },
    { range: "G1", text: "Kp 5", color: "#ffb000" },
    { range: "G2", text: "Kp 6", color: "#ff7a00" },
    { range: "G3", text: "Kp 7", color: "#ff2e2e" },
    { range: "G4", text: "Kp 8", color: "#ff0080" },
    { range: "G5", text: "Kp 9", color: "#b000ff" },
  ],
};

export const DST_SCALE_ROW: ScaleRow = {
  id: "dst",
  label: "Dst (nT)",
  items: [
    { range: "0", text: "Quiet", color: "#00ff88" },
    { range: "-20", text: "Weak", color: "#52e34f" },
    { range: "-30", text: "Mod.", color: "#c8f018" },
    { range: "-50", text: "Intense", color: "#ffb000" },
    { range: "-100", text: "Severe", color: "#ff7a00" },
    { range: "-200", text: "Extreme", color: "#ff2e2e" },
    { range: "-350", text: "Super", color: "#b000ff" },
  ],
};

export const AP_SCALE_ROW: ScaleRow = {
  id: "ap",
  label: "Ap Index",
  items: [
    { range: "0-7", text: "Quiet", color: "#00ff88" },
    { range: "8-15", text: "Unsettled", color: "#52e34f" },
    { range: "16-29", text: "Active", color: "#c8f018" },
    { range: "30-49", text: "Minor", color: "#ffb000" },
    { range: "50-99", text: "Moderate", color: "#ff7a00" },
    { range: "100-199", text: "Strong", color: "#ff2e2e" },
    { range: "200+", text: "Severe", color: "#b000ff" },
  ],
};

/** Sidebar + dashboard geomagnetic reference rows. */
export const SIDEBAR_GEOMagnetic_SCALE_ROWS: ScaleRow[] = [
  KP_SCALE_ROW,
  GEOMAGNETIC_CONDITION_ROW,
  DST_SCALE_ROW,
  AP_SCALE_ROW,
];

/** Full dashboard scale reference (includes S4, TEC, F10.7, solar wind). */
export const DASHBOARD_SCALE_ROWS: ScaleRow[] = [
  KP_SCALE_ROW,
  { ...GEOMAGNETIC_CONDITION_ROW, label: "Geomagnetic Condition Scale" },
  { ...DST_SCALE_ROW, label: "Dst Index Scale (nT)" },
  {
    id: "s4",
    label: "S4 Scintillation Index Scale",
    items: [
      { range: "0.0-0.1", text: "None", color: "#00ff88" },
      { range: "0.1-0.2", text: "Negligible", color: "#52e34f" },
      { range: "0.2-0.3", text: "Weak", color: "#c8f018" },
      { range: "0.3-0.5", text: "Moderate", color: "#ffcc00" },
      { range: "0.5-0.7", text: "Strong", color: "#ff7a00" },
      { range: "0.7-0.9", text: "Severe", color: "#ff2e2e" },
      { range: "0.9-1.0", text: "Outage", color: "#b000ff" },
    ],
  },
  {
    id: "tec",
    label: "TEC Scale (TECU)",
    items: [
      { range: "0-10", text: "Very Low", color: "#168bd2" },
      { range: "10-25", text: "Low", color: "#00ff88" },
      { range: "25-40", text: "Moderate", color: "#a8f000" },
      { range: "40-60", text: "High", color: "#ffcc00" },
      { range: "60-80", text: "Very High", color: "#ff7a00" },
      { range: "80-100", text: "Extreme", color: "#ff2e2e" },
      { range: "> 100", text: "Storm", color: "#b000ff" },
    ],
  },
  {
    id: "f107",
    label: "Solar Flux F10.7 (sfu)",
    items: [
      { range: "65-80", text: "Solar Min.", color: "#00c8c8" },
      { range: "80-100", text: "Low", color: "#2edb85" },
      { range: "100-130", text: "Below Avg.", color: "#a8f000" },
      { range: "130-170", text: "Moderate", color: "#ffcc00" },
      { range: "170-220", text: "High", color: "#ff7a00" },
      { range: "220-270", text: "Very High", color: "#ff2e2e" },
      { range: "> 270", text: "Extreme", color: "#b000ff" },
    ],
  },
  {
    id: "solar_wind",
    label: "Solar Wind (km/s)",
    items: [
      { range: "250-350", text: "Slow", color: "#00c8c8" },
      { range: "350-450", text: "Typical", color: "#2edb85" },
      { range: "450-550", text: "Fast", color: "#a8f000" },
      { range: "550-650", text: "Very Fast", color: "#ffcc00" },
      { range: "650-750", text: "Storm", color: "#ff7a00" },
      { range: "750-850", text: "Major CME", color: "#ff2e2e" },
      { range: "> 850", text: "Extreme", color: "#b000ff" },
    ],
  },
  { ...AP_SCALE_ROW, label: "Ap Index Scale" },
];

export function activeKpBandIndex(kp: number | null | undefined): number {
  if (kp == null || !Number.isFinite(kp)) return -1;
  const thresholds = [0, 3, 4, 5, 6, 7, 8, 9];
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (kp >= thresholds[i]) return i;
  }
  return 0;
}

export function activeDstBandIndex(dst: number | null | undefined): number {
  if (dst == null || !Number.isFinite(dst)) return -1;
  if (dst > -20) return 0;
  if (dst > -30) return 1;
  if (dst > -50) return 2;
  if (dst > -100) return 3;
  if (dst > -200) return 4;
  if (dst > -350) return 5;
  return 6;
}

export function activeApBandIndex(ap: number | null | undefined): number {
  if (ap == null || !Number.isFinite(ap)) return -1;
  if (ap < 8) return 0;
  if (ap < 16) return 1;
  if (ap < 30) return 2;
  if (ap < 50) return 3;
  if (ap < 100) return 4;
  if (ap < 200) return 5;
  return 6;
}

export function activeBandForRow(
  rowId: string,
  values: { kp?: number | null; dst?: number | null; ap?: number | null },
): number {
  if (rowId === "kp" || rowId === "geomagnetic") return activeKpBandIndex(values.kp);
  if (rowId === "dst") return activeDstBandIndex(values.dst);
  if (rowId === "ap") return activeApBandIndex(values.ap);
  return -1;
}
