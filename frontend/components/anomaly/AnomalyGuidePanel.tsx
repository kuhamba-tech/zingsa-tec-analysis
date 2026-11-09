"use client";

import Link from "next/link";

export default function AnomalyGuidePanel() {
  return (
    <section className="card anomaly-guide-panel">
      <div className="anomaly-guide-header">
        <div>
          <div className="metric-label">About this page</div>
          <h2 className="anomaly-guide-title">What TEC Anomaly Detection is for</h2>
        </div>
      </div>

      <p className="body-copy">
        This workspace finds unusual ionospheric behaviour in Zimbabwe CORS TEC. It compares observed
        VTEC with a quiet-time reference (ΔTEC), flags both enhancements and depletions, then places
        the day beside geomagnetic indices for scientific assessment — not automatic causation.
      </p>

      <div className="anomaly-guide-grid">
        <div className="anomaly-guide-item">
          <span className="anomaly-guide-icon">📊</span>
          <div>
            <strong>Anomaly Detection</strong>
            <p>
              Flags positive and negative ΔTEC against a quiet-day baseline, with percentile
              thresholds retained as a secondary screen.
            </p>
          </div>
        </div>
        <div className="anomaly-guide-item">
          <span className="anomaly-guide-icon">⛈️</span>
          <div>
            <strong>Storm Comparison</strong>
            <p>
              Compares quiet days (Kp &lt; 3) with disturbed days (Kp ≥ 5) to show climatological TEC
              differences — coincidence, not proof of cause.
            </p>
          </div>
        </div>
        <div className="anomaly-guide-item">
          <span className="anomaly-guide-icon">🕐</span>
          <div>
            <strong>Diurnal &amp; Seasonal</strong>
            <p>
              Shows normal daily and seasonal TEC cycles so anomalies can be judged against expected
              Zimbabwe patterns (UTC + 2 h local).
            </p>
          </div>
        </div>
        <div className="anomaly-guide-item">
          <span className="anomaly-guide-icon">☀️</span>
          <div>
            <strong>Solar Cycle &amp; EIA</strong>
            <p>
              Places anomalies in Solar Cycle context and under low-latitude Equatorial Ionospheric
              Anomaly dynamics.
            </p>
          </div>
        </div>
      </div>

      <div className="anomaly-legend-box">
        <div className="metric-label">How to read the main chart</div>
        <ul className="anomaly-legend-list">
          <li>
            <span className="anomaly-swatch" style={{ background: "#168bd2" }} />{" "}
            <strong>Blue line</strong> — daily mean VTEC from the verified archive
          </li>
          <li>
            <span className="anomaly-swatch" style={{ background: "#ff4444" }} />{" "}
            <strong>Red markers</strong> — positive TEC anomalies (enhancements)
          </li>
          <li>
            <span className="anomaly-swatch" style={{ background: "#a855f7" }} />{" "}
            <strong>Purple markers</strong> — negative TEC anomalies (depletions)
          </li>
          <li>
            <span className="anomaly-swatch" style={{ background: "#ff8c00" }} />{" "}
            <strong>Orange markers</strong> — anomaly with same-day Kp ≥ 5 coincidence
          </li>
          <li>
            <span className="anomaly-swatch anomaly-swatch-line" /> <strong>Dashed line</strong> —
            high-percentile threshold
          </li>
        </ul>
      </div>

      <p className="small-note" style={{ marginTop: "0.75rem" }}>
        Related tools:{" "}
        <Link href="/tec-heatmap/" className="link-inline">
          TEC Heatmap
        </Link>
        {" · "}
        <Link href="/time-series/" className="link-inline">
          Time Series
        </Link>
        {" · "}
        <Link href="/prn-explorer/" className="link-inline">
          PRN Explorer
        </Link>
        {" · "}
        <Link href="/space-weather/" className="link-inline">
          Live Space Weather
        </Link>
      </p>
    </section>
  );
}
