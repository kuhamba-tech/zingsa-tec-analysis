"use client";
import GicMonitorPanel from "@/components/gic/GicMonitorPanel";
import GicGuidePanel from "@/components/gic/GicGuidePanel";

export default function GicMonitorPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>
      <div className="dashboard-header-copy">
        <h1 className="page-title">🧲 GIC Monitor — ZETDC Grid &amp; ZPC Generation</h1>
        <p className="page-subtitle">
          Monitor geomagnetically induced currents on Zimbabwe&apos;s transmission network and assess
          space-weather risk to transformers and ZPC generation assets.
        </p>
      </div>
      <GicGuidePanel />
      <GicMonitorPanel />
    </div>
  );
}
