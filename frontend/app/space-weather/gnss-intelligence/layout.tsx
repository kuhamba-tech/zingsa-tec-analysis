import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Navigation Weather — ZGIIS",
  description:
    "Daily positioning reliability for Zimbabwe: audience briefs for citizens, farmers, surveyors, aviation, and drivers — powered by live CORS and space-weather data.",
};

export default function GnssIntelligenceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
