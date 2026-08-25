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

/** User may request this many new CORS sites in one GA run. */
export const MIN_NEW_SITES = 1;
export const MAX_NEW_SITES = 12;

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

export function clampNewSiteCount(n: number): number {
  if (!Number.isFinite(n)) return 4;
  return Math.max(MIN_NEW_SITES, Math.min(MAX_NEW_SITES, Math.round(n)));
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

/** Uniform crossover — better mixing than a single cut when k is larger. */
function crossover(a: number[], b: number[], k: number, poolSize: number, rand: () => number): number[] {
  const mixed: number[] = [];
  const seen = new Set<number>();
  const pool = [...a, ...b];
  for (const g of pool) {
    if (seen.has(g)) continue;
    if (rand() < 0.5 || mixed.length < k) {
      seen.add(g);
      mixed.push(g);
    }
    if (mixed.length >= k) break;
  }
  return repairChromosome(mixed, poolSize, k, rand);
}

function mutate(
  genes: number[],
  poolSize: number,
  k: number,
  rand: () => number,
  rate: number,
): number[] {
  const next = [...genes];
  for (let i = 0; i < next.length; i++) {
    if (rand() < rate) next[i] = Math.floor(rand() * poolSize);
  }
  return repairChromosome(next, poolSize, k, rand);
}

function tournamentPick(
  population: { genes: number[]; score: number }[],
  rand: () => number,
  size = 4,
): { genes: number[]; score: number } {
  let best = population[Math.floor(rand() * population.length)];
  for (let i = 1; i < size; i++) {
    const challenger = population[Math.floor(rand() * population.length)];
    if (challenger.score > best.score) best = challenger;
  }
  return best;
}

/**
 * Bias initial picks toward coverage gaps: farther from existing CORS
 * (and from already-picked proposed sites) get higher sample weight.
 */
function gapBiasedSample(
  rand: () => number,
  candidatePool: GeoPoint[],
  existing: GeoPoint[],
  k: number,
  usefulKm: number,
  gapWeights: Float64Array,
): number[] {
  const picked: number[] = [];
  const blocked = new Set<number>();
  const working = existing.map((p) => ({ ...p }));

  for (let n = 0; n < k; n++) {
    let total = 0;
    const weights: number[] = new Array(candidatePool.length);
    for (let i = 0; i < candidatePool.length; i++) {
      if (blocked.has(i)) {
        weights[i] = 0;
        continue;
      }
      const gap = gapWeights[i];
      const nearestProposed =
        working.length === existing.length
          ? gap
          : nearestStationDistance(candidatePool[i], working);
      // Prefer cells that are currently poorly covered and still far from picks this round.
      const w = Math.max(0.05, gap - usefulKm * 0.35) * Math.max(0.2, nearestProposed / usefulKm);
      weights[i] = w * w;
      total += weights[i];
    }
    if (total <= 0) {
      const rest = uniqueSample(rand, candidatePool.length, k - n).filter((i) => !blocked.has(i));
      for (const i of rest) {
        if (picked.length >= k) break;
        picked.push(i);
        blocked.add(i);
      }
      break;
    }
    let r = rand() * total;
    let chosen = 0;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        chosen = i;
        break;
      }
    }
    picked.push(chosen);
    blocked.add(chosen);
    working.push(candidatePool[chosen]);
  }
  return repairChromosome(picked, candidatePool.length, k, rand);
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
      if (d < minSeparationKm) penalty += (minSeparationKm - d) * 2.4;
      else if (d > NRTK_SPACING_MAX_KM) penalty += (d - NRTK_SPACING_MAX_KM) * 0.4;
    }
    let nearestExisting = Infinity;
    for (const e of existing) {
      const d = haversineKm(proposed[i].lat, proposed[i].lon, e.lat, e.lon);
      if (d < nearestExisting) nearestExisting = d;
      if (d < minSeparationKm) penalty += (minSeparationKm - d) * 1.8;
    }
    if (Number.isFinite(nearestExisting) && nearestExisting > NRTK_SPACING_MAX_KM) {
      penalty += (nearestExisting - NRTK_SPACING_MAX_KM) * 0.25;
    }
  }

  const all = [...existing, ...proposed];
  let sum = 0;
  let max = 0;
  let covered = 0;
  let uncoveredPenalty = 0;
  for (const p of coverageGrid) {
    const d = nearestStationDistance(p, all);
    sum += d;
    if (d > max) max = d;
    if (d <= usefulKm) covered += 1;
    else uncoveredPenalty += (d - usefulKm) * 0.015;
  }
  const mean = sum / coverageGrid.length;
  const coverFrac = covered / coverageGrid.length;
  // Emphasize closing service holes over shaving already-good mean distance.
  return coverFrac * 160 - mean * 0.55 - max * 0.55 - uncoveredPenalty - penalty;
}

