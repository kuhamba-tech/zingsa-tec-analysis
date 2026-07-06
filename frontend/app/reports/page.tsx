"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import SpaceWeatherReportsPanel from "@/components/dashboard/SpaceWeatherReportsPanel";
import type { SpaceWeatherReportPeriod } from "@/lib/types";

const PERIOD_ALIASES: Record<string, SpaceWeatherReportPeriod> = {
  hourly: "hourly",
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
  yearly: "yearly",
  annual: "yearly",
};

function resolvePeriod(raw: string | null): SpaceWeatherReportPeriod {
  if (!raw) return "daily";
  return PERIOD_ALIASES[raw.toLowerCase()] ?? "daily";
}

function ReportsContent() {
  const searchParams = useSearchParams();
  const period = resolvePeriod(searchParams.get("period"));

  const periodTitle =
    period === "yearly" ? "Annual" : period.charAt(0).toUpperCase() + period.slice(1);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div className="dashboard-header-copy">
        <h1 className="page-title">Space Weather Reports</h1>
        <p className="page-subtitle">
          {periodTitle} operational reports — Kp, Dst, TEC, GNSS risk, and CORS network impact from
          archived live observations.
        </p>
      </div>
      <SpaceWeatherReportsPanel initialPeriod={period} />
    </div>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<div className="banner banner-info">Loading reports…</div>}>
      <ReportsContent />
    </Suspense>
  );
}
