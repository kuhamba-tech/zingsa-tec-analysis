"use client";
import GicMonitorPanel from "@/components/gic/GicMonitorPanel";

export default function GicMonitorPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>
      <div className="dashboard-header-copy">
        <h1 className="page-title">🧲 GIC Monitor — ZETDC Grid</h1>
        <p className="page-subtitle">
          Geomagnetically induced currents measured on transformer neutrals across the Zimbabwe
          transmission network (ZINGSA × ZETDC programme). Observed currents are tracked against an
          Extended Kalman Filter forecast, cross-checked with Kp/Dst, and summarised in hourly to
          yearly reports.
        </p>
      </div>
      <GicMonitorPanel />
    </div>
  );
}
