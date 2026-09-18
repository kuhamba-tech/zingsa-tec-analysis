import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Processing — ZGIIS",
  description: "Upload and process RINEX/CMN GNSS observations to compute dual-frequency Total Electron Content (TEC).",
};

export default function ProcessingLayout({ children }: { children: React.ReactNode }) {
  return children;
}
