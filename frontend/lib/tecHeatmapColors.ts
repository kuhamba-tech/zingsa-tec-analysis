/** VTEC → RGBA for heat-map canvas rendering (matches backend colour ramp). */

export function vtecToRgb(vtec: number): [number, number, number] {
  if (vtec <= 0) return [0, 0, 128];
  const stops: [number, [number, number, number]][] = [
    [10, [0, 0, 128]],
    [18, [0, 128, 255]],
    [25, [0, 255, 128]],
    [32, [255, 128, 0]],
    [40, [255, 0, 0]],
  ];
  const value = Math.max(10, Math.min(40, vtec));
  for (let i = 0; i < stops.length - 1; i++) {
    const [loT, loRgb] = stops[i];
    const [hiT, hiRgb] = stops[i + 1];
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

export const TEC_HEATMAP_GRADIENT = ["#000080", "#0080ff", "#00ff80", "#ff8000", "#ff0000"];
