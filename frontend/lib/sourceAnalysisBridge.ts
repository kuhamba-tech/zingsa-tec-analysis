export interface SourceAnalysisRequest {
  start: string;
  end: string;
  station: string;
  requestedAt: number;
}

const STORAGE_KEY = "zgiis-source-analysis-request-v1";
const CHANGE_EVENT = "zgiis-source-analysis-request";

function isUtcDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function isRequest(value: unknown): value is SourceAnalysisRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<SourceAnalysisRequest>;
  return isUtcDate(request.start)
    && isUtcDate(request.end)
    && request.start <= request.end
    && typeof request.station === "string"
    && typeof request.requestedAt === "number"
    && Number.isFinite(request.requestedAt);
}

export function readSourceAnalysisRequest(): SourceAnalysisRequest | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRequest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function publishSourceAnalysisRequest(request: SourceAnalysisRequest): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(request));
  } catch {
    return false;
  }
  window.dispatchEvent(new CustomEvent<SourceAnalysisRequest>(CHANGE_EVENT, { detail: request }));
  return true;
}

export function subscribeSourceAnalysisRequest(
  listener: (request: SourceAnalysisRequest | null) => void,
): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener(readSourceAnalysisRequest());
  };
  const onChange = (event: Event) => {
    const request = (event as CustomEvent<SourceAnalysisRequest>).detail;
    if (isRequest(request)) listener(request);
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}
