import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "PRN Explorer — ZGIIS",
  description: "Per-satellite (PRN) TEC analysis across GPS, GLONASS, Galileo, and BeiDou constellations.",
};

export default function PrnExplorerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
