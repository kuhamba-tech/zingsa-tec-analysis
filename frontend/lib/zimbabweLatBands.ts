/**
 * Northern / central / southern Zimbabwe latitude bands for TEC comparison charts.
 * Thresholds match corsGeneticOptimizer regionHint (≈ −18.2° / −20.2°).
 */

import type { LiveObservation, LiveStationVtecSeries, Station } from "@/lib/types";
import { hourOfDayUtc } from "@/lib/tecTeachingMath";

export type ZimbabweLatBandId = "northern" | "central" | "southern";

export const ZIMBABWE_LAT_BANDS: {
  id: ZimbabweLatBandId;
  label: string;
  color: string;
}[] = [
  { id: "northern", label: "Northern Zimbabwe", color: "#2563eb" },
  { id: "central", label: "Central Zimbabwe", color: "#16a34a" },
  { id: "southern", label: "Southern Zimbabwe", color: "#ea580c" },
];

/** Hours shown on the illustrative ZINGSA latitudinal TEC graph. */
export const LAT_BAND_DIURNAL_HOURS = [0, 3, 6, 9, 12, 15, 18, 21, 23] as const;

/** Static catalog latitudes (CORS_FILES / stations.py) — used when live catalog is empty. */
export const ZIMBABWE_STATION_LATS: Record<string, number> = {
  muto: -17.40452552,
  mata: -20.84527778,
  muta: -18.97829762,
  bula: -20.16531328,
  gwer: -19.51195226,
  hacy: -17.825166,
  masv: -20.08775776,
  hara: -17.78140871,
  zinh: -17.78483089,
  lupa: -18.94696921,
  cent: -16.73144103,
  karo: -16.81896637,
  kwek: -18.93450249,
  gokw: -18.21248449,
  gsu: -20.43602472,
  chir: -21.04512914,
  chim: -19.80266433,
  chiv: -19.01795928,
  kari: -16.51946232,
  tsho: -19.77047206,
  vicf: -17.92673716,
  gutu: -19.646095,
  beit: -22.21018295,
  bing: -17.6250928,
  nkay: -18.98635139,
};

export function normalizeStationCode(code: string): string {
  return (code || "").toLowerCase().replace(/_+$/, "");
}

export function zimbabweLatBand(lat: number): ZimbabweLatBandId {
  if (lat > -18.2) return "northern";
  if (lat > -20.2) return "central";
  return "southern";
}

export function stationLatLookup(
  catalog?: Station[] | null,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const [code, lat] of Object.entries(ZIMBABWE_STATION_LATS)) {
    map.set(code, lat);
  }
  if (catalog) {
    for (const s of catalog) {
      if (!Number.isFinite(s.lat)) continue;
      const code = normalizeStationCode(s.code);
      map.set(code, s.lat);
    }
  }
  return map;
}

export type LatBandDiurnalSeries = {
  hours: number[];
  northern: (number | null)[];
  central: (number | null)[];
  southern: (number | null)[];
  stationCounts: Record<ZimbabweLatBandId, number>;
  sampleCounts: Record<ZimbabweLatBandId, number>;
  hoursWithData: number;
};

function emptySeries(): LatBandDiurnalSeries {
  const hours = [...LAT_BAND_DIURNAL_HOURS];
  const nulls = hours.map(() => null);
  return {
    hours,
    northern: [...nulls],
    central: [...nulls],
    southern: [...nulls],
    stationCounts: { northern: 0, central: 0, southern: 0 },
    sampleCounts: { northern: 0, central: 0, southern: 0 },
    hoursWithData: 0,
  };
}

function snapToDiurnalHour(hourUt: number): number | null {
  let best: number | null = null;
  let bestDist = Infinity;
  for (const h of LAT_BAND_DIURNAL_HOURS) {
    const d = Math.abs(hourUt - h);
    if (d < bestDist) {
      bestDist = d;
      best = h;
    }
  }
  // Accept points within ±1.5 h of a labelled tick (covers 15–60 min bins).
  return best != null && bestDist <= 1.5 ? best : null;
}

function finalizeBuckets(
  buckets: Map<ZimbabweLatBandId, Map<number, number[]>>,
  stationsSeen: Map<ZimbabweLatBandId, Set<string>>,
): LatBandDiurnalSeries {
  const out = emptySeries();
  let hoursWithData = 0;
  for (const band of ZIMBABWE_LAT_BANDS) {
    out.stationCounts[band.id] = stationsSeen.get(band.id)?.size ?? 0;
    const byHour = buckets.get(band.id) ?? new Map();
    const arr = out[band.id];
    for (let i = 0; i < out.hours.length; i++) {
      const h = out.hours[i];
      const vals = byHour.get(h);
      if (!vals?.length) {
        arr[i] = null;
        continue;
      }
      const mean = vals.reduce((a: number, b: number) => a + b, 0) / vals.length;
      arr[i] = Math.round(mean * 100) / 100;
      out.sampleCounts[band.id] += vals.length;
      if (i === 0 || out.northern[i] != null || out.central[i] != null || out.southern[i] != null) {
        /* counted below */
      }
    }
  }
  for (let i = 0; i < out.hours.length; i++) {
    if (out.northern[i] != null || out.central[i] != null || out.southern[i] != null) {
      hoursWithData += 1;
    }
  }
  out.hoursWithData = hoursWithData;
  return out;
}

