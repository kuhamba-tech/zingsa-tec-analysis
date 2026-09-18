import type { NavigationNewsBriefApi } from "./types";
import type { NavigationNewsBrief } from "./gnssAudienceNews";
import type { ForecastStatus } from "./gnssWeatherIntelligence";

export function formatUtcLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  return iso.replace("T", " ").replace("Z", " UTC").slice(0, 19);
}

export function mapNavigationNewsBrief(b: NavigationNewsBriefApi): NavigationNewsBrief {
  return {
    id: b.id,
    icon: b.icon,
    title: b.title,
    audience: b.audience,
    headline: b.headline,
    summary: b.summary,
    spaceWeatherToday: b.space_weather_today,
    spaceWeatherBullets: b.space_weather_bullets,
    bullets: b.bullets,
    action: b.action,
    statusTone: b.status_tone as ForecastStatus,
    broadcastScript: b.broadcast_script,
    socialScript: b.social_script,
    channels: b.channels,
  };
}

export function msUntilNextUpdate(nextUpdateAt: string | null | undefined): number {
  if (!nextUpdateAt) return 15 * 60_000;
  const next = Date.parse(nextUpdateAt);
  if (Number.isNaN(next)) return 15 * 60_000;
  const delta = next - Date.now();
  return Math.max(60_000, Math.min(delta, 4 * 60 * 60_000));
}
