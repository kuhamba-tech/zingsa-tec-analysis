"use client";

import StormWatchLog from "@/components/spaceWeather/StormWatchLog";
import StormWatchSummary from "@/components/spaceWeather/StormWatchSummary";
import StormWatchGuidePanel from "@/components/spaceWeather/StormWatchGuidePanel";
import { useStormWatchFeed } from "@/lib/useStormWatchFeed";

export default function StormWatchPage() {
  const { alerts, setAlerts, sw, stormStatus, ekf, loading } = useStormWatchFeed(168);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>
      <div className="dashboard-header-copy">
        <h1 className="page-title">Storm Watch</h1>
        <p className="page-subtitle">
          Operational geomagnetic alerting for Zimbabwe — live Kp/Dst storm watches and a log of ionospheric
          disturbances detected from forecast residuals.
        </p>
      </div>

      <StormWatchGuidePanel />
      <StormWatchSummary sw={sw} stormStatus={stormStatus} ekf={ekf} loading={loading} />
      <StormWatchLog alerts={alerts} onAlertsChange={setAlerts} hours={168} />
    </div>
  );
}
