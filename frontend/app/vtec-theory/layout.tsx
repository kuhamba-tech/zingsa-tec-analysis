import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "VTEC Theory — ZGIIS",
  description: "Step-by-step derivation of Vertical Total Electron Content from dual-frequency GNSS observations.",
};

export default function VtecTheoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
