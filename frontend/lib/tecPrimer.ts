/** Shared TEC education copy for metric cards, VTEC panels, and method comparison. */

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

export const TEC_L1_DELAY_NOTE =
  "At GPS L1 (~1575 MHz), ionospheric code delay ≈ 0.162 m per TECU. At 30 TECU that is ~4.9 m of range delay if uncorrected.";

/** How to classify TEC quantities you see in the app and notebook. */
export const TEC_CLASSIFICATIONS: {
  id: string;
  term: string;
  meaning: string;
  howToSpot: string;
}[] = [
  {
    id: "stec",
    term: "STEC (slant)",
    meaning:
      "Electron content along the actual satellite–receiver ray. Larger at low elevation because the path through the ionosphere is longer.",
    howToSpot: "Labelled STEC; rises as elevation falls for the same ionosphere.",
  },
  {
    id: "vtec",
    term: "VTEC (vertical)",
    meaning:
      "Equivalent vertical column after thin-shell mapping (shell ~350 km). Used for maps, diurnal fans, and station time series.",
    howToSpot: "Labelled VTEC / TECU on time series, heatmaps, and diurnal charts.",
  },
  {
    id: "code",
    term: "Code TEC",
    meaning:
      "From dual-frequency code (P4). Absolute but noisy (dm–m). Still biased by Differential Code Biases (DCBs).",
    howToSpot: "Live GOPI path often starts from code TEC when monthly DCB files are not applied.",
  },
  {
    id: "phase",
    term: "Phase / levelled TEC",
    meaning:
      "Precise phase geometry-free combination, anchored to code over each continuous arc (phase levelling). Removes ambiguity but DCBs remain.",
    howToSpot: "Notebook calls this phase-levelled TEC — not yet fully calibrated.",
  },
  {
    id: "calibrated",
    term: "Calibrated TEC",
    meaning:
      "STEC/VTEC after hardware biases (DCB / arc bias) are estimated and removed. Absolute scale depends on the calibration method.",
    howToSpot: "Gg / PyTECGg output; comparison charts label methods explicitly.",
  },
];

/** Shared dual-frequency steps both methods start from (notebook §§2–2.4). */
export const TEC_SHARED_PIPELINE: string[] = [
  "Form geometry-free combinations L₄ / P₄ from dual-frequency phase and code (cancels range and troposphere).",
  "Detect cycle slips and define continuous satellite arcs.",
  "Phase-level each arc so phase TEC is absolute up to remaining DCB / arc bias.",
  "Map STEC → VTEC with a thin-shell mapping function at the ionospheric pierce point (IPP).",
];

export type TecMethodGuide = {
  id: "gopi" | "gg";
  short: string;
  label: string;
  color: string;
  origin: string;
  steps: string[];
  biasHandling: string;
  strengths: string;
  watchOut: string;
};

/** GOPI vs Gg calculation guides — notebook Gg + operational Seemala/GOPI path. */
export const TEC_METHOD_GUIDES: TecMethodGuide[] = [
  {
    id: "gopi",
    short: "GOPI",
    label: "GOPI / Seemala GPS_TEC",
    color: "#38bdf8",
    origin:
      "Operational dual-frequency TEC path used on live Zimbabwe CORS (Seemala / Gopi-style processing).",
    steps: [
      "Compute dual-frequency code (and where available phase) TEC from NTRIP/CORS streams.",
      "Apply Seemala-style bias handling / σ-minimisation when DCB products are available (Gopi Ch. 4).",
      "On the live stream, code TEC is often used without monthly DCB files — fast, but absolute level can drift.",
      "Map to VTEC and publish station series used by graphs 1–5.",
    ],
    biasHandling:
      "DCB / bias treatment follows the Seemala GPS_TEC approach when products exist; live mode may leave residual absolute offsets.",
    strengths: "Real-time friendly; matches the operational ZGIIS live CORS VTEC feed.",
    watchOut:
      "Without full DCB files, absolute TECU can sit several–tens of TECU away from a fully calibrated product even when the diurnal shape is right.",
  },
  {
    id: "gg",
    short: "Gg",
    label: "Gg / Ciraolo–Cesaroni (PyTECGg)",
    color: "#f59e0b",
    origin:
      "Notebook TEC_GNSS_Notebook_v5 — Ciraolo/Cesaroni Gg calibration; PyTECGg when full RINEX is available.",
    steps: [
      "Read RINEX observation + navigation (or re-calibrate the same live samples).",
      "Build L₄ / P₄, detect slips, phase-level arcs.",
      "Divide the day into 15-minute windows (~96/day).",
      "In each window, solve jointly for a VTEC polynomial in Local Time × MODIP latitude and per-arc biases (least squares).",
      "Output calibrated STEC/VTEC, IPP, elevation, and azimuth.",
    ],
    biasHandling:
      "Joint estimation of arc biases + receiver DCB with a smooth VTEC surface — the key difference from raw/live GOPI code TEC.",
    strengths:
      "Stronger absolute calibration; MODIP+LT model respects equatorial anomaly geometry over Africa.",
    watchOut:
      "Needs enough samples per window; full PyTECGg wants complete RINEX days. Live comparison applies the same math to streaming rows when RINEX is not present.",
  },
];

/** Explicit calculation differences users should remember when reading overlays. */
export const TEC_METHOD_DIFFERENCES: { topic: string; gopi: string; gg: string }[] = [
  {
    topic: "What is solved for",
    gopi: "TEC observables with Seemala-style DCB / σ handling (live: often code TEC).",
    gg: "VTEC polynomial coefficients + arc biases (+ receiver DCB) in each 15-min window.",
  },
  {
    topic: "Bias model",
    gopi: "External / monthly DCBs when available; otherwise residual hardware delay stays in the TECU scale.",
    gg: "Biases estimated inside the least-squares fit together with the ionosphere model.",
  },
  {
    topic: "Spatial / time model",
    gopi: "Per-ray / station products; no shared MODIP×LT polynomial on the live path.",
    gg: "VTEC(μ, LT) expansion using MODIP latitude so the equatorial anomaly is symmetric.",
  },
  {
    topic: "What a cyan–amber offset means",
    gopi: "Same ionosphere, different absolute calibration — not a second storm.",
    gg: "ΔVTEC = Gg − GOPI shows calibration difference; shape agreement with offset = bias treatment.",
  },
];

export const TEC_METHOD_BOTTOM_LINE =
  "Both methods measure the same ionosphere. They disagree mainly because they remove hardware biases differently. Use GOPI for live operational monitoring; use Gg (notebook / PyTECGg) when you need calibrated absolute TECU and a clear bias audit trail.";

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
