"use client";

import { Suspense, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import NetworkUptimePanel, {
  type UptimeRangeKey,
  uptimeRangeIndex,
  uptimeRangeKey,
} from "@/components/dashboard/NetworkUptimePanel";
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

const RANGE_ALIASES: Record<string, UptimeRangeKey> = {
  "1d": "1d",
  "1day": "1d",
  day: "1d",
  daily: "1d",
  "1w": "1w",
  "1week": "1w",
  week: "1w",
  weekly: "1w",
  "1m": "1m",
  "1month": "1m",
  month: "1m",
  monthly: "1m",
  "1y": "1y",
  "1year": "1y",
  year: "1y",
  yearly: "1y",
  annual: "1y",
};

function resolvePeriod(raw: string | null): SpaceWeatherReportPeriod {
  if (!raw) return "daily";
  return PERIOD_ALIASES[raw.toLowerCase()] ?? "daily";
}

function resolveUptimeRange(raw: string | null): UptimeRangeKey {
  if (!raw) return "1w";
  return RANGE_ALIASES[raw.toLowerCase()] ?? uptimeRangeKey(uptimeRangeIndex(raw));
}

function ReportsContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const reportType = searchParams.get("type") === "uptime" ? "uptime" : "space-weather";
  const period = resolvePeriod(searchParams.get("period"));
  const uptimeRange = resolveUptimeRange(searchParams.get("range"));

  const setUptimeRange = useCallback(
    (key: UptimeRangeKey) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("type", "uptime");
      params.set("range", key);
      params.delete("period");
      router.replace(`/reports?${params.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const periodTitle =
    period === "yearly" ? "Annual" : period.charAt(0).toUpperCase() + period.slice(1);

  const rangeTitle =
    uptimeRange === "1d"
      ? "1-day"
      : uptimeRange === "1w"
        ? "1-week"
        : uptimeRange === "1m"
          ? "1-month"
          : "1-year";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
      <div className="dashboard-header-copy">
        <h1 className="page-title">
          {reportType === "uptime" ? "Station Uptime Reports" : "Space Weather Reports"}
        </h1>
        <p className="page-subtitle">
          {reportType === "uptime"
            ? `${rangeTitle} CORS station uptime analysis — filter by 1 day, 1 week, 1 month, or 1 year. Export CSV or save a PDF report.`
            : `${periodTitle} operational reports — Kp, Dst, TEC, GNSS risk, and CORS network impact. Save as JSON or PDF.`}
        </p>
      </div>

      <div className="reports-type-tabs" role="tablist" aria-label="Report type">
        <Link
          href="/reports?period=daily"
          className={`home-map-layer-btn${reportType === "space-weather" ? " is-active" : ""}`}
          role="tab"
          aria-selected={reportType === "space-weather"}
        >
          Space Weather
        </Link>
        <Link
          href={`/reports?type=uptime&range=${uptimeRange}`}
          className={`home-map-layer-btn${reportType === "uptime" ? " is-active" : ""}`}
          role="tab"
          aria-selected={reportType === "uptime"}
        >
          Station Uptime
        </Link>
      </div>

      {reportType === "uptime" ? (
        <NetworkUptimePanel
          title="Station Uptime Report"
          initialRangeKey={uptimeRange}
          onRangeKeyChange={setUptimeRange}
        />
      ) : (
        <SpaceWeatherReportsPanel initialPeriod={period} />
      )}
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
