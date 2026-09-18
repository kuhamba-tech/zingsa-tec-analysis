import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Storm Watch — ZGIIS",
  description: "Live log of readings that have drifted from forecast across Zimbabwe's space-weather and ionospheric indicators.",
};

export default function StormWatchLayout({ children }: { children: React.ReactNode }) {
  return children;
}
