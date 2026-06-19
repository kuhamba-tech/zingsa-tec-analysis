import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Time Series — ZGIIS",
  description: "VTEC trends over time with NASA OMNIWeb and CelesTrak geomagnetic storm cross-referencing.",
};

export default function TimeSeriesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
