/** VTEC → RGBA for heat-map canvas rendering (absolute 0–200 TECU scale, ICAO-aligned). */

import { ICAO_TEC_MOD, ICAO_TEC_SEV, TEC_SCALE_MAX, TEC_SCALE_MIN } from "./icaoTecAdvisory";

const STOPS: [number, [number, number, number]][] = [
  [0, [0, 0, 128]],
  [25, [0, 128, 255]],
  [50, [0, 255, 128]],
  [80, [255, 200, 0]],
  [ICAO_TEC_MOD, [255, 128, 0]],
  [ICAO_TEC_SEV, [255, 64, 0]],
  [TEC_SCALE_MAX, [255, 0, 0]],
];

export function vtecToRgb(vtec: number): [number, number, number] {
  const value = Math.max(TEC_SCALE_MIN, Math.min(TEC_SCALE_MAX, vtec));
  for (let i = 0; i < STOPS.length - 1; i++) {
    const [loT, loRgb] = STOPS[i];
    const [hiT, hiRgb] = STOPS[i + 1];
    if (value <= hiT) {
      const ratio = hiT > loT ? (value - loT) / (hiT - loT) : 0;
      return [
        Math.round(loRgb[0] + (hiRgb[0] - loRgb[0]) * ratio),
        Math.round(loRgb[1] + (hiRgb[1] - loRgb[1]) * ratio),
        Math.round(loRgb[2] + (hiRgb[2] - loRgb[2]) * ratio),
      ];
    }
  }
  return [255, 0, 0];
}

export function vtecToRgba(vtec: number, alpha = 0.72): string {
  const [r, g, b] = vtecToRgb(vtec);
  return `rgba(${r},${g},${b},${alpha})`;
}

/** CSS linear-gradient stops for the fixed absolute TEC legend (0–200 TECU). */
export const TEC_HEATMAP_GRADIENT = [
  "#000080",
  "#0080ff",
  "#00ff80",
  "#ffcc00",
  "#ff8000",
  "#ff4000",
  "#ff0000",
];

export function icaoMarkerPercent(threshold: number): number {
  return ((threshold - TEC_SCALE_MIN) / (TEC_SCALE_MAX - TEC_SCALE_MIN)) * 100;
}
