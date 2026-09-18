export type MonitoringFreshness = "LIVE" | "DELAYED" | "UNAVAILABLE";

export function observationEpoch(value: string | null | undefined): number | null {
  if (!value) return null;
  const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const epoch = Date.parse(normalized);
  return Number.isFinite(epoch) ? epoch : null;
}

/** A successful HTTP request does not make an old observation current. */
export function monitoringFreshness(
  timestamp: string | null | undefined,
  now: number,
  available: boolean,
  refreshFailed = false,
  maxAgeMinutes = 15,
): MonitoringFreshness {
  if (!available) return "UNAVAILABLE";
  const epoch = observationEpoch(timestamp);
  if (refreshFailed || epoch === null || epoch > now + 60_000 || now - epoch > maxAgeMinutes * 60_000) {
    return "DELAYED";
  }
  return "LIVE";
}

export function observationTime(timestamp: string | null | undefined): string {
  const epoch = observationEpoch(timestamp);
  return epoch === null ? "Time unavailable" : `${new Date(epoch).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
