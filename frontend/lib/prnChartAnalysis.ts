import type { ChartAnalysisBlock } from "./multiSourceChartAnalysis";
import type { PrnObservation } from "./types";

function finite(values: Array<number | null | undefined>): number[] {
  return values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function fmt(value: number, digits = 1): string {
  return value.toFixed(digits);
}

export function analyzePrnVtec(
  observations: PrnObservation[],
  plottedPrns: string[],
  sourceLabel: string,
): ChartAnalysisBlock {
  const rows = observations
    .filter((row) => plottedPrns.includes(row.prn) && row.vtec != null && Number.isFinite(row.vtec))
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const values = finite(rows.map((row) => row.vtec));

  if (!values.length) {
    return {
      lead: "No valid VTEC samples are available for scientific interpretation in the selected window.",
      bullets: [
        "Load live NTRIP observations or processed dual-frequency GNSS data, then confirm timestamps, satellite elevation, cycle-slip screening, and inter-frequency bias calibration before interpreting ionospheric behaviour.",
      ],
    };
  }

  const perPrn = plottedPrns
    .map((prn) => {
      const prnRows = rows.filter((row) => row.prn === prn);
      const prnValues = finite(prnRows.map((row) => row.vtec));
      return prnValues.length
        ? { prn, rows: prnRows, mean: mean(prnValues), min: Math.min(...prnValues), max: Math.max(...prnValues) }
        : null;
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  let sharpJumps = 0;
  for (const series of perPrn) {
    for (let index = 1; index < series.rows.length; index += 1) {
      const previous = series.rows[index - 1].vtec;
      const current = series.rows[index].vtec;
      if (previous != null && current != null && Math.abs(current - previous) >= 30) sharpJumps += 1;
    }
  }

  const overallMean = mean(values);
  const overallMedian = median(values);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const highSamples = values.filter((value) => value > 100).length;
  const lowElevationRows = rows.filter(
    (row) => typeof row.elevation_deg === "number" && row.elevation_deg < 30,
  ).length;
  const prnMeans = perPrn.map((row) => row.mean);
  const interPrnSpread = prnMeans.length > 1 ? Math.max(...prnMeans) - Math.min(...prnMeans) : 0;
  const peakPrn = [...perPrn].sort((a, b) => b.max - a.max)[0];
  const stations = [...new Set(rows.map((row) => row.station).filter(Boolean))];

  const bullets = [
    `Coverage: ${values.length.toLocaleString()} valid samples from ${perPrn.length} ${perPrn.length === 1 ? "PRN" : "PRNs"}${stations.length ? ` at ${stations.join(", ")}` : ""}; source: ${sourceLabel}.`,
    `Distribution: mean ${fmt(overallMean)} TECU, median ${fmt(overallMedian)} TECU, and observed range ${fmt(minimum)}–${fmt(maximum)} TECU. ${peakPrn ? `${peakPrn.prn} contains the largest plotted value (${fmt(peakPrn.max)} TECU).` : ""}`,
    `Satellite consistency: the spread between PRN mean values is ${fmt(interPrnSpread)} TECU. Large inter-PRN separation can reflect different ionospheric pierce points, but it can also expose elevation mapping, receiver/satellite differential code bias, multipath, or unresolved phase-leveling errors.`,
  ];

  if (sharpJumps || highSamples) {
    bullets.push(
      `Quality-control warning: ${sharpJumps} step change${sharpJumps === 1 ? "" : "s"} of at least 30 TECU and ${highSamples} sample${highSamples === 1 ? "" : "s"} above 100 TECU were found. VTEC normally evolves smoothly; repeated saw-tooth peaks or abrupt resets should be checked against cycle slips, loss of lock, low-elevation multipath, mapping-function instability, and DCB handling before being classified as a space-weather disturbance.`,
    );
  } else {
    bullets.push(
      "No ≥30 TECU sample-to-sample discontinuity appears in the plotted series. This supports temporal continuity, but geomagnetic interpretation still requires comparison with ROTI/S4, Kp, Dst, local time, and neighbouring stations.",
    );
  }

  bullets.push(
    lowElevationRows > 0
      ? `${lowElevationRows} plotted observations are below 30° elevation. These rays traverse a longer slant path and are more vulnerable to multipath; give higher-elevation, multi-PRN agreement greater weight.`
      : "All plotted observations with elevation metadata are at or above 30°, reducing—though not eliminating—low-elevation mapping and multipath sensitivity.",
    "Operational meaning: VTEC describes ionospheric electron content, not positioning error by itself. Assess RTK/PPP risk from gradients, ROTI/S4, cycle slips, geometry, correction age, and multi-station coherence rather than converting one TEC peak directly into centimetres of error.",
  );

  return {
    lead: sharpJumps || highSamples
      ? "The plot contains strong PRN-dependent structure that requires quality control before it can be interpreted as physical ionospheric variability."
      : "The plotted PRNs provide a coherent view of ionospheric electron content across the selected observation window.",
    bullets,
  };
}
