type Source = { times: string[]; values: (number | null)[] };
type WindSource = Source & {
  density?: (number | null)[];
  temperature?: (number | null)[];
};

/** Common UTC minute grid; missing measurements stay null, never interpolated. */
export function windBzComparison(wind: WindSource, imf: Source, start: number, end: number, allowZeroFirst = false) {
  const step = 60_000;
  const first = Math.ceil(start / step) * step;
  const count = Math.max(0, Math.floor((end - first) / step) + 1);
  const times = Array.from({ length: count }, (_, i) => first + i * step);
  const align = (
    sourceTimes: string[],
    sourceValues: (number | null)[],
    requirePositive = false,
    allowZero = false,
  ) => {
    const bins = new Map<number, number[]>();
    sourceTimes.forEach((time, i) => {
      const stamp = Date.parse(time), value = sourceValues[i];
      if (!Number.isFinite(stamp) || stamp < start || stamp > end || value == null || !Number.isFinite(value) || (requirePositive && (allowZero ? value < 0 : value <= 0))) return;
      const bucket = Math.floor(stamp / step) * step;
      const values = bins.get(bucket) ?? []; values.push(value); bins.set(bucket, values);
    });
    return times.map(time => { const values = bins.get(time); return values ? values.reduce((a, b) => a + b, 0) / values.length : null; });
  };
  return {
    times,
    speed: align(wind.times, wind.values, true, allowZeroFirst),
    density: align(wind.times, wind.density ?? [], true, true),
    temperature: align(wind.times, wind.temperature ?? [], true),
    bz: align(imf.times, imf.values),
  };
}

/** Proton-only dynamic pressure, nPa, from simultaneous cm^-3 and km/s samples. */
export function solarWindPressure(speed: (number | null)[], density: (number | null)[]) {
  return speed.map((value, index) => {
    const n = density[index];
    return value != null && Number.isFinite(value) && value > 0 && n != null && Number.isFinite(n) && n >= 0
      ? 1.6726e-6 * n * value ** 2 : null;
  });
}
