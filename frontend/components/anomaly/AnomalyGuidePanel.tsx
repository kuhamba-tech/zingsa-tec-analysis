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
        This workspace finds <strong>unusual ionospheric days</strong> in the Zimbabwe CORS TEC archive.
        It compares daily mean Vertical TEC (VTEC) against a statistical threshold, then cross-checks
        geomagnetic indices (Kp, Dst) to separate <em>space-weather storms</em> from local or seasonal effects.
      </p>

      <div className="anomaly-guide-grid">
        <div className="anomaly-guide-item">
          <span className="anomaly-guide-icon">📊</span>
          <div>
            <strong>Anomaly Detection</strong>
            <p>Flags days when VTEC exceeds the chosen percentile (default 95th). Red markers on the chart are days worth investigating.</p>
          </div>
        </div>
        <div className="anomaly-guide-item">
          <span className="anomaly-guide-icon">⛈️</span>
          <div>
            <strong>Storm Comparison</strong>
            <p>Compares quiet days (Kp &lt; 3) vs storm days (Kp ≥ 5) to show how geomagnetic activity lifts TEC over the year.</p>
          </div>
        </div>
        <div className="anomaly-guide-item">
          <span className="anomaly-guide-icon">🕐</span>
          <div>
            <strong>Diurnal &amp; Seasonal</strong>
            <p>Reveals normal daily and seasonal TEC cycles so anomalies can be judged against expected Zimbabwe patterns (UTC + 2h local).</p>
          </div>
        </div>
        <div className="anomaly-guide-item">
          <span className="anomaly-guide-icon">☀️</span>
          <div>
            <strong>Solar Cycle &amp; EIA</strong>
            <p>Places anomalies in Solar Cycle 25 context and under low-latitude Equatorial Ionospheric Anomaly dynamics.</p>
          </div>
        </div>
      </div>

      <div className="anomaly-legend-box">
        <div className="metric-label">How to read the main chart</div>
        <ul className="anomaly-legend-list">
          <li><span className="anomaly-swatch" style={{ background: "#168bd2" }} /> <strong>Blue line</strong> — daily mean VTEC from processed archive</li>
          <li><span className="anomaly-swatch" style={{ background: "#ff4444" }} /> <strong>Red dots</strong> — anomaly days (above percentile threshold)</li>
          <li><span className="anomaly-swatch" style={{ background: "#ff8c00" }} /> <strong>Orange dots</strong> — anomaly coinciding with Kp storm (G1+)</li>
          <li><span className="anomaly-swatch anomaly-swatch-line" /> <strong>Dashed line</strong> — threshold ({`e.g. 95th percentile`})</li>
        </ul>
      </div>

      <p className="small-note" style={{ marginTop: "0.75rem" }}>
        Related tools:{" "}
        <Link href="/tec-heatmap" className="link-inline">TEC Heatmap</Link>
        {" · "}
        <Link href="/time-series" className="link-inline">Time Series</Link>
        {" · "}
        <Link href="/prn-explorer" className="link-inline">PRN Explorer</Link>
        {" · "}
        <Link href="/space-weather" className="link-inline">Live Space Weather</Link>
      </p>
    </section>
  );
}
