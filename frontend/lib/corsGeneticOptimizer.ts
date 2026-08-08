import type { Station } from "@/lib/types";
import { haversineKm } from "@/lib/corsNetworkDistances";
import {
  isInsideZimbabwe,
  isValidProposedCorsSite,
  ZIMBABWE_BOUNDS,
} from "@/lib/zimbabweBoundary";

export { ZIMBABWE_BOUNDS, isInsideZimbabwe, isValidProposedCorsSite };

/**
 * Leica Geosystems Technical Offer for ZIGSA (2021-09-21), §3 Design of the CORS Solution.
 * Network Distances / GA densification follows these operational ranges.
 */
/** Single-baseline RTK: stay within ~20 km of nearest CORS (reliable). */
export const SINGLE_RTK_RECOMMENDED_KM = 20;
/** Single-baseline RTK: up to ~30 km in good ionosphere; can fall to ~10 km in adverse conditions. */
export const SINGLE_RTK_MAX_GOOD_KM = 30;
/** NRTK: CORS spacing typically 50–80 km (rover then ≤ ~40–60 km from nearest CORS). */
export const NRTK_SPACING_MIN_KM = 50;
export const NRTK_SPACING_MAX_KM = 80;
/** NRTK serviceable distance to nearest CORS (upper of Leica’s 40–60 km band). */
export const NRTK_ROVER_MAX_KM = 60;
/** Minimum CORS in an NRTK atmospheric cluster (Leica). */
export const NRTK_CLUSTER_MIN_STATIONS = 4;

/**
 * Coverage target for GA: land within this distance of a CORS counts as NRTK-serviceable.
 * Leica: with 50–80 km CORS spacing, rover max distance to nearest CORS ≈ 40–60 km.
 */
export const USEFUL_COVERAGE_KM = NRTK_ROVER_MAX_KM;

/** Prefer new sites at least this far from an existing CORS (Leica NRTK spacing floor). */
export const MIN_SEPARATION_KM = NRTK_SPACING_MIN_KM;

export interface GeoPoint {
  lat: number;
  lon: number;
}

export interface ProposedCorsSite {
  id: string;
  lat: number;
  lon: number;
  label: string;
  regionHint: string;
  nearestExistingKm: number;
  nearestExistingCode: string;
  gapFillScore: number;
}

export interface NetworkCoverageStats {
  sampleCount: number;
  meanNearestKm: number;
  maxNearestKm: number;
  coverageWithinUsefulPct: number;
  worstGap: GeoPoint & { nearestKm: number };
}

export interface GeneticOptimizeResult {
  proposed: ProposedCorsSite[];
  before: NetworkCoverageStats;
  after: NetworkCoverageStats;
  improvementPct: number;
  generations: number;
  populationSize: number;
  newSiteCount: number;
  elapsedMs: number;
  notes: string[];
}

export interface GeneticOptimizeOptions {
  newSiteCount?: number;
  generations?: number;
  populationSize?: number;
  gridStepDeg?: number;
  usefulKm?: number;
  minSeparationKm?: number;
  seed?: number;
}

function usableStations(stations: Station[]): Station[] {
  return stations.filter(
    (s) => Number.isFinite(s.lat) && Number.isFinite(s.lon) && Math.abs(s.lat) <= 90 && Math.abs(s.lon) <= 180,
  );
}

function buildGrid(stepDeg: number): GeoPoint[] {
  const points: GeoPoint[] = [];
  for (let lat = ZIMBABWE_BOUNDS.minLat; lat <= ZIMBABWE_BOUNDS.maxLat; lat += stepDeg) {
    for (let lon = ZIMBABWE_BOUNDS.minLon; lon <= ZIMBABWE_BOUNDS.maxLon; lon += stepDeg) {
      const p = { lat: roundCoord(lat), lon: roundCoord(lon) };
      // Coverage sampling may use the full land polygon.
      if (isInsideZimbabwe(p.lat, p.lon)) points.push(p);
    }
  }
  return points;
}

