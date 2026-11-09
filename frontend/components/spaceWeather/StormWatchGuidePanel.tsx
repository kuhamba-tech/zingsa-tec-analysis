"use client";

import Link from "next/link";
import { GEOMAGNETIC_ALERT_RULES } from "@/lib/geomagneticStormAlerts";

export default function StormWatchGuidePanel() {
  return (
    <section className="card anomaly-guide-panel">
      <div className="anomaly-guide-header">
        <div>
          <div className="metric-label">About this page</div>
          <h2 className="anomaly-guide-title">What the Alerts Centre covers</h2>
        </div>
      </div>

      <p className="body-copy">
        This is ZINGSA&apos;s <strong>operational space-weather alerts centre</strong>. It applies national
        operating thresholds to live indices — primarily <strong>Kp</strong>, <strong>Dst</strong>, solar-wind
        drivers, and Zimbabwe CORS TEC / S4 — and raises watches when those limits are crossed. Filter
        residuals are logged when live readings diverge from the Extended Kalman Filter forecast, giving
        operators an early signal of ionospheric disturbance.
      </p>

      <div className="anomaly-guide-grid">
        <div className="anomaly-guide-item">
          <span className="anomaly-guide-icon">🔔</span>
          <div>
            <strong>Live storm status</strong>
            <p>
              Current Kp and Dst with a clear Quiet / Watch / Storm label. Banners and dashboard alarms follow
              these <em>observed</em> indices — not model residuals.
            </p>
          </div>
        </div>
        <div className="anomaly-guide-item">
          <span className="anomaly-guide-icon">📡</span>
          <div>
            <strong>Filter residual log</strong>
            <p>
              When TEC, Kp, or other live values diverge sharply from the Extended Kalman Filter forecast, an
              entry is logged here for operator review — an early tell for ionospheric disturbance.
            </p>
          </div>
        </div>
        <div className="anomaly-guide-item">
          <span className="anomaly-guide-icon">⚡</span>
          <div>
            <strong>Why it matters for Zimbabwe</strong>
            <p>
              Geomagnetic storms can degrade GNSS positioning, disrupt HF communications, drive GIC in the
              power grid, and lift TEC/scintillation over the CORS network.
            </p>
          </div>
        </div>
        <div className="anomaly-guide-item">
          <span className="anomaly-guide-icon">📋</span>
          <div>
            <strong>Audit trail</strong>
            <p>
              Every alert is timestamped with observed vs forecast values, severity, and related indicators —
              supporting post-event analysis and reporting for ZETDC, aviation, and surveying users.
            </p>
          </div>
        </div>
      </div>

      <div className="anomaly-legend-box">
        <div className="metric-label">Alert rules (observed Kp / Dst only)</div>
        <ul className="anomaly-legend-list">
          {GEOMAGNETIC_ALERT_RULES.map((rule) => (
            <li key={rule}>
              <span className="anomaly-swatch" style={{ background: rule.includes("Kp ≥ 5") ? "#ff4444" : "#ff8c00" }} />
              {rule}
            </li>
          ))}
          <li>
            <span className="anomaly-swatch anomaly-swatch-line" />
            <strong>Quiet</strong> — Kp &lt; 4 and Dst &gt; −30 nT (no storm watch active)
          </li>
        </ul>
      </div>

      <div className="anomaly-legend-box" style={{ marginTop: "0.65rem" }}>
        <div className="metric-label">Who should watch this page</div>
        <ul className="anomaly-legend-list">
          <li><strong>Space weather operators</strong> — first response when Kp/Dst cross thresholds</li>
          <li><strong>GNSS / CORS teams</strong> — expect TEC spikes, scintillation, and RTK degradation</li>
          <li><strong>Power grid (ZETDC)</strong> — correlate with GIC Monitor during storm periods</li>
          <li><strong>Researchers</strong> — review residual log and cross-check TEC anomaly archive</li>
        </ul>
      </div>

      <p className="small-note" style={{ marginTop: "0.75rem" }}>
        Related tools:{" "}
        <Link href="/dashboard/" className="link-inline">National Dashboard</Link>
        {" · "}
        <Link href="/space-weather/" className="link-inline">Live Space Weather</Link>
        {" · "}
        <Link href="/gic-monitor/" className="link-inline">GIC Monitor</Link>
        {" · "}
        <Link href="/anomaly-detection/" className="link-inline">TEC Anomalies</Link>
      </p>
    </section>
  );
}
