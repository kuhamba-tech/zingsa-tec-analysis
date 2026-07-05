"use client";

import StormWatchLog from "@/components/spaceWeather/StormWatchLog";
import StormWatchSummary from "@/components/spaceWeather/StormWatchSummary";
import { useStormWatchFeed } from "@/lib/useStormWatchFeed";

export default function StormWatchPage() {
  const { alerts, setAlerts, sw, stormStatus, ekf, loading } = useStormWatchFeed(168);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>
      <div className="dashboard-header-copy">
        <h1 className="page-title">Storm Watch</h1>
        <p className="page-subtitle">
          A running log of moments when live readings broke away from forecast — an early tell for geomagnetic
          storms and ionospheric disturbance over Zimbabwe.
        </p>
      </div>

      <StormWatchSummary sw={sw} stormStatus={stormStatus} ekf={ekf} loading={loading} />
      <StormWatchLog alerts={alerts} onAlertsChange={setAlerts} hours={168} />
    </div>
  );
}
