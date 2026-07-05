"use client";

import Link from "next/link";
import { isGeomagneticStorm } from "@/lib/stormAlarmSound";
import type { EkfStatus, SpaceWeatherCurrent, StormAlertStatus } from "@/lib/types";

function fmt(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(digits);
}

function channelLabel(channels: Record<string, boolean> | undefined): string {
  if (!channels) return "None configured";
  const on = Object.entries(channels).filter(([, v]) => v).map(([k]) => k);
  return on.length ? on.join(", ") : "None configured";
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
  const geomagnetic = isGeomagneticStorm(sw);
  const activeCount = stormStatus?.active_count ?? ekf?.active_alert_count ?? 0;
  const ekfAlerts = stormStatus?.ekf_alert_count ?? 0;
  const stormLevel = stormStatus?.kp_storm_level ?? ekf?.kp_storm_level ?? null;
  const banner = stormStatus?.banner ?? ekf?.banner ?? null;

  const statusTone = geomagnetic || activeCount > 0 ? "storm-summary--alert" : kp != null && kp >= 4 ? "storm-summary--warn" : "storm-summary--ok";

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
            <p className="storm-summary-muted">No active geomagnetic or EKF deviation alerts.</p>
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
          <span className="storm-summary-sub">{dst != null && dst <= -50 ? "Storm threshold" : "Quiet bias"}</span>
        </div>
        <div className="storm-summary-metric">
          <span className="storm-summary-label">Active alerts</span>
          <strong>{activeCount}</strong>
          <span className="storm-summary-sub">{ekfAlerts} EKF deviation{ekfAlerts === 1 ? "" : "s"}</span>
        </div>
        <div className="storm-summary-metric">
          <span className="storm-summary-label">Notifications</span>
          <strong>{stormStatus?.dry_run ? "Dry run" : "Live"}</strong>
          <span className="storm-summary-sub">{channelLabel(stormStatus?.notification_channels ?? ekf?.notification_channels)}</span>
        </div>
      </div>
    </div>
  );
}
