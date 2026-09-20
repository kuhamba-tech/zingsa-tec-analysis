"use client";

import Link from "next/link";
import StormWatchLog from "@/components/spaceWeather/StormWatchLog";
import StormWatchSummary from "@/components/spaceWeather/StormWatchSummary";
import StormWatchGuidePanel from "@/components/spaceWeather/StormWatchGuidePanel";
import OperationalAlerts from "@/components/spaceWeather/OperationalAlerts";
import { useStormWatchFeed } from "@/lib/useStormWatchFeed";

export default function StormWatchPage() {
  const {
    alerts,
    setAlerts,
    sw,
    stormStatus,
    ekf,
    solar,
    solarError,
    now,
    loading,
  } = useStormWatchFeed(168);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>
      <div className="dashboard-header-copy">
        <h1 className="page-title">Alerts</h1>
        <p className="page-subtitle">
          NOAA SWPC alerts, watches and warnings, plus operational geomagnetic storm watches for
          Zimbabwe and the ionospheric disturbance log.
        </p>
      </div>

      <OperationalAlerts solar={solar} now={now} refreshFailed={solarError} />

      <StormWatchGuidePanel />
      <StormWatchSummary sw={sw} stormStatus={stormStatus} ekf={ekf} loading={loading} />
      <StormWatchLog alerts={alerts} onAlertsChange={setAlerts} hours={168} />

      <p style={{ fontSize: "0.82rem", color: "var(--text-muted)", margin: 0 }}>
        Broader solar and heliospheric context stays on{" "}
        <Link href="/space-weather/">Space Weather</Link>.
      </p>
    </div>
  );
}
