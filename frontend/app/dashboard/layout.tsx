import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Dashboard — ZGIIS",
  description: "Real-time space weather, geomagnetic, ionospheric, and Zimbabwe CORS network operations dashboard.",
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return children;
}
