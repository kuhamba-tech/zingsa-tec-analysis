/**
 * Client-side North–South TEC research calculations.
 * Mirrors zgiis.processing.north_south_tec_research for interactive selection.
 */

import {
  normalizeStationCode,
  zimbabweLatBand,
  type ZimbabweLatBandId,
  ZIMBABWE_LAT_BANDS,
} from "@/lib/zimbabweLatBands";

export const CAT_OFFSET_HOURS = 2;
export const MIN_LAT_SEP_DEG = 0.15;
export const DEFAULT_SYNC_TOLERANCE_S = 900;

export type ResearchPoint = {
  timestamp_utc: string;
  vtec_tecu: number;
  quality_flag?: string;
  obs_count?: number;
};

export type ResearchStationMeta = {
  station_id: string;
  name: string;
  latitude: number;
  longitude: number;
  altitude_m?: number | null;
  operational_status?: string;
  lat_band: ZimbabweLatBandId | string;
  live_vtec_available?: boolean;
  latest_vtec_tecu?: number | null;
  latest_observation_utc?: string | null;
  observation_count?: number;
  geomagnetic_latitude?: number | null;
  geomagnetic_longitude?: number | null;
  geomagnetic_status?: string;
};

export function utcToCatHour(iso: string): number | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms + CAT_OFFSET_HOURS * 3600_000);
  return d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600;
}

