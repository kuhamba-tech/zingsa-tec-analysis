"use client";

import Link from "next/link";
import { buildHomeStormAlerts, shouldShowHomeStormAlerts } from "@/lib/homeStormAlerts";
import type { SpaceWeatherCurrent } from "@/lib/types";

interface HomeStormAlertBannerProps {
  sw: SpaceWeatherCurrent | null;
}

/** Storm alerts — shown when observed Kp/Dst cross storm thresholds (not EKF residuals). */
export default function HomeStormAlertBanner({ sw }: HomeStormAlertBannerProps) {
  if (!shouldShowHomeStormAlerts(sw)) return null;

  const alerts = buildHomeStormAlerts(sw);
  if (alerts.length === 0) return null;

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