/** Greedy local polish: try swapping each gene for a better nearby candidate. */
function polishBest(
  genes: number[],
  candidatePool: GeoPoint[],
  existing: GeoPoint[],
  coverageGrid: GeoPoint[],
  usefulKm: number,
  minSeparationKm: number,
  rand: () => number,
): number[] {
  let best = [...genes];
  let bestScore = fitness(best, candidatePool, existing, coverageGrid, usefulKm, minSeparationKm);
  const attemptsPerGene = 8;

  for (let gi = 0; gi < best.length; gi++) {
    const base = candidatePool[best[gi]];
    for (let t = 0; t < attemptsPerGene; t++) {
      // Prefer candidates within ~1° of the current gene (local search).
      let trialIdx = Math.floor(rand() * candidatePool.length);
      if (rand() < 0.7) {
        let found = -1;
        for (let tries = 0; tries < 40; tries++) {
          const j = Math.floor(rand() * candidatePool.length);
          if (best.includes(j)) continue;
          const p = candidatePool[j];
          if (Math.abs(p.lat - base.lat) <= 1.1 && Math.abs(p.lon - base.lon) <= 1.1) {
            found = j;
            break;
          }
        }
        if (found >= 0) trialIdx = found;
      }
      if (best.includes(trialIdx)) continue;
      const trial = [...best];
      trial[gi] = trialIdx;
      const repaired = repairChromosome(trial, candidatePool.length, best.length, rand);
      const score = fitness(repaired, candidatePool, existing, coverageGrid, usefulKm, minSeparationKm);
      if (score > bestScore) {
        best = repaired;
        bestScore = score;
      }
    }
  }
  return best;
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
  const newSiteCount = clampNewSiteCount(options.newSiteCount ?? 4);
  // Scale search effort with how many sites the user wants to place.
  const generations = Math.max(
    20,
    Math.min(160, options.generations ?? 40 + newSiteCount * 8),
  );
  const populationSize = Math.max(
    20,
    Math.min(100, options.populationSize ?? 28 + newSiteCount * 5),
  );
  const gridStepDeg = options.gridStepDeg ?? (newSiteCount >= 8 ? 0.4 : 0.45);
  const usefulKm = options.usefulKm ?? USEFUL_COVERAGE_KM;
  const minSeparationKm = options.minSeparationKm ?? MIN_SEPARATION_KM;
  const rand = mulberry32(options.seed ?? 42);

  const existingStations = usableStations(stations);
  const existingPts = existingStations.map((s) => ({ lat: s.lat, lon: s.lon }));
  const coverageGrid = buildGrid(gridStepDeg);
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
    `Hard rule: proposed CORS sites must be inside Zimbabwe (never outside). Searching ${candidatePool.length} inland candidate cells for ${newSiteCount} new site(s).`,
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

  const gapWeights = new Float64Array(candidatePool.length);
  for (let i = 0; i < candidatePool.length; i++) {
    gapWeights[i] = nearestStationDistance(candidatePool[i], existingPts);
  }

  type Individual = { genes: number[]; score: number };
  let population: Individual[] = Array.from({ length: populationSize }, (_, idx) => {
    // Seed most of the population from coverage gaps; keep some random diversity.
    const genes =
      idx < Math.floor(populationSize * 0.7)
        ? gapBiasedSample(rand, candidatePool, existingPts, newSiteCount, usefulKm, gapWeights)
        : uniqueSample(rand, candidatePool.length, newSiteCount);
    return {
      genes,
      score: fitness(genes, candidatePool, existingPts, coverageGrid, usefulKm, minSeparationKm),
    };
  });

  for (let gen = 0; gen < generations; gen++) {
    population.sort((a, b) => b.score - a.score);
    const elites = population.slice(0, Math.max(2, Math.floor(populationSize * 0.12)));
    const next: Individual[] = [...elites];
    // Cool mutation: explore early, exploit later.
    const mutRate = 0.32 - (0.18 * gen) / Math.max(1, generations - 1);
    while (next.length < populationSize) {
      const p1 = tournamentPick(population, rand, 4);
      const p2 = tournamentPick(population, rand, 4);
      let child = crossover(p1.genes, p2.genes, newSiteCount, candidatePool.length, rand);
      child = mutate(child, candidatePool.length, newSiteCount, rand, mutRate);
      next.push({
        genes: child,
        score: fitness(child, candidatePool, existingPts, coverageGrid, usefulKm, minSeparationKm),
      });
    }
    population = next;
  }

  population.sort((a, b) => b.score - a.score);
  const polished = polishBest(
    population[0].genes,
    candidatePool,
    existingPts,
    coverageGrid,
    usefulKm,
    minSeparationKm,
    rand,
  );

  const proposedPts = polished
    .map((i) => candidatePool[i])
    .filter((p) => p != null && isValidProposedCorsSite(p.lat, p.lon));

  // Final hard reject: never return a site outside inland Zimbabwe.
  const safePts = proposedPts.filter((p) => isValidProposedCorsSite(p.lat, p.lon));
  if (safePts.length < proposedPts.length) {
    notes.push("Dropped proposed site(s) that failed the inland-Zimbabwe border check.");
  }
  const after = computeCoverageStats(existingStations, safePts, { gridStepDeg, usefulKm });

  const proposed: ProposedCorsSite[] = safePts.map((p, idx) => {
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
