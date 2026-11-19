export type AnalysisPoint = { time: number; value: number | null };
export const OBSERVATION_READOUT_TOLERANCE_MS = 30 * 60_000;
export type StationVtecHistory = {
  station: string;
  points: { time: string; vtec_tecu: number }[];
};

/** Keep observed bins through partial refreshes, replacing bins returned again. */
export function mergeStationVtecHistory<T extends StationVtecHistory>(previous: T[], incoming: T[], binMinutes: number): T[] {
  const stations = new Map(previous.map(row => [row.station, row]));
  const step = binMinutes * 60_000;
  for (const row of incoming) {
    if (!row.points.length) continue;
    const oldPoints = stations.get(row.station)?.points ?? [];
    const points = new Map(oldPoints.map(point => [Math.floor(Date.parse(point.time) / step), point]));
    for (const point of row.points) points.set(Math.floor(Date.parse(point.time) / step), point);
    stations.set(row.station, { ...row, points: [...points.entries()].sort(([a], [b]) => a - b).map(([, point]) => point) });
  }
  return [...stations.values()];
}

/** Build equal-weight 15-minute means from observed station-bin values only. */
export function buildNetworkMeanVtecSeries(
  series: StationVtecHistory[],
  startMs: number,
  endMs: number,
  binMinutes = 15,
): AnalysisPoint[] {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
  const stepMs = Math.max(1, Math.trunc(binMinutes)) * 60_000;
  const bins = new Map<number, Map<string, number[]>>();

  for (const row of series) {
    const station = row.station.toLowerCase().replace(/_+$/, "");
    if (!station) continue;
    for (const point of row.points) {
      const time = Date.parse(point.time);
      const value = point.vtec_tecu;
      if (!Number.isFinite(time) || time < startMs || time >= endMs
        || !Number.isFinite(value) || value <= 0 || value > 50) continue;
      const bin = Math.floor(time / stepMs) * stepMs;
      const stations = bins.get(bin) ?? new Map<string, number[]>();
      const values = stations.get(station) ?? [];
      values.push(value);
      stations.set(station, values);
      bins.set(bin, stations);
    }
  }

  return [...bins.entries()]
    .sort(([a], [b]) => a - b)
    .map(([time, stations]) => {
      const stationMeans = [...stations.values()].map(values =>
        values.reduce((sum, value) => sum + value, 0) / values.length,
      );
      return {
        time,
        value: stationMeans.reduce((sum, value) => sum + value, 0) / stationMeans.length,
      };
    });
}

/** Compare the same receiver and UTC quarter-hour; never fabricate a quiet curve. */
export function referenceTec(points: AnalysisPoint[], reference: AnalysisPoint[], requiredDays = 1) {
  const bins = new Map<number, Map<number, number[]>>();
  const utcBin = (time: number) => Math.floor(((time % 86400000) + 86400000) % 86400000 / 900000);
  for (const point of reference) {
    if (!Number.isFinite(point.time) || point.value == null || !Number.isFinite(point.value) || point.value <= 0 || point.value > 50) continue;
    const bin = utcBin(point.time);
    const day = Math.floor(point.time / 86400000);
    const days = bins.get(bin) ?? new Map<number, number[]>();
    const values = days.get(day) ?? [];
    values.push(point.value);
    days.set(day, values);
    bins.set(bin, days);
  }
  return points.map(point => {
    const days = bins.get(utcBin(point.time));
    const baseline = days && days.size >= requiredDays
      ? [...days.values()].reduce((sum, values) => sum + values.reduce((a, b) => a + b, 0) / values.length, 0) / days.size
      : null;
    const observed = point.value != null && Number.isFinite(point.value) && point.value > 0 && point.value <= 50 ? point.value : null;
    return { ...point, value: observed, baseline,
      delta: observed != null && baseline != null && baseline > 0 ? 100 * (observed - baseline) / baseline : null };
  });
}

export function nearestReading(points: AnalysisPoint[], time: number, tolerance: number) {
  let best: AnalysisPoint | null = null;
  for (const point of points) {
    if (point.value == null || !Number.isFinite(point.value) || !Number.isFinite(point.time) || Math.abs(point.time - time) > tolerance) continue;
    if (!best || Math.abs(point.time - time) < Math.abs(best.time - time)) best = point;
  }
  return best;
}
