import HomeClient from "./HomeClient";
import { fetchSpaceWeatherBootstrap } from "@/lib/serverSpaceWeather";

/**
 * Server page: prefetch /space-weather/current so National Dashboard metric
 * cards are not stuck on "Loading live feed…" when the Cursor preview host
 * delays or blocks the browser /backend fetch.
 */
export default async function HomePage() {
  const { sw } = await fetchSpaceWeatherBootstrap();
  return <HomeClient initialSw={sw} />;
}