export function utcToCatLabel(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const d = new Date(ms + CAT_OFFSET_HOURS * 3600_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} CAT`;
}

export function pairwiseDeltaVtec(vtecNorth: number, vtecSouth: number): number {
  return vtecNorth - vtecSouth;
}

export function pairwiseLatitudinalGradient(
  vtecNorth: number,
  vtecSouth: number,
  latNorth: number,
  latSouth: number,
  minSepDeg = MIN_LAT_SEP_DEG,
): number | null {
  const dlat = latNorth - latSouth;
  if (Math.abs(dlat) < minSepDeg) return null;
  return (vtecNorth - vtecSouth) / dlat;
}

export function linearRegression(
  xs: number[],
  ys: number[],
): {
  n: number;
  slope: number | null;
  intercept: number | null;
  rSquared: number | null;
  stderrSlope: number | null;
} {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) {
    return { n, slope: null, intercept: null, rSquared: null, stderrSlope: null };
  }
  const x = xs.slice(0, n);
  const y = ys.slice(0, n);
  const meanX = x.reduce((a, b) => a + b, 0) / n;
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  let ssxx = 0;
  let ssyy = 0;
  let ssxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    ssxx += dx * dx;
    ssyy += dy * dy;
    ssxy += dx * dy;
  }
  if (ssxx <= 0) {
    return { n, slope: null, intercept: null, rSquared: null, stderrSlope: null };
  }
  const slope = ssxy / ssxx;
  const intercept = meanY - slope * meanX;
  let ssRes = 0;
  for (let i = 0; i < n; i++) {
    const resid = y[i] - (intercept + slope * x[i]);
    ssRes += resid * resid;
  }
  const rSquared = ssyy > 0 ? 1 - ssRes / ssyy : null;
  const stderrSlope =
    n > 2 && ssxx > 0 ? Math.sqrt(ssRes / (n - 2) / ssxx) : null;
  return {
    n,
    slope: Math.round(slope * 1e6) / 1e6,
    intercept: Math.round(intercept * 1e6) / 1e6,
    rSquared: rSquared != null ? Math.round(rSquared * 1e6) / 1e6 : null,
    stderrSlope: stderrSlope != null ? Math.round(stderrSlope * 1e6) / 1e6 : null,
  };
}

export function synchronizePairs(
  north: ResearchPoint[],
  south: ResearchPoint[],
  toleranceS = DEFAULT_SYNC_TOLERANCE_S,
): Array<{
  timestamp_utc_north: string;
  timestamp_utc_south: string;
  sync_offset_s: number;
  vtec_north: number;
  vtec_south: number;
  delta_vtec: number;
  gradient: number | null;
}> {
  const southSorted = [...south]
    .filter((p) => Number.isFinite(p.vtec_tecu) && p.timestamp_utc)
    .sort((a, b) => Date.parse(a.timestamp_utc) - Date.parse(b.timestamp_utc));
  if (!southSorted.length) return [];
  const southMs = southSorted.map((p) => ({
    t: Date.parse(p.timestamp_utc),
    p,
  }));
  let j = 0;
  const out: ReturnType<typeof synchronizePairs> = [];
  for (const np of north) {
    const tn = Date.parse(np.timestamp_utc);
    if (!Number.isFinite(tn) || !Number.isFinite(np.vtec_tecu)) continue;
    while (
      j + 1 < southMs.length &&
      Math.abs(southMs[j + 1].t - tn) <= Math.abs(southMs[j].t - tn)
    ) {
      j += 1;
    }
    const { t, p } = southMs[j];
    if (Math.abs(t - tn) > toleranceS) continue;
    out.push({
      timestamp_utc_north: np.timestamp_utc,
      timestamp_utc_south: p.timestamp_utc,
      sync_offset_s: Math.round((tn - t) * 10) / 10,
      vtec_north: np.vtec_tecu,
      vtec_south: p.vtec_tecu,
      delta_vtec: Math.round((np.vtec_tecu - p.vtec_tecu) * 10000) / 10000,
      gradient: null,
    });
  }
  return out;
}

export function aggregateByCatHour(
  points: ResearchPoint[],
  binMinutes: number,
): Array<{ catHour: number; mean: number; n: number; min: number; max: number }> {
  const binH = Math.max(1, binMinutes) / 60;
  const buckets = new Map<number, number[]>();
  for (const p of points) {
    if (!Number.isFinite(p.vtec_tecu) || p.vtec_tecu <= 0) continue;
    const h = utcToCatHour(p.timestamp_utc);
    if (h == null) continue;
    const key = Math.floor(h / binH) * binH;
    const arr = buckets.get(key) ?? [];
    arr.push(p.vtec_tecu);
    buckets.set(key, arr);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([catHour, vals]) => ({
      catHour,
      mean: vals.reduce((a, b) => a + b, 0) / vals.length,
      n: vals.length,
      min: Math.min(...vals),
      max: Math.max(...vals),
    }));
}

export function regionalMeansAtTime(
  stations: ResearchStationMeta[],
  series: Record<string, ResearchPoint[]>,
  targetCatHour: number,
  windowHours = 0.5,
): Record<ZimbabweLatBandId, { mean: number | null; n: number; stations: string[] }> {
  const out: Record<ZimbabweLatBandId, { mean: number | null; n: number; stations: string[] }> = {
    northern: { mean: null, n: 0, stations: [] },
    central: { mean: null, n: 0, stations: [] },
    southern: { mean: null, n: 0, stations: [] },
  };
  for (const band of ZIMBABWE_LAT_BANDS) {
    const vals: number[] = [];
    const codes: string[] = [];
    for (const st of stations) {
      const bandId =
        (st.lat_band as ZimbabweLatBandId) || zimbabweLatBand(st.latitude);
      if (bandId !== band.id) continue;
      const pts = series[normalizeStationCode(st.station_id)] ?? [];
      const near = pts.filter((p) => {
        const h = utcToCatHour(p.timestamp_utc);
        if (h == null) return false;
        let d = Math.abs(h - targetCatHour);
        if (d > 12) d = 24 - d;
        return d <= windowHours;
      });
      if (!near.length) continue;
      const mean = near.reduce((a, b) => a + b.vtec_tecu, 0) / near.length;
      vals.push(mean);
      codes.push(st.station_id);
    }
    out[band.id] = {
      mean: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      n: vals.length,
      stations: codes,
    };
  }
  return out;
}

export function stationStats(points: ResearchPoint[]) {
  const vals = points
    .map((p) => p.vtec_tecu)
    .filter((v) => Number.isFinite(v) && v > 0);
  if (!vals.length) {
    return {
      mean: null as number | null,
      median: null as number | null,
      min: null as number | null,
      max: null as number | null,
      std: null as number | null,
      amplitude: null as number | null,
      timeOfMax: null as string | null,
      n: 0,
    };
  }
  const sorted = [...vals].sort((a, b) => a - b);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const variance =
    vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  const max = Math.max(...vals);
  const maxPt = points.find((p) => p.vtec_tecu === max);
  return {
    mean: Math.round(mean * 1000) / 1000,
    median: Math.round(median * 1000) / 1000,
    min: Math.round(Math.min(...vals) * 1000) / 1000,
    max: Math.round(max * 1000) / 1000,
    std: Math.round(Math.sqrt(variance) * 1000) / 1000,
    amplitude: Math.round((max - Math.min(...vals)) * 1000) / 1000,
    timeOfMax: maxPt?.timestamp_utc ?? null,
    n: vals.length,
  };
}

export function downloadText(filename: string, content: string, mime = "text/csv") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function observationsToCsv(
  stations: ResearchStationMeta[],
  series: Record<string, ResearchPoint[]>,
  selected: string[],
): string {
  const header = [
    "station_id",
    "name",
    "timestamp_utc",
    "timestamp_cat",
    "latitude",
    "longitude",
    "vtec_tecu",
    "quality_flag",
    "lat_band",
    "data_source",
  ].join(",");
  const rows: string[] = [header];
  for (const id of selected) {
    const code = normalizeStationCode(id);
    const st = stations.find((s) => normalizeStationCode(s.station_id) === code);
    if (!st) continue;
    for (const p of series[code] ?? []) {
      rows.push(
        [
          code,
          JSON.stringify(st.name),
          p.timestamp_utc,
          utcToCatLabel(p.timestamp_utc),
          st.latitude,
          st.longitude,
          p.vtec_tecu,
          p.quality_flag ?? "ok",
          st.lat_band,
          "vtec_obs code_live",
        ].join(","),
      );
    }
  }
  return rows.join("\n");
}

export function comparisonToCsv(
  pairs: Array<{
    timestamp_utc_north: string;
    timestamp_utc_south: string;
    vtec_north: number;
    vtec_south: number;
    delta_vtec: number;
    sync_offset_s: number;
  }>,
  northId: string,
  southId: string,
  latNorth: number,
  latSouth: number,
): string {
  const header = [
    "north_station",
    "south_station",
    "timestamp_utc_north",
    "timestamp_utc_south",
    "sync_offset_s",
    "vtec_north",
    "vtec_south",
    "delta_vtec",
    "gradient_tecu_per_deg",
    "lat_north",
    "lat_south",
  ].join(",");
  const rows = [header];
  for (const p of pairs) {
    const g = pairwiseLatitudinalGradient(
      p.vtec_north,
      p.vtec_south,
      latNorth,
      latSouth,
    );
    rows.push(
      [
        northId,
        southId,
        p.timestamp_utc_north,
        p.timestamp_utc_south,
        p.sync_offset_s,
        p.vtec_north,
        p.vtec_south,
        p.delta_vtec,
        g ?? "",
        latNorth,
        latSouth,
      ].join(","),
    );
  }
  return rows.join("\n");
}

export { zimbabweLatBand, normalizeStationCode, ZIMBABWE_LAT_BANDS };
