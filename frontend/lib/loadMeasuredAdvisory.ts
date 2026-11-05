import { buildMeasuredAdvisory, isAdvisoryAudience, type AdvisoryCard } from "./advisoryShare";
import { fetchSpaceWeatherBootstrap } from "./serverSpaceWeather";

export async function loadMeasuredAdvisory(audience: string): Promise<AdvisoryCard | null> {
  if (!isAdvisoryAudience(audience)) return null;
  const { sw, sa } = await fetchSpaceWeatherBootstrap();
  return buildMeasuredAdvisory(sw, sa, audience);
}
