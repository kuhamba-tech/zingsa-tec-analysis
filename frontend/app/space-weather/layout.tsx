import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Space Weather — ZGIIS",
  description: "Live solar and geomagnetic indices, NOAA SWPC alerts, and GNSS impact assessment.",
};

export default function SpaceWeatherLayout({ children }: { children: React.ReactNode }) {
  return children;
}
