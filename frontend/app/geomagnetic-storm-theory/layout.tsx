import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Geomagnetic Storm Metrics — ZGIIS",
  description:
    "Plain-language guide to Kp, Dst, Ap, F10.7 solar flux, solar wind, and how geomagnetic storms affect Zimbabwe.",
};

export default function GeomagneticTheoryLayout({ children }: { children: React.ReactNode }) {
  return children;
}
