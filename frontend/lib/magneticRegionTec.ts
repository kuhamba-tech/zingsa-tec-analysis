/** Exclusive comparison bins in IGRF dip latitude, matching the map's model. */
export const MAGNETIC_TEC_REGIONS = [
  { id: "equator", label: "Magnetic equator", color: "#67e8f9", bounds: "|μ| ≤ 3°" },
  { id: "northCrest", label: "Northern crest", color: "#c4b5fd", bounds: "+10° to +20°" },
  { id: "southCrest", label: "Southern crest", color: "#f59e0b", bounds: "−20° to −10°" },
  { id: "low", label: "Low latitude", color: "#22c55e", bounds: "3° < |μ| < 10°" },
  { id: "mid", label: "Mid latitude", color: "#60a5fa", bounds: "20° < |μ| ≤ 60°" },
  { id: "high", label: "High latitude", color: "#f472b6", bounds: "|μ| > 60°" },
] as const;

export type MagneticTecRegion = typeof MAGNETIC_TEC_REGIONS[number]["id"];
export type MagneticTecStation = { code: string; name: string; dipLatitude: number | null };
type ObservedSeries = { station: string; points: { time: string; vtec_tecu: number }[] };

const key = (code: string) => code.toLowerCase().replace(/_+$/, "");

export function magneticTecRegion(dip: number | null): MagneticTecRegion | null {
  if (dip == null || !Number.isFinite(dip) || Math.abs(dip) > 90) return null;
  const distance = Math.abs(dip);
  if (distance <= 3) return "equator";
  if (distance < 10) return "low";
  if (distance <= 20) return dip > 0 ? "northCrest" : "southCrest";
  if (distance <= 60) return "mid";
  return "high";
}

export function magneticRegionTecSeries(
  series: ObservedSeries[], stations: MagneticTecStation[],
  startMs: number, endMs: number, binMinutes = 15,
) {
  const stepMs = Math.max(1, binMinutes) * 60_000;
  const binCount = Math.max(1, Math.ceil((endMs - startMs) / stepMs));
  const selected = new Map(stations.map(station => [key(station.code), station]));
  // First aggregate within each receiver/bin, then weight receivers equally.
  const receiverBins = new Map<string, Map<number, number[]>>();
  for (const row of series) {
    const code = key(row.station);
    if (!selected.has(code)) continue;
    for (const point of row.points) {
      const ms = Date.parse(point.time), value = point.vtec_tecu;
      if (!Number.isFinite(ms) || ms < startMs || ms >= endMs || !Number.isFinite(value) || value <= 0 || value > 50) continue;
      const index = Math.floor((ms - startMs) / stepMs);
      let bins = receiverBins.get(code);
      if (!bins) { bins = new Map(); receiverBins.set(code, bins); }
      const values = bins.get(index) ?? [];
      values.push(value);
      bins.set(index, values);
    }
  }
  const regions = MAGNETIC_TEC_REGIONS.map(region => {
    const members = [...selected.values()].filter(station => magneticTecRegion(station.dipLatitude) === region.id);
    const samples = Array.from({ length: binCount }, () => [] as number[]);
    const reporting: string[] = [];
    for (const station of members) {
      const bins = receiverBins.get(key(station.code));
      if (!bins?.size) continue;
      reporting.push(station.code);
      for (const [index, values] of bins) samples[index].push(values.reduce((a, b) => a + b, 0) / values.length);
    }
    return { ...region, members, reporting,
      values: samples.map(values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null),
      // Spread between receiver means, not between unequal raw sample counts.
      std: samples.map(values => {
        if (values.length < 2) return null;
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
      }),
      counts: samples.map(values => values.length) };
  });
  return { regions, labels: Array.from({ length: binCount }, (_, i) => new Date(startMs + i * stepMs).toISOString().slice(11, 16)),
    xValues: Array.from({ length: binCount }, (_, i) => i * binMinutes / 60),
    unknown: [...selected.values()].filter(station => magneticTecRegion(station.dipLatitude) == null) };
}
