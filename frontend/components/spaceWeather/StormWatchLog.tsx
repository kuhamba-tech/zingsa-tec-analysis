"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ackEkfAlert, getEkfAlertLog } from "@/lib/api";
import type { EkfAlert } from "@/lib/types";

const SEVERITY_COLOR: Record<string, string> = {
  Low: "#00ff88",
  Moderate: "#ffcc00",
  High: "#ff7a00",
  Severe: "#ff2e2e",
};

const COMPACT_LIMIT = 5;

export interface StormWatchLogProps {
  /** When set, skip internal fetch and use parent data. */
  alerts?: EkfAlert[];
  onAlertsChange?: (alerts: EkfAlert[]) => void;
  hours?: number;
  /** Dashboard preview: fewer rows + link to full page. */
  compact?: boolean;
  /** Hide the card title (when embedded under another heading). */
  hideTitle?: boolean;
}

/** Feed of EKF drift alerts: live readings vs forecast, flagged when they diverge. */
export default function StormWatchLog({
  alerts: externalAlerts,
  onAlertsChange,
  hours = 168,
  compact = false,
  hideTitle = false,
}: StormWatchLogProps) {
  const [internalAlerts, setInternalAlerts] = useState<EkfAlert[]>([]);
  const [loading, setLoading] = useState(externalAlerts === undefined);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const alerts = externalAlerts ?? internalAlerts;
  const setAlerts = onAlertsChange ?? setInternalAlerts;

  const load = useCallback(async () => {
    if (externalAlerts !== undefined) return;
    const data = await getEkfAlertLog(hours).catch(() => []);
    setInternalAlerts(data);
    setLoading(false);
  }, [externalAlerts, hours]);

  useEffect(() => {
    if (externalAlerts !== undefined) {
      setLoading(false);
      return;
    }
    load();
    const id = window.setInterval(load, 120000);
    return () => window.clearInterval(id);
  }, [load, externalAlerts]);

  const displayAlerts = useMemo(
    () => (compact ? alerts.slice(0, COMPACT_LIMIT) : alerts),
    [alerts, compact],
  );

  const title = compact ? "Recent Storm Watch alerts" : "Storm Watch Log (last 7 days)";

  if (loading) {
    return <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Scanning recent conditions for disturbances…</p>;
  }

  if (alerts.length === 0) {
    return (
      <div className="card card-ok">
        {!hideTitle && <div className="operations-chart-title">{title}</div>}
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
          All clear. No readings have broken away from forecast over the last {Math.round(hours / 24)} day{hours >= 48 ? "s" : ""}.
        </p>
      </div>
    );
  }

  return (
    <div className="card card-accent">
      {!hideTitle && <div className="operations-chart-title">{title}</div>}
      {!compact && (
        <p className="storm-log-intro">
          Every live reading is checked against where our forecast model expected it to land. When the gap blows past
          the dynamic threshold (mean + 3σ of recent drift) it&apos;s logged here as a possible early signature of
          geomagnetic or ionospheric disturbance. Severity escalates to Severe when two or more other indicators are
          acting up at the same time.
        </p>
      )}

      <div className="table-scroll compact storm-log-table-wrap">
        <table className="dark-table storm-log-table">
          <thead>
            <tr>
              <th>Time (UTC)</th>
              <th>Parameter</th>
              <th style={{ textAlign: "right" }}>Observed</th>
              <th style={{ textAlign: "right" }}>Forecast</th>
              <th style={{ textAlign: "right" }}>Drift</th>
              <th style={{ textAlign: "right" }}>Threshold</th>
              <th>Severity</th>
              <th>Related</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {displayAlerts.map((alert) => {
              const expanded = expandedId === alert.alert_id;
              const indicators = Array.isArray(alert.related_indicators) ? alert.related_indicators : [];
              const related = indicators.length ? indicators.join(", ") : "—";
              const timeLabel =
                typeof alert.timestamp === "string"
                  ? alert.timestamp.replace("T", " ").slice(0, 19)
                  : "—";
              return (
                <Fragment key={alert.alert_id}>
                  <tr>
                    <td className="storm-log-time">{timeLabel}</td>
                    <td>
                      <button
                        type="button"
                        className="storm-log-detail-toggle"
                        onClick={() => setExpandedId(expanded ? null : alert.alert_id)}
                        aria-expanded={expanded}
                        title="Show alert details"
                      >
                        {alert.parameter_label}
                      </button>
                    </td>
                    <td style={{ textAlign: "right" }}>{alert.observed_value?.toFixed(2) ?? "N/A"}</td>
                    <td style={{ textAlign: "right" }}>{alert.ekf_predicted_value?.toFixed(2) ?? "N/A"}</td>
                    <td style={{ textAlign: "right" }}>{alert.prediction_error?.toFixed(2) ?? "N/A"}</td>
                    <td style={{ textAlign: "right" }}>{alert.threshold?.toFixed(2) ?? "N/A"}</td>
                    <td style={{ color: SEVERITY_COLOR[alert.severity] ?? "var(--text)", fontWeight: 600 }}>
                      {alert.severity}
                    </td>
                    <td className="storm-log-related">{related}</td>
                    <td>
                      {alert.acknowledged_status ? (
                        <span style={{ color: "var(--text-muted)" }}>Acknowledged</span>
                      ) : (
                        <button
                          className="btn"
                          style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                          onClick={async () => {
                            await ackEkfAlert(alert.alert_id);
                            setAlerts(
                              alerts.map((a) =>
                                a.alert_id === alert.alert_id ? { ...a, acknowledged_status: true } : a,
                              ),
                            );
                          }}
                        >
                          Acknowledge
                        </button>
                      )}
                    </td>
                  </tr>
                  {expanded && (
                    <tr className="storm-log-detail-row">
                      <td colSpan={9}>
                        <p className="storm-log-detail-msg">{alert.alert_message ?? "No message recorded."}</p>
                        {indicators.length > 0 && (
                          <p className="storm-log-detail-related">
                            <strong>Cross-check indicators:</strong> {indicators.join(" · ")}
                          </p>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {compact && alerts.length > COMPACT_LIMIT && (
        <p className="storm-log-footer">
          Showing {COMPACT_LIMIT} of {alerts.length} alerts.{" "}
          <Link href="/storm-watch">View full Storm Watch log →</Link>
        </p>
      )}
    </div>
  );
}
