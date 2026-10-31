/** Display interpolation only: the scientific gradient remains on its 1-degree grid. */
export type GradientGrid = ReadonlyArray<ReadonlyArray<number | null>>;
type Point = readonly [number, number];
export type ContourSegment = readonly [Point, Point];

export function sampleGradient(grid: GradientGrid, x: number, y: number): number | null {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  let sum = 0;
  let weight = 0;
  for (let dy = 0; dy <= 1; dy++) {
    for (let dx = 0; dx <= 1; dx++) {
      const value = grid[y0 + dy]?.[x0 + dx];
      const w = (dx ? x - x0 : 1 - (x - x0)) * (dy ? y - y0 : 1 - (y - y0));
      if (value == null || !Number.isFinite(value) || w <= 0) continue;
      sum += value * w;
      weight += w;
    }
  }
  return weight > 0 ? sum / weight : null;
}

/** Marching squares between measured cell centres; never cross a missing corner. */
export function gradientContourSegments(grid: GradientGrid, level: number): ContourSegment[] {
  const segments: ContourSegment[] = [];
  for (let y = 0; y < grid.length - 1; y++) {
    for (let x = 0; x < (grid[y]?.length ?? 0) - 1; x++) {
      const values = [grid[y]?.[x], grid[y]?.[x + 1], grid[y + 1]?.[x + 1], grid[y + 1]?.[x]];
      if (!values.every((v): v is number => v != null && Number.isFinite(v))) continue;
      const points: Point[] = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
      const crossings: Array<{ edge: number; point: Point }> = [];
      for (let edge = 0; edge < 4; edge++) {
        const next = (edge + 1) % 4;
        const a = values[edge]!;
        const b = values[next]!;
        if ((a >= level) === (b >= level)) continue;
        const t = (level - a) / (b - a);
        crossings.push({ edge, point: [
          points[edge][0] + t * (points[next][0] - points[edge][0]),
          points[edge][1] + t * (points[next][1] - points[edge][1]),
        ] });
      }
      if (crossings.length === 2) segments.push([crossings[0].point, crossings[1].point]);
      if (crossings.length === 4) {
        // Bilinear asymptotic decider resolves the two possible saddle connections.
        const q = (values[0]! - level) * (values[2]! - level)
          - (values[1]! - level) * (values[3]! - level);
        const pairs = q >= 0 ? [[0, 1], [2, 3]] : [[0, 3], [1, 2]];
        for (const [a, b] of pairs) segments.push([crossings[a].point, crossings[b].point]);
      }
    }
  }
  return segments;
}
