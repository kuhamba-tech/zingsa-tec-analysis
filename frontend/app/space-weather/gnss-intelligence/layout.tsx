import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Navigation Weather — ZGIIS",
  description:
    "Daily positioning reliability for Zimbabwe: audience briefs for farmers, surveyors, drivers, and citizens — powered by live CORS and space-weather data.",
};

export default function GnssIntelligenceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