/** Candidate sites for GA proposals — inland Zimbabwe only (never outside / on border). */
function buildProposalCandidates(stepDeg: number): GeoPoint[] {
  const points: GeoPoint[] = [];
  for (let lat = ZIMBABWE_BOUNDS.minLat; lat <= ZIMBABWE_BOUNDS.maxLat; lat += stepDeg) {
    for (let lon = ZIMBABWE_BOUNDS.minLon; lon <= ZIMBABWE_BOUNDS.maxLon; lon += stepDeg) {
      const p = { lat: roundCoord(lat), lon: roundCoord(lon) };
      if (isValidProposedCorsSite(p.lat, p.lon)) points.push(p);
    }
  }
  return points;
}

function roundCoord(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function nearestStationDistance(point: GeoPoint, stations: GeoPoint[]): number {
  let best = Infinity;
  for (const s of stations) {
    const d = haversineKm(point.lat, point.lon, s.lat, s.lon);
    if (d < best) best = d;
  }
  return best;
}

function nearestExisting(point: GeoPoint, stations: Station[]): { km: number; code: string } {
  let best = Infinity;
  let code = "";
  for (const s of stations) {
    const d = haversineKm(point.lat, point.lon, s.lat, s.lon);
    if (d < best) {
      best = d;
      code = s.code.toUpperCase();
    }
  }
  return { km: best, code };
}

export function computeCoverageStats(
  existing: Station[],
  proposed: GeoPoint[] = [],
  opts?: { gridStepDeg?: number; usefulKm?: number },
): NetworkCoverageStats {
  const step = opts?.gridStepDeg ?? 0.45;
  const usefulKm = opts?.usefulKm ?? USEFUL_COVERAGE_KM;
  const stations = [
    ...usableStations(existing).map((s) => ({ lat: s.lat, lon: s.lon })),
    ...proposed,
  ];
  const grid = buildGrid(step);
  if (stations.length === 0 || grid.length === 0) {
    return {
      sampleCount: 0,
      meanNearestKm: 0,
      maxNearestKm: 0,
      coverageWithinUsefulPct: 0,
      worstGap: { lat: -19, lon: 29.5, nearestKm: 0 },
    };
  }

  let sum = 0;
  let max = 0;
  let covered = 0;
  let worst = grid[0];
  let worstD = -1;

  for (const p of grid) {
    const d = nearestStationDistance(p, stations);
    sum += d;
    if (d > max) max = d;
    if (d <= usefulKm) covered += 1;
    if (d > worstD) {
      worstD = d;
      worst = p;
    }
  }

  return {
    sampleCount: grid.length,
    meanNearestKm: Math.round((sum / grid.length) * 10) / 10,
    maxNearestKm: Math.round(max * 10) / 10,
    coverageWithinUsefulPct: Math.round((100 * covered) / grid.length),
    worstGap: { ...worst, nearestKm: Math.round(worstD * 10) / 10 },
  };
}

function regionHint(lat: number, lon: number): string {
  const ns = lat > -18.2 ? "northern" : lat > -20.2 ? "central" : "southern";
  const ew = lon < 28.2 ? "west" : lon > 31.2 ? "east" : "midlands";
  if (ns === "northern" && ew === "east") return "NE Zimbabwe (Mutasa / Nyanga corridor)";
  if (ns === "northern" && ew === "west") return "NW Zimbabwe (Kariba / Binga corridor)";
  if (ns === "southern" && ew === "east") return "SE Zimbabwe (Chipinge / Chiredzi corridor)";
  if (ns === "southern" && ew === "west") return "SW Zimbabwe (Plumtree / Beitbridge west)";
  if (ns === "central" && ew === "east") return "Eastern highlands approach";
  if (ns === "central" && ew === "west") return "Western corridor (Gokwe / Hwange flank)";
  if (ns === "northern") return "Northern Zimbabwe";
  if (ns === "southern") return "Southern Zimbabwe";
  return "Central Zimbabwe midlands";
}

function mulberry32(seed: number) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function uniqueSample(rand: () => number, poolSize: number, k: number): number[] {
  const idxs = Array.from({ length: poolSize }, (_, i) => i);
  for (let i = idxs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [idxs[i], idxs[j]] = [idxs[j], idxs[i]];
  }
  return idxs.slice(0, k).sort((a, b) => a - b);
}

function repairChromosome(genes: number[], poolSize: number, k: number, rand: () => number): number[] {
  const set = new Set<number>();
  for (const g of genes) {
    if (g >= 0 && g < poolSize) set.add(g);
  }
  while (set.size < k) {
    set.add(Math.floor(rand() * poolSize));
  }
  return [...set].slice(0, k).sort((a, b) => a - b);
}

function crossover(a: number[], b: number[], k: number, poolSize: number, rand: () => number): number[] {
  const cut = 1 + Math.floor(rand() * Math.max(1, k - 1));
  return repairChromosome([...a.slice(0, cut), ...b.slice(cut)], poolSize, k, rand);
}

function mutate(genes: number[], poolSize: number, k: number, rand: () => number, rate = 0.25): number[] {
  const next = [...genes];
  for (let i = 0; i < next.length; i++) {
    if (rand() < rate) next[i] = Math.floor(rand() * poolSize);
  }
  return repairChromosome(next, poolSize, k, rand);
}

function fitness(
  genes: number[],
  candidatePool: GeoPoint[],
  existing: GeoPoint[],
  coverageGrid: GeoPoint[],
  usefulKm: number,
  minSeparationKm: number,
): number {
  const proposed = genes.map((i) => candidatePool[i]);
  // Leica NRTK spacing band: prefer 50–80 km between CORS (too close / too far both hurt).
  let penalty = 0;
  for (let i = 0; i < proposed.length; i++) {
    for (let j = i + 1; j < proposed.length; j++) {
      const d = haversineKm(proposed[i].lat, proposed[i].lon, proposed[j].lat, proposed[j].lon);
      if (d < minSeparationKm) penalty += (minSeparationKm - d) * 2;
      else if (d > NRTK_SPACING_MAX_KM) penalty += (d - NRTK_SPACING_MAX_KM) * 0.35;
    }
    let nearestExisting = Infinity;
    for (const e of existing) {
      const d = haversineKm(proposed[i].lat, proposed[i].lon, e.lat, e.lon);
      if (d < nearestExisting) nearestExisting = d;
      if (d < minSeparationKm) penalty += (minSeparationKm - d) * 1.5;
    }
    if (Number.isFinite(nearestExisting) && nearestExisting > NRTK_SPACING_MAX_KM) {
      penalty += (nearestExisting - NRTK_SPACING_MAX_KM) * 0.2;
    }
  }

  const all = [...existing, ...proposed];
  let sum = 0;
  let max = 0;
  let covered = 0;
  for (const p of coverageGrid) {
    const d = nearestStationDistance(p, all);
    sum += d;
    if (d > max) max = d;
    if (d <= usefulKm) covered += 1;
  }
  const mean = sum / coverageGrid.length;
  const coverFrac = covered / coverageGrid.length;
  // Higher is better
  return coverFrac * 120 - mean * 0.85 - max * 0.35 - penalty;
}

/**
 * Genetic algorithm that recommends new CORS sites to close coverage gaps
 * across Zimbabwe, given the current station set.
 */
export function optimizeCorsPlacement(
  stations: Station[],
  options: GeneticOptimizeOptions = {},
): GeneticOptimizeResult {
  const t0 = performance.now();
  const newSiteCount = Math.max(1, Math.min(8, options.newSiteCount ?? 4));
  const generations = Math.max(10, Math.min(120, options.generations ?? 45));
  const populationSize = Math.max(12, Math.min(80, options.populationSize ?? 36));
  const gridStepDeg = options.gridStepDeg ?? 0.45;
  const usefulKm = options.usefulKm ?? USEFUL_COVERAGE_KM;
  const minSeparationKm = options.minSeparationKm ?? MIN_SEPARATION_KM;
  const rand = mulberry32(options.seed ?? 42);

  const existingStations = usableStations(stations);
  const existingPts = existingStations.map((s) => ({ lat: s.lat, lon: s.lon }));
  const coverageGrid = buildGrid(gridStepDeg);
  // Proposal candidates are inland-Zimbabwe only — never outside the country.
  const inlandCandidates = buildProposalCandidates(gridStepDeg);
  const before = computeCoverageStats(existingStations, [], { gridStepDeg, usefulKm });

  let candidatePool = inlandCandidates.filter(
    (p) => nearestStationDistance(p, existingPts) >= minSeparationKm * 0.85,
  );
  if (candidatePool.length < newSiteCount * 3) {
    candidatePool = inlandCandidates;
  }

  const notes: string[] = [
    `Leica ZIGSA offer: single RTK ≤ ${SINGLE_RTK_RECOMMENDED_KM} km recommended (≤ ${SINGLE_RTK_MAX_GOOD_KM} km good conditions); NRTK CORS spacing ${NRTK_SPACING_MIN_KM}–${NRTK_SPACING_MAX_KM} km.`,
    `Coverage target: ≤ ${usefulKm} km to nearest CORS (NRTK serviceable band).`,
    `Hard rule: proposed CORS sites must be inside Zimbabwe (never outside). Searching ${candidatePool.length} inland candidate cells.`,
  ];

  if (inlandCandidates.length === 0 || candidatePool.length < newSiteCount) {
    notes.push("Insufficient inland Zimbabwe candidates — no sites proposed outside the border.");
    return {
      proposed: [],
      before,
      after: before,
      improvementPct: 0,
      generations,
      populationSize,
      newSiteCount,
      elapsedMs: Math.round(performance.now() - t0),
      notes,
    };
  }

  if (existingStations.length === 0) {
    notes.push("No existing stations loaded — recommendations assume an empty national network.");
  }

  type Individual = { genes: number[]; score: number };
  let population: Individual[] = Array.from({ length: populationSize }, () => {
    const genes = uniqueSample(rand, candidatePool.length, newSiteCount);
    return {
      genes,
      score: fitness(genes, candidatePool, existingPts, coverageGrid, usefulKm, minSeparationKm),
    };
  });

  for (let gen = 0; gen < generations; gen++) {
    population.sort((a, b) => b.score - a.score);
    const elites = population.slice(0, Math.max(2, Math.floor(populationSize * 0.15)));
    const next: Individual[] = [...elites];
    while (next.length < populationSize) {
      const p1 = population[Math.floor(rand() * Math.min(12, population.length))];
      const p2 = population[Math.floor(rand() * Math.min(12, population.length))];
      let child = crossover(p1.genes, p2.genes, newSiteCount, candidatePool.length, rand);
      child = mutate(child, candidatePool.length, newSiteCount, rand, 0.22);
      next.push({
        genes: child,
        score: fitness(child, candidatePool, existingPts, coverageGrid, usefulKm, minSeparationKm),
      });
    }
    population = next;
  }

  population.sort((a, b) => b.score - a.score);
  const best = population[0];
  // Final hard filter: drop anything not strictly valid inland Zimbabwe.
  const proposedPts = best.genes
    .map((i) => candidatePool[i])
    .filter((p) => p != null && isValidProposedCorsSite(p.lat, p.lon));
  const after = computeCoverageStats(existingStations, proposedPts, { gridStepDeg, usefulKm });

  const proposed: ProposedCorsSite[] = proposedPts.map((p, idx) => {
    const near = nearestExisting(p, existingStations);
    const gapFill = Math.max(0, near.km - usefulKm);
    return {
      id: `ga-site-${idx + 1}`,
      lat: p.lat,
      lon: p.lon,
      label: `NEW-${idx + 1}`,
      regionHint: regionHint(p.lat, p.lon),
      nearestExistingKm: Math.round(near.km * 10) / 10,
      nearestExistingCode: near.code || "—",
      gapFillScore: Math.round(gapFill * 10) / 10,
    };
  });

  // Rank proposed by how much gap they fill (farther from existing = higher priority)
  proposed.sort((a, b) => b.nearestExistingKm - a.nearestExistingKm);
  proposed.forEach((site, i) => {
    site.id = `ga-site-${i + 1}`;
    site.label = `NEW-${i + 1}`;
  });

  const improvementPct =
    before.coverageWithinUsefulPct === 0
      ? after.coverageWithinUsefulPct
      : Math.round(
          ((after.coverageWithinUsefulPct - before.coverageWithinUsefulPct) /
            Math.max(1, before.coverageWithinUsefulPct)) *
            1000,
        ) / 10;

  notes.push(
    `Worst current gap ≈ ${before.worstGap.nearestKm} km from nearest CORS at ${before.worstGap.lat.toFixed(2)}°, ${before.worstGap.lon.toFixed(2)}°.`,
  );
  notes.push(
    `After ${newSiteCount} proposed site(s): useful coverage ${before.coverageWithinUsefulPct}% → ${after.coverageWithinUsefulPct}%.`,
  );

  return {
    proposed,
    before,
    after,
    improvementPct,
    generations,
    populationSize,
    newSiteCount,
    elapsedMs: Math.round(performance.now() - t0),
    notes,
  };
}