/** Hourly (tick) mean VTEC by lat band from live per-station series (GOPI / code_live). */
export function latBandDiurnalFromStationSeries(
  series: LiveStationVtecSeries[],
  latByStation?: Map<string, number>,
): LatBandDiurnalSeries {
  const lats = latByStation ?? stationLatLookup();
  const buckets = new Map<ZimbabweLatBandId, Map<number, number[]>>();
  const stationsSeen = new Map<ZimbabweLatBandId, Set<string>>();
  for (const band of ZIMBABWE_LAT_BANDS) {
    buckets.set(band.id, new Map());
    stationsSeen.set(band.id, new Set());
  }

  for (const s of series) {
    const code = normalizeStationCode(s.station);
    const lat = lats.get(code);
    if (lat == null || !Number.isFinite(lat)) continue;
    const band = zimbabweLatBand(lat);
    stationsSeen.get(band)!.add(code);
    const hourMap = buckets.get(band)!;
    for (const p of s.points ?? []) {
      if (p.vtec_tecu == null || !Number.isFinite(p.vtec_tecu)) continue;
      if (p.vtec_tecu <= 0 || p.vtec_tecu > 100) continue;
      const h = hourOfDayUtc(p.time);
      if (h == null) continue;
      const tick = snapToDiurnalHour(h);
      if (tick == null) continue;
      const arr = hourMap.get(tick) ?? [];
      arr.push(p.vtec_tecu);
      hourMap.set(tick, arr);
    }
  }
  return finalizeBuckets(buckets, stationsSeen);
}

/** Hourly mean VTEC by lat band from raw live observations (GOPI or Gg rows). */
export function latBandDiurnalFromObservations(
  rows: LiveObservation[],
  latByStation?: Map<string, number>,
): LatBandDiurnalSeries {
  const lats = latByStation ?? stationLatLookup();
  const buckets = new Map<ZimbabweLatBandId, Map<number, number[]>>();
  const stationsSeen = new Map<ZimbabweLatBandId, Set<string>>();
  for (const band of ZIMBABWE_LAT_BANDS) {
    buckets.set(band.id, new Map());
    stationsSeen.set(band.id, new Set());
  }

  for (const o of rows) {
    if (o.vtec_tecu == null || !Number.isFinite(o.vtec_tecu)) continue;
    if (o.vtec_tecu <= 0 || o.vtec_tecu > 100) continue;
    const code = normalizeStationCode(o.station);
    const lat = lats.get(code);
    if (lat == null || !Number.isFinite(lat)) continue;
    const band = zimbabweLatBand(lat);
    stationsSeen.get(band)!.add(code);
    const h = hourOfDayUtc(o.time);
    if (h == null) continue;
    const tick = snapToDiurnalHour(h);
    if (tick == null) continue;
    const hourMap = buckets.get(band)!;
    const arr = hourMap.get(tick) ?? [];
    arr.push(o.vtec_tecu);
    hourMap.set(tick, arr);
  }
  return finalizeBuckets(buckets, stationsSeen);
}

/**
 * Reconstruct a full-day Gg lat-band curve by applying measured station mean
 * ΔVTEC (Gg − GOPI) from the comparison window onto the denser GOPI station series.
 */
export function latBandDiurnalGgFromGopiPlusDelta(
  gopiSeries: LiveStationVtecSeries[],
  gopiRows: LiveObservation[],
  ggRows: LiveObservation[],
  latByStation?: Map<string, number>,
): LatBandDiurnalSeries & { mode: "direct" | "offset"; meanDeltaTecu: number | null } {
  const direct = latBandDiurnalFromObservations(ggRows, latByStation);
  if (direct.hoursWithData >= 5) {
    return { ...direct, mode: "direct", meanDeltaTecu: null };
  }

  const key = (o: LiveObservation) =>
    `${normalizeStationCode(o.station)}|${o.prn ?? ""}|${o.time}`;
  // Prefer per-station mean Δ from matched samples; fall back to global mean Δ.
  const gopiByKey = new Map<string, number>();
  for (const o of gopiRows) {
    if (o.vtec_tecu == null || !Number.isFinite(o.vtec_tecu)) continue;
    gopiByKey.set(key(o), o.vtec_tecu);
  }
  const deltaByStation = new Map<string, number[]>();
  const allDeltas: number[] = [];
  for (const o of ggRows) {
    if (o.vtec_tecu == null || !Number.isFinite(o.vtec_tecu)) continue;
    const g = gopiByKey.get(key(o));
    if (g == null) continue;
    const d = o.vtec_tecu - g;
    allDeltas.push(d);
    const code = normalizeStationCode(o.station);
    const arr = deltaByStation.get(code) ?? [];
    arr.push(d);
    deltaByStation.set(code, arr);
  }
  const stationDelta = new Map<string, number>();
  for (const [code, vals] of deltaByStation) {
    stationDelta.set(code, vals.reduce((a, b) => a + b, 0) / vals.length);
  }
  const globalDelta =
    allDeltas.length > 0
      ? allDeltas.reduce((a, b) => a + b, 0) / allDeltas.length
      : null;

  if (globalDelta == null && stationDelta.size === 0) {
    return { ...direct, mode: "direct", meanDeltaTecu: null };
  }

  const adjusted: LiveStationVtecSeries[] = gopiSeries.map((s) => {
    const code = normalizeStationCode(s.station);
    const d = stationDelta.get(code) ?? globalDelta ?? 0;
    return {
      ...s,
      points: (s.points ?? []).map((p) => ({
        ...p,
        vtec_tecu: Math.round((p.vtec_tecu + d) * 100) / 100,
      })),
      latest_vtec:
        s.latest_vtec != null
          ? Math.round((s.latest_vtec + d) * 100) / 100
          : null,
      mean_vtec:
        s.mean_vtec != null ? Math.round((s.mean_vtec + d) * 100) / 100 : null,
    };
  });

  const series = latBandDiurnalFromStationSeries(adjusted, latByStation);
  return {
    ...series,
    mode: "offset",
    meanDeltaTecu: globalDelta != null ? Math.round(globalDelta * 100) / 100 : null,
  };
}
