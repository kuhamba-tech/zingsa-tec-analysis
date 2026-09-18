import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "TEC Heatmap — ZGIIS",
  description: "Interpolated VTEC grid and live CORS station status across Zimbabwe.",
};

export default function TecHeatmapLayout({ children }: { children: React.ReactNode }) {
  return children;
}
