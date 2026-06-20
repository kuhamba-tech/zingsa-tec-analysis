import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GNSS Weather Intelligence — ZGIIS",
  description:
    "National positioning intelligence: CORS TEC, space weather fusion, GNSS forecast, digital twin, and industry-specific alerts for Zimbabwe.",
};

export default function GnssIntelligenceLayout({ children }: { children: React.ReactNode }) {
  return children;
}
