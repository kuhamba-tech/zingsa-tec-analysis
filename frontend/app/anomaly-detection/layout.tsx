import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Anomaly Detection — ZGIIS",
  description: "Storm correlation, diurnal/seasonal variation, solar-cycle context, and TEC anomaly flagging.",
};

export default function AnomalyDetectionLayout({ children }: { children: React.ReactNode }) {
  return children;
}
