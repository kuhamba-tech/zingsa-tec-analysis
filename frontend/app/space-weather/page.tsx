import SpaceWeatherClient from "./SpaceWeatherClient";
import { fetchSpaceWeatherBootstrap } from "@/lib/serverSpaceWeather";

/**
 * Server page: prefetch current + solar so metric cards render with live
 * values in the first HTML response (no empty Connecting shell).
 */
export default async function SpaceWeatherPage() {
  const { sw, sa } = await fetchSpaceWeatherBootstrap();
  return <SpaceWeatherClient initialSw={sw} initialSa={sa} />;
}
