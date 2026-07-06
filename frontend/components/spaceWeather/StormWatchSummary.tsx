"use client";

import Link from "next/link";
import {
  GEOMAGNETIC_ALERT_RULES,
  classifyGeomagneticActivity,
  geomagneticAlertLevel,
  isGeomagneticStorm,
  isPossibleGeomagneticStorm,
} from "@/lib/geomagneticStormAlerts";
import type { EkfStatus, SpaceWeatherCurrent, StormAlertStatus } from "@/lib/types";

function fmt(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

function channelLabel(channels: Record<string, boolean> | undefined): string {
  if (!channels) return "Rules active";
  const on = Object.entries(channels).filter(([, v]) => v).map(([k]) => k);
  return on.length ? on.join(", ") : "Rules active";
}

function notificationSubtext(stormStatus: StormAlertStatus | null): string {
  const rules = stormStatus?.alert_rules?.length ? stormStatus.alert_rules : GEOMAGNETIC_ALERT_RULES;
  const channels = channelLabel(stormStatus?.notification_channels);
  if (channels !== "Rules active") return channels;
  return `2 alert rules · ${rules[0]?.split(":")[0] ?? "Kp/Dst"}`;
}

/** Live storm snapshot: indices, active EKF alerts, notification status. */
export default function StormWatchSummary({
  sw,
  stormStatus,
  ekf,
  loading,
}: {
  sw: SpaceWeatherCurrent | null;
  stormStatus: StormAlertStatus | null;
  ekf: EkfStatus | null;
  loading: boolean;
}) {
  if (loading && !sw) {
    return (
      <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Loading live storm conditions…</p>
    );
  }

  const kp = sw?.kp ?? null;
  const dst = sw?.dst ?? null;
  const geo = classifyGeomagneticActivity(kp, dst);
  const level = stormStatus?.geomagnetic_level ?? geomagneticAlertLevel(sw);
  const geomagneticStorm = level === "storm" || isGeomagneticStorm(sw);
  const possibleStorm = level === "possible" || isPossibleGeomagneticStorm(sw);
  const activeCount = stormStatus?.active_count ?? ekf?.active_alert_count ?? 0;
  const ekfAlerts = stormStatus?.ekf_alert_count ?? 0;
  const stormLevel = stormStatus?.kp_storm_level ?? ekf?.kp_storm_level ?? null;
  const banner = stormStatus?.banner ?? ekf?.banner ?? geo.headline;

  const statusTone = geomagneticStorm || activeCount > 0
    ? "storm-summary--alert"
    : possibleStorm
      ? "storm-summary--warn"
      : "storm-summary--ok";

  const defaultBanner = geomagneticStorm
    ? "Geomagnetic storm thresholds exceeded (Kp ≥ 5 or Dst ≤ −50 nT)."
    : possibleStorm
      ? "Possible geomagnetic storm — Kp ≥ 4 or Dst ≤ −30 nT."
      : "No active geomagnetic or EKF deviation alerts.";

  return (
    <div className={`card storm-summary ${statusTone}`}>
      <div className="storm-summary-header">
        <div>
          <div className="operations-chart-title" style={{ marginBottom: "0.35rem" }}>
            Live Storm Status
          </div>
          {banner ? (
            <p className="storm-summary-banner">{banner}</p>
          ) : (
            <p className="storm-summary-muted">{defaultBanner}</p>
          )}
        </div>
        <Link href="/dashboard#dashboard-timelines" className="btn storm-summary-link">
          View charts →
        </Link>
      </div>

      <div className="storm-summary-grid">
        <div className="storm-summary-metric">
          <span className="storm-summary-label">Kp Index</span>
          <strong>{fmt(kp, 0)}</strong>
          <span className="storm-summary-sub">{stormLevel ?? sw?.kp_condition ?? "—"}</span>
        </div>
        <div className="storm-summary-metric">
          <span className="storm-summary-label">Dst (nT)</span>
          <strong>{fmt(dst, 0)}</strong>
          <span className="storm-summary-sub">
            {dst != null && dst <= -50 ? "Storm threshold" : dst != null && dst <= -30 ? "Elevated" : "Quiet bias"}
          </span>
        </div>
        <div className="storm-summary-metric">
          <span className="storm-summary-label">Active alerts</span>
          <strong>{activeCount}</strong>
          <span className="storm-summary-sub">{ekfAlerts} EKF deviation{ekfAlerts === 1 ? "" : "s"}</span>
        </div>
        <div className="storm-summary-metric">
          <span className="storm-summary-label">Notifications</span>
          <strong>{stormStatus?.dry_run === false ? "Live" : "Rules on"}</strong>
          <span className="storm-summary-sub">{notificationSubtext(stormStatus)}</span>
        </div>
      </div>

      <div className="storm-summary-rules" aria-label="Configured geomagnetic alert rules">
        {(stormStatus?.alert_rules ?? GEOMAGNETIC_ALERT_RULES).map((rule) => (
          <div key={rule} className="storm-summary-rule">
            <span className="storm-summary-rule-dot" aria-hidden />
            {rule}
          </div>
        ))}
      </div>
    </div>
  );
}
