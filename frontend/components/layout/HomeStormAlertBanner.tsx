"use client";

import Link from "next/link";
import { buildHomeStormAlerts, shouldShowHomeStormAlerts } from "@/lib/homeStormAlerts";
import type { EkfAlert, EkfStatus, SpaceWeatherCurrent } from "@/lib/types";

interface HomeStormAlertBannerProps {
  sw: SpaceWeatherCurrent | null;
  ekf: EkfStatus | null;
  pendingAlerts?: EkfAlert[];
}

/** Storm / EKF deviation alerts — shown on the home page when geomagnetic or ionospheric conditions require attention. */
export default function HomeStormAlertBanner({
  sw,
  ekf,
  pendingAlerts = [],
}: HomeStormAlertBannerProps) {
  if (!shouldShowHomeStormAlerts(sw, ekf, pendingAlerts)) return null;

  const alerts = buildHomeStormAlerts(sw, ekf, pendingAlerts);
  if (alerts.length === 0) return null;

  return (
    <section className="home-storm-alerts" aria-label="Space weather storm alerts">
      {alerts.map((alert) => (
        <div
          key={alert.message}
          className={`banner ${alert.severity === "alert" ? "banner-alert" : "banner-warn"} home-storm-alert`}
          role="alert"
        >
          <strong>{alert.message}</strong>
        </div>
      ))}
      <p className="home-storm-alert-foot">
        <Link href="/dashboard">Operations Dashboard</Link>
        {" · "}
        <Link href="/storm-watch">Storm Watch log</Link>
      </p>
    </section>
  );
}
