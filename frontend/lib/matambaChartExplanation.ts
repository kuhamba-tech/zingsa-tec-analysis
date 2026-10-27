import type { ChartAnalysisBlock } from "./multiSourceChartAnalysis";
import type { ReceiverBiasStation } from "./types";

const CITE = "Matamba and Danskin (2022), Space Weather, doi:10.1029/2021SW003013.";

export function rmseTimeExplanation(): ChartAnalysisBlock {
  return {
    lead: `Each white point is the RMSE of one near-real-time TEC map against the code TEC that built it. ${CITE}`,
    bullets: [
      "Every 5 minutes, the previous 15 minutes of GPS code TEC are placed at the 350 km ionospheric pierce point, binned on a 1° grid, filled by nearest neighbour, and smoothed with a median filter of size 7.",
      "Elevation below 20° and TEC outside 0–50 TECU are excluded, the same observation bounds used by Matamba and Danskin.",
      "RMSE is the root-mean-square of (measured TEC − filtered grid) at those pierce points. A low value means the map agrees with the measurements. A value near or above the purple +1.5σ line means the grid is a poor fit.",
      "The olive and purple lines are exp(mean of ln(RMSE) ± 1.5 standard deviations), the paper’s dividers between a typical map and an unusually good or poor fit.",
      "The red curve is the 7-day average. It continues across hours that did not have enough pierce points. Those hours are not plotted as RMSE measurements.",
      "The dashed line is this system’s Extended Kalman Filter forecast of RMSE. It restarts after a gap longer than six hours and is not part of the Matamba map.",
      "The time axis is UTC. Zimbabwe local time (CAT) is UT+2.",
    ],
  };
}

export function rmseHistogramExplanation(stats: {
  n: number;
  mean: number;
  sigma: number;
  low: number;
  high: number;
}): ChartAnalysisBlock {
  return {
    lead: `Matamba and Danskin summarise map RMSE with a log-normal fit, because RMSE is positive and skewed. ${CITE}`,
    bullets: [
      `This sample has ${stats.n} maps. μ = ${stats.mean.toFixed(2)} TECU is the mean of the fitted log-normal. s = ${stats.sigma.toFixed(2)} is the standard deviation of ln(RMSE).`,
      `The olive dashed line is ${stats.low.toFixed(2)} TECU, exp(μ_ln − 1.5 s). Maps below it agree unusually well with the measured code TEC.`,
      `The purple dashed line is ${stats.high.toFixed(2)} TECU, exp(μ_ln + 1.5 s). Maps above it are a poor fit and should not be treated as a clean ionospheric field.`,
      "The red curve is that log-normal density scaled to the histogram counts. It is a description of this sample, not a forecast.",
    ],
  };
}

export function rmseHourExplanation(
  kind: "low" | "high",
  threshold: number,
  total: number,
): ChartAnalysisBlock {
  const side = kind === "low" ? "below" : "above";
  const meaning = kind === "low"
    ? "These are the hours when the 1° median-filtered map usually agrees with the pierce-point code TEC."
    : "These are the hours when the map usually disagrees with the pierce-point code TEC. Matamba and Danskin use that class to mark a poor map fit, not a Kp storm by itself.";
  return {
    lead: `${total} maps have RMSE ${side} ${threshold.toFixed(2)} TECU. The bars are the fraction of those maps in each UT hour. ${CITE}`,
    bullets: [
      meaning,
      "The paper separates the sample at exp(μ_ln ± 1.5 s) and then asks at what Universal Time those maps occur.",
      "Hour 12 UT is 14:00 in Zimbabwe (CAT, UT+2). A tall bar means that clock hour often produces this class of map in the current sample.",
      "An empty hour means none of the selected maps fell there. It is not filled in.",
    ],
  };
}

export function biasSeriesExplanation(station: ReceiverBiasStation): ChartAnalysisBlock {
  const code = station.station.toUpperCase();
  const mean = station.mean_bias_tecu.toFixed(2);
  const std = station.std_bias_tecu == null ? "not yet defined (fewer than two days)" : `${station.std_bias_tecu.toFixed(2)} TECU`;
  const product = station.product_bias_tecu == null ? "not yet held" : `${station.product_bias_tecu.toFixed(2)} TECU`;
  return {
    lead: `${code}: daily receiver bias used by the near-real-time TEC map. ${CITE}`,
    bullets: [
      "Following Matamba and Danskin, and Gopi’s elevation-weighted search, the satellite differential code bias is removed first. The receiver bias kept for the day is the value that minimises the standard deviation of vertical TEC above 30° elevation.",
      `Blue is that daily value (${station.points.length} logged day${station.points.length === 1 ? "" : "s"}). Red dashed is the mean of those days, ${mean} TECU. Light dotted lines are one standard deviation from the mean (${std}).`,
      `Green dotted is the bias held for the map product, ${product}. It is the mean of the first completed days and stays fixed once seven completed days exist.`,
      "A day is stored only when several multi-satellite epochs identify the minimum. The current UTC day is replaced as new code TEC arrives. Surveyor General sites are not included.",
    ],
  };
}

export function biasHistogramExplanation(station: ReceiverBiasStation): ChartAnalysisBlock {
  const code = station.station.toUpperCase();
  const n = station.points.length;
  const sigma = station.std_bias_tecu;
  return {
    lead: `${code}: every logged daily bias for this station, not one UTC day. ${CITE}`,
    bullets: [
      `There ${n === 1 ? "is" : "are"} ${n} logged day${n === 1 ? "" : "s"}. The mean is ${station.mean_bias_tecu.toFixed(2)} TECU${sigma == null ? "." : ` and the sample standard deviation is ${sigma.toFixed(2)} TECU.`}`,
      sigma == null
        ? "A station with only one logged day has no Gaussian curve yet. Matamba’s summary of a stable receiver needs more than one day."
        : "The red curve is the Gaussian with that mean and standard deviation, scaled so its area matches the histogram counts. It describes the logged days. It is not a new measurement.",
      "The current UTC day stays in the histogram and is replaced when a later code-TEC sample changes that day’s bias.",
    ],
  };
}
