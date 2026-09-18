"use client";

import Link from "next/link";
import {
  GEOMAGNETIC_ALERT_RULES,
  classifyGeomagneticActivity,
  geomagneticAlertLevel,
  isGeomagneticStorm,
  isPossibleGeomagneticStorm,
} from "@/lib/geomagneticStormAlerts";
import type { SpaceWeatherCurrent, StormAlertStatus } from "@/lib/types";

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

/** Live storm snapshot from observed Kp / Dst only (not EKF residuals). */
export default function StormWatchSummary({
  sw,
  stormStatus,
  loading,
}: {
  sw: SpaceWeatherCurrent | null;
  stormStatus: StormAlertStatus | null;
  /** @deprecated Ignored — storm status is index-based, not EKF. */
  ekf?: unknown;
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
  const stormLevel = stormStatus?.kp_storm_level ?? null;
  const banner =
    (stormStatus?.geomagnetic_level && stormStatus.geomagnetic_level !== "none"
      ? stormStatus.banner
      : null) ?? geo.headline;

  const statusTone = geomagneticStorm
    ? "storm-summary--alert"
    : possibleStorm
      ? "storm-summary--warn"
      : "storm-summary--ok";

  const defaultBanner = geomagneticStorm
    ? "Geomagnetic storm thresholds exceeded (Kp ≥ 5 or Dst ≤ −50 nT)."
    : possibleStorm
      ? "Possible geomagnetic storm — Kp ≥ 4 or Dst ≤ −30 nT."
      : "Quiet — Kp and Dst are below storm watch thresholds.";

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
          <span className="storm-summary-label">Storm level</span>
          <strong>
            {geomagneticStorm ? "Storm" : possibleStorm ? "Watch" : "Quiet"}
          </strong>
          <span className="storm-summary-sub">
            {geo.reasons.length ? geo.reasons.join(" · ") : "Kp < 4 and Dst > −30 nT"}
          </span>
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
