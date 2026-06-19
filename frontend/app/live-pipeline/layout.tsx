import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Live Pipeline — ZGIIS",
  description: "Live NTRIP-to-VTEC ingestion pipeline status and CNN-GRU forecast.",
};

export default function LivePipelineLayout({ children }: { children: React.ReactNode }) {
  return children;
}
