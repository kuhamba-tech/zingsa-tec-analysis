import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "GIC Monitor — ZGIIS",
  description:
    "Geomagnetically induced current monitoring across the ZETDC transmission network — transformer-neutral measurements, EKF forecasting, storm attribution and reporting.",
};

export default function GicMonitorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
