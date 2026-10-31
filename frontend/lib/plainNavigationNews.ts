import templates from "../../static/data/navigation_news_plain.json";
import type { NavigationNewsBrief } from "./gnssAudienceNews";
import type { SpaceWeatherCurrent } from "./types";
import type { ForecastStatus } from "./gnssWeatherIntelligence";
import { regionalNavigationNews, type RegionalNewsOptions } from "./regionalNavigationNews";
import { newsTimeFields, newsTimeLines } from "./newsTimestamps";

export function plainNavigationNews(
  brief: NavigationNewsBrief,
  tone: ForecastStatus,
  computedAt: string,
  sw: SpaceWeatherCurrent | null,
  options: RegionalNewsOptions = {},
): NavigationNewsBrief {
  const observed = sw?.updated_utc ? Date.parse(sw.updated_utc) : NaN;
  const generated = Date.parse(computedAt);
  const stale = !Number.isFinite(observed) || !Number.isFinite(generated) || Math.abs(generated - observed) > 1_800_000;
  const hasReading = [sw?.kp, sw?.dst, sw?.s4].some((value) => typeof value === "number" && Number.isFinite(value));
  const state = stale || !hasReading ? "unknown" : tone;
  const copy = templates.states[state];
  const audience = templates.audiences[brief.id];
  const action = audience.action[state];
  const times = newsTimeFields(null, generated, observed);
  const script = [
    "ZINGSA Navigation News | Zimbabwe",
    ...newsTimeLines(times.dataObservedAt, times.briefGeneratedAt, times.dataCheckedAt),
    audience.title, copy.headline, copy.summary, `What to do: ${action}`,
    "#ZINGSA #Zimbabwe #SpaceWeather",
  ].join("\n");
  const plain: NavigationNewsBrief = {
    ...brief, title: audience.title, audience: audience.title,
    headline: copy.headline, summary: copy.summary, action,
    spaceWeatherToday: copy.summary, spaceWeatherBullets: [], bullets: [],
    statusTone: state === "unknown" ? "moderate" : tone,
    broadcastScript: script, socialScript: script,
    ...times,
  };
  return regionalNavigationNews(plain, tone, computedAt, sw, options);
}
