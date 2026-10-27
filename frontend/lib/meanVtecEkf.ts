/**
 * 1-D Extended Kalman Filter for the network-mean VTEC chart.
 *
 * Same state, bounds, and noise settings as `mean_vtec` in
 * `zgiis/space_weather/ekf.py`. `predicted` is the forecast made before that
 * sample is seen. A single-bin jump is not assimilated: the filter coasts
 * until the new level holds for two further samples. Returns no prediction
 * until the filter has an observed start.
 */

export interface MeanVtecEkfMeta {
  error: number;
  confidence: number;
}

export interface MeanVtecEkfSeries {
  predicted: (number | null)[];
  meta: (MeanVtecEkfMeta | null)[];
}

const BOUNDS: readonly [number, number] = [0, 200];
const Q_POS = 0.5;
const Q_VEL = 0.1;
const R = 4;
const DAMPING = 0.85;
const SCALE = 40;
const HISTORY = 8;
const MIN_GATE_TECU = 12;

function clip(value: number): number {
  return Math.min(BOUNDS[1], Math.max(BOUNDS[0], value));
}

function jacobian(value: number): number {
  if (value < BOUNDS[0] || value > BOUNDS[1]) return 0;
  return 1;
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdev(values: number[], average: number): number {
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

export function runMeanVtecEkf(values: (number | null)[]): MeanVtecEkfSeries {
  const predicted: (number | null)[] = [];
  const meta: (MeanVtecEkfMeta | null)[] = [];
  let x0 = 0;
  let x1 = 0;
  let p00 = 0;
  let p01 = 0;
  let p10 = 0;
  let p11 = 0;
  let started = false;
  let rejectRun = 0;
  const recentErrors: number[] = [];

  const predict = (): number => {
    const next0 = x0 + x1;
    const next1 = DAMPING * x1;
    const a = p00 + p10;
    const b = p01 + p11;
    const c = DAMPING * p10;
    const d = DAMPING * p11;
    x0 = next0;
    x1 = next1;
    p00 = a + b + Q_POS;
    p01 = DAMPING * b;
    p10 = c + d;
    p11 = DAMPING * d + Q_VEL;
    return clip(x0);
  };

  for (const value of values) {
    if (!started) {
      predicted.push(null);
      meta.push(null);
      if (value == null || !Number.isFinite(value)) continue;
      started = true;
      x0 = value;
      x1 = 0;
      p00 = Math.max(R, 1);
      p01 = 0;
      p10 = 0;
      p11 = Q_VEL * 10;
      continue;
    }

    const forecast = predict();
    if (value == null || !Number.isFinite(value)) {
      predicted.push(round(forecast));
      meta.push(null);
      continue;
    }

    const error = Math.abs(value - forecast);
    const h0 = jacobian(x0);
    const innovationStd = Math.sqrt(Math.max(h0 * h0 * p00 + R, 1e-9));
    const confidence = Math.max(0, Math.min(100, 100 * Math.exp(-innovationStd / SCALE)));
    const gated = shouldCoast(error, recentErrors) && rejectRun < 2;

    predicted.push(round(forecast));
    meta.push({ error: round(error), confidence: Math.round(confidence * 10) / 10 });

    if (gated) {
      rejectRun += 1;
      continue;
    }

    rejectRun = 0;
    const pht0 = h0 * p00;
    const pht1 = h0 * p01;
    const s = Math.max(h0 * pht0 + R, 1e-9);
    const k0 = pht0 / s;
    const k1 = pht1 / s;
    const innovation = value - clip(x0);
    x0 += k0 * innovation;
    x1 += k1 * innovation;
    p10 = p10 - k1 * h0 * p00;
    p11 = p11 - k1 * h0 * p01;
    p00 = (1 - k0 * h0) * p00;
    p01 = (1 - k0 * h0) * p01;
    recentErrors.push(error);
    if (recentErrors.length > 30) recentErrors.shift();
  }

  return { predicted, meta };
}

function shouldCoast(error: number, recentErrors: number[]): boolean {
  if (recentErrors.length < HISTORY) return error > MIN_GATE_TECU;
  const average = mean(recentErrors);
  const threshold = average + 3 * stdev(recentErrors, average);
  return error > Math.max(threshold, MIN_GATE_TECU);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
