"use client";

import Link from "next/link";
import styles from "@/components/spaceWeather/EarlyWarningCentre.module.css";
import EarlyWarningCentre from "@/components/spaceWeather/EarlyWarningCentre";
import StormWatchGuidePanel from "@/components/spaceWeather/StormWatchGuidePanel";
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
    earlyWarning,
    now,
    loading,
  } = useStormWatchFeed(168);

  return (
    <div className="alerts-centre-page" style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>
      <header className={styles.pageHeader}>
        <div><span className={styles.eyebrow}>ZINGSA / Space weather intelligence</span>
          <h1>Alerts Centre</h1>
          <p>Monitor developing threats. Understand local impact. Stay informed.</p>
        </div>
        <Link className={styles.contextLink} href="/space-weather/">View live space weather <span aria-hidden="true">{"\u2197"}</span></Link>
      </header>

      <EarlyWarningCentre
        snapshot={earlyWarning}
        loading={loading}
        sw={sw}
        solar={solar}
        solarError={solarError}
        now={now}
        stormStatus={stormStatus}
        ekf={ekf}
        ekfAlerts={alerts}
        onEkfAlertsChange={setAlerts}
      />

      <StormWatchGuidePanel />

      <p style={{ fontSize: "0.82rem", color: "#ffffff", margin: 0 }}>
        Broader solar and heliospheric context stays on{" "}
        <Link href="/space-weather/">Space Weather</Link>.
      </p>
    </div>
  );
}
