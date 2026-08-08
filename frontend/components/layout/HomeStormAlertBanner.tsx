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

  // Single combined strip so the hero and metrics stay the focus.
  const severity = alerts.some((a) => a.severity === "alert") ? "alert" : "warn";
  const message = alerts.map((a) => a.message).join(" · ");

  return (
    <section className="home-storm-alerts" aria-label="Space weather storm alerts">
      <div
        className={`banner ${severity === "alert" ? "banner-alert" : "banner-warn"} home-storm-alert`}
        role="alert"
      >
        <span className="home-storm-alert-label">Storm alert</span>
        <span className="home-storm-alert-msg">{message}</span>
      </div>
      <p className="home-storm-alert-foot">
        <Link href="/dashboard">Operations Dashboard</Link>
        {" · "}
        <Link href="/storm-watch">Storm Watch log</Link>
      </p>
    </section>
  );
}
