import templates from "../../static/data/navigation_news_plain.json";
import type { NavigationNewsBrief } from "./gnssAudienceNews";
import type { ForecastStatus, GnssForecastCity } from "./gnssWeatherIntelligence";
import type { LiveStationVtecSeries, SpaceWeatherCurrent } from "./types";
import { newsTimeFields, newsTimeLines } from "./newsTimestamps";

export interface RegionalNewsOptions {
  forecasts?: GnssForecastCity[];
  localTec?: LiveStationVtecSeries[];
  city?: string;
}
const rank: Record<ForecastStatus, number> = { excellent: 0, moderate: 1, warning: 2 };
function cat(ms: number, year: boolean) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Harare", day: "2-digit", month: "short", ...(year ? { year: "numeric" as const } : {}),
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(ms)).replace(" at ", ", ");
}

export function regionalNavigationNews(
  brief: NavigationNewsBrief, tone: ForecastStatus, computedAt: string,
  sw: SpaceWeatherCurrent | null, options: RegionalNewsOptions,
): NavigationNewsBrief {
  if (!options.forecasts?.length && !options.city) return brief;
  const now = Date.parse(computedAt);
  if (!Number.isFinite(now)) return brief;
  const selected = options.city?.trim().toUpperCase();
  const selectedLocation = templates.locations.find((location) => location.city === selected);
  if (selected && !selectedLocation) throw new Error("Unknown Navigation News city");
  const byStation = new Map((options.localTec ?? []).map((row) => [row.station.toLowerCase().replace(/_+$/, ""), row]));
  const byCity = new Map((options.forecasts ?? []).map((row) => [row.city, row]));
  type Reading = { location: typeof templates.locations[number]; station: string; time: number; value: number; baseline?: [number, number] };
  const readings: Reading[] = [];
  const knownTimes = new Map<string, number>();
  for (const location of templates.locations) {
    const candidates: Reading[] = [];
    for (const station of location.stations) {
      const points = new Map<number, number>();
      for (const point of byStation.get(station)?.points ?? []) {
        const time = Date.parse(point.time), value = point.vtec_tecu;
        if (Number.isFinite(time) && typeof value === "number" && Number.isFinite(value)
          && value > 0 && value < 200 && (point.obs_count ?? 1) > 0
          && now - time >= -60_000) {
          knownTimes.set(location.city, Math.max(time, knownTimes.get(location.city) ?? time));
          if (now - time <= 3_600_000) points.set(time, value);
        }
      }
      const ordered = [...points.entries()].sort((a, b) => a[0] - b[0]);
      const latest = ordered.at(-1);
      if (!latest || now - latest[0] > 900_000) continue;
      const nearby = ordered.filter(([time]) => latest[0] - time >= 0 && latest[0] - time <= 1_800_000);
      let baseline: [number, number] | undefined;
      if (nearby.length >= 3 && nearby.slice(1).every((point, i) => point[0] - nearby[i][0] <= 600_000)) {
        baseline = nearby.filter(([time]) => latest[0] - time >= 600_000 && latest[0] - time <= 1_200_000)
          .sort((a, b) => Math.abs(latest[0] - a[0] - 900_000) - Math.abs(latest[0] - b[0] - 900_000))[0];
      }
      candidates.push({ location, station, time: latest[0], value: latest[1], baseline });
    }
    candidates.sort((a, b) => b.time - a.time);
    if (candidates[0]) readings.push(candidates[0]);
  }
  readings.sort((a, b) => {
    const statusA = byCity.get(a.location.city)?.status ?? "excellent";
    const statusB = byCity.get(b.location.city)?.status ?? "excellent";
    return rank[statusB] - rank[statusA]
      || (b.baseline ? Math.abs(b.value - b.baseline[1]) : 0) - (a.baseline ? Math.abs(a.value - a.baseline[1]) : 0);
  });
  const reading = selected ? readings.find((item) => item.location.city === selected) : readings[0];
  const location = selectedLocation ?? reading?.location;
  const name = location?.name ?? "Zimbabwe";
  const forecast = location ? byCity.get(location.city) : undefined;
  const globalTime = sw?.updated_utc ? Date.parse(sw.updated_utc) : NaN;
  const globalFresh = Number.isFinite(globalTime) && now - globalTime >= -60_000 && now - globalTime <= 1_800_000
    && [sw?.kp, sw?.dst, sw?.s4].some((v) => typeof v === "number" && Number.isFinite(v));
  const fields = new Map(forecast?.fields.map((field) => [field.label, field.value]) ?? []);
  const localState = fields.get("CORS site") ? forecast?.status ?? "excellent" : "excellent";
  const globalState = globalFresh ? tone : "excellent";
  const state: ForecastStatus | "unknown" = !reading && !globalFresh ? "unknown"
    : rank[globalState] >= rank[localState] ? globalState : localState;
  const networkUnconfirmed = !!fields.get("CORS site") && typeof forecast?.feedReliability === "number" && forecast.feedReliability < 50;
  let local = templates.regional.missing;
  if (reading) {
    local = `Near ${name}, TEC is ${reading.value.toFixed(1)} TEC units.`;
    if (reading.baseline) {
      const [earlierTime, earlier] = reading.baseline;
      const minutes = Math.round((reading.time - earlierTime) / 60_000);
      const delta = Math.round((reading.value - earlier) * 10) / 10;
      local = delta ? `Near ${name}, TEC ${delta > 0 ? "rose" : "fell"} from ${earlier.toFixed(1)} to ${reading.value.toFixed(1)} TEC units in ${minutes} minutes.`
        : `${local} It changed little over ${minutes} minutes.`;
    }
  }
  const headline = `${name}: ${state === "unknown" ? "waiting for fresh local readings" : state === "excellent" ? "latest TEC and GPS advice" : "GPS accuracy watch"}`;
  const effect = networkUnconfirmed ? templates.regional.network : templates.regional.effects[brief.id];
  let summary = `${local} ${templates.regional.explanation} ${effect}`;
  if (globalFresh && tone !== "excellent") {
    summary += " " + (typeof sw?.kp === "number" && sw.kp >= 5 ? templates.regional.global_storm : templates.regional.global_watch);
  }
  const bullets = [`When to work: ${templates.regional.timing[brief.id]}`,
    `Check again: ${cat(now + 900_000, false)} CAT.${state === "excellent" ? "" : " Recovery time is unconfirmed."}`];
  const times = newsTimeFields(reading?.time ?? (location ? knownTimes.get(location.city) ?? null : null), now, globalTime);
  const action = templates.audiences[brief.id].action[state];
  const script = [`ZINGSA Navigation News | ${name}`, ...newsTimeLines(times.dataObservedAt, times.briefGeneratedAt, times.dataCheckedAt),
    templates.audiences[brief.id].title, headline, summary, `What to do: ${action}`, ...bullets, "#ZINGSA #Zimbabwe #GPS"].join("\n");
  return { ...brief, headline, summary, spaceWeatherToday: summary, spaceWeatherBullets: [], bullets, action,
    broadcastScript: script, socialScript: script, statusTone: state === "unknown" ? "moderate" : state, ...times };
}
