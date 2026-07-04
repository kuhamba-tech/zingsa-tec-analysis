import type { EkfPoint, TimelinePoint } from "./types";

/** Align EKF points to timeline points by exact timestamp. */
export function alignEkfToPoints(points: TimelinePoint[], ekfPoints: EkfPoint[] | undefined) {
  const byT = new Map<string, EkfPoint>();
  (ekfPoints ?? []).forEach((p) => byT.set(p.t, p));
  const data: (number | null)[] = [];
  const meta: ({ error?: number | null; confidence?: number | null } | null)[] = [];
  for (const pt of points) {
    const m = byT.get(pt.t);
    data.push(m?.predicted ?? null);
    meta.push(m ? { error: m.error, confidence: m.confidence } : null);
  }
  return { data, meta };
}

/** Align EKF to report mini-chart labels (HH:MM). */
export function alignEkfToReportLabels(labels: string[], ekfPoints: EkfPoint[] | undefined) {
  const byHm = new Map<string, EkfPoint>();
  (ekfPoints ?? []).forEach((p) => {
    const hm = p.t.replace("T", " ").slice(11, 16);
    byHm.set(hm, p);
  });
  const data: (number | null)[] = [];
  const meta: ({ error?: number | null; confidence?: number | null } | null)[] = [];
  for (const label of labels) {
    const m = byHm.get(label);
    data.push(m?.predicted ?? null);
    meta.push(m ? { error: m.error, confidence: m.confidence } : null);
  }
  return { data, meta };
}
