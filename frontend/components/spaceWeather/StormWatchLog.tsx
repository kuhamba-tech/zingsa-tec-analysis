"use client";
import { useCallback, useEffect, useState } from "react";
import { getEkfAlertLog, ackEkfAlert } from "@/lib/api";
import type { EkfAlert } from "@/lib/types";

const SEVERITY_COLOR: Record<string, string> = {
  Low: "#00ff88",
  Moderate: "#ffcc00",
  High: "#ff7a00",
  Severe: "#ff2e2e",
};

/** Self-contained feed of drift alerts: live readings vs. our predictive model, flagged when they part ways. */
export default function StormWatchLog() {
  const [alerts, setAlerts] = useState<EkfAlert[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const data = await getEkfAlertLog(168).catch(() => []);
    setAlerts(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    const id = window.setInterval(load, 120000);
    return () => window.clearInterval(id);
  }, [load]);

  if (loading) {
    return <p style={{ color: "var(--text-muted)", fontSize: "0.85rem" }}>Scanning recent conditions for disturbances...</p>;
  }
  if (alerts.length === 0) {
    return (
      <div className="card card-ok">
        <div className="operations-chart-title">Storm Watch Log (last 7 days)</div>
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>
          All clear. No readings have broken away from forecast over the last 7 days.
        </p>
      </div>
    );
  }

  return (
    <div className="card card-accent">
      <div className="operations-chart-title">Storm Watch Log (last 7 days)</div>
      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.75rem" }}>
        Every live reading is checked against where our forecast model expected it to land. When the gap blows past
        the dynamic threshold (mean + 3σ of recent drift) it&apos;s logged here as a possible early signature of
        geomagnetic or ionospheric disturbance. Severity escalates to Severe when two or more other indicators are
        acting up at the same time.
      </p>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Time (UTC)</th>
            <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Parameter</th>
            <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Observed</th>
            <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Forecast</th>
            <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Drift</th>
            <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>Threshold</th>
            <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Severity</th>
            <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}></th>
          </tr>
        </thead>
        <tbody>
          {alerts.map((alert) => (
            <tr key={alert.alert_id} style={{ borderBottom: "1px solid rgba(36,77,115,0.35)" }}>
              <td style={{ padding: "0.35rem 0.5rem", whiteSpace: "nowrap" }}>{alert.timestamp.replace("T", " ").slice(0, 19)}</td>
              <td style={{ padding: "0.35rem 0.5rem" }}>{alert.parameter_label}</td>
              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{alert.observed_value?.toFixed(2) ?? "N/A"}</td>
              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{alert.ekf_predicted_value?.toFixed(2) ?? "N/A"}</td>
              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{alert.prediction_error?.toFixed(2) ?? "N/A"}</td>
              <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{alert.threshold?.toFixed(2) ?? "N/A"}</td>
              <td style={{ padding: "0.35rem 0.5rem", color: SEVERITY_COLOR[alert.severity] ?? "var(--text)", fontWeight: 600 }}>
                {alert.severity}
              </td>
              <td style={{ padding: "0.35rem 0.5rem" }}>
                {alert.acknowledged_status ? (
                  <span style={{ color: "var(--text-muted)" }}>Acknowledged</span>
                ) : (
                  <button
                    className="btn"
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                    onClick={async () => {
                      await ackEkfAlert(alert.alert_id);
                      setAlerts((prev) =>
                        prev.map((a) => (a.alert_id === alert.alert_id ? { ...a, acknowledged_status: true } : a))
                      );
                    }}
                  >
                    Acknowledge
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
