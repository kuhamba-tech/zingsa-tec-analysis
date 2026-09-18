"use client";

import Link from "next/link";

export default function GicGuidePanel() {
  return (
    <section className="card anomaly-guide-panel">
      <div className="anomaly-guide-header">
        <div>
          <div className="metric-label">About this page</div>
          <h2 className="anomaly-guide-title">What the GIC Monitor is for</h2>
        </div>
      </div>

      <p className="body-copy">
        During geomagnetic storms, rapid changes in Earth&apos;s magnetic field can drive{" "}
        <strong>Geomagnetically Induced Currents (GIC)</strong> in long conductors — especially
        high-voltage transmission lines and transformer neutrals. This monitor tracks those currents
        on the <strong>ZETDC national grid</strong> as part of the ZINGSA × ZETDC research programme,
        and shows <strong>ZPC power stations</strong> (Kariba South, Hwange, Munyati, Bulawayo, Harare)
        for generation context.
      </p>

      <div className="anomaly-guide-grid">
        <div className="anomaly-guide-item">
          <span className="anomaly-guide-icon">⚡</span>
          <div>
            <strong>Why GIC matters</strong>
            <p>
              Large GIC can saturate transformer cores, draw extra reactive power, generate harmonics,
              and increase heating — risking trips, damage, and grid instability during space-weather events.
            </p>
          </div>
        </div>
        <div className="anomaly-guide-item">
          <span className="anomaly-guide-icon">🧲</span>
          <div>
            <strong>What we measure</strong>
            <p>
              Clamp sensors on transformer neutrals at Dema and Alaska substations record current in amperes (A).
              Data flows via Campbell CR1000 loggers to the platform for live charts and archival reports.
            </p>
          </div>
        </div>
        <div className="anomaly-guide-item">
          <span className="anomaly-guide-icon">🗺️</span>
          <div>
            <strong>Network map</strong>
            <p>
              HV substations and transmission lines across Zimbabwe, plus ZPC generation plants linked to the grid.
              Green markers = live GIC data; blue = sensor installed but awaiting data.
            </p>
          </div>
        </div>
        <div className="anomaly-guide-item">
          <span className="anomaly-guide-icon">📈</span>
          <div>
            <strong>Forecast &amp; alerts</strong>
            <p>
              Observed GIC is compared with an Extended Kalman Filter (EKF) prediction. Large deviations trigger
              alerts cross-checked against Kp, Dst, and solar-wind indices from the space-weather feed.
            </p>
          </div>
        </div>
      </div>

      <div className="anomaly-legend-box">
        <div className="metric-label">GIC risk levels (EPRI / operational guide)</div>
        <ul className="anomaly-legend-list">
          <li><span className="anomaly-swatch" style={{ background: "#00ff88" }} /> <strong>Quiet (&lt; 5 A)</strong> — background; no transformer impact expected</li>
          <li><span className="anomaly-swatch" style={{ background: "#a3e635" }} /> <strong>Elevated (5–10 A)</strong> — watch Kp/Dst and space-weather conditions</li>
          <li><span className="anomaly-swatch" style={{ background: "#ff8c00" }} /> <strong>Large (10–25 A)</strong> — log event; EPRI SUNBURST large-GIC criterion</li>
          <li><span className="anomaly-swatch" style={{ background: "#ff4444" }} /> <strong>High (25–35 A)</strong> — harmonic generation and asymmetric saturation possible</li>
          <li><span className="anomaly-swatch" style={{ background: "#d946ef" }} /> <strong>Severe (&gt; 35 A)</strong> — core saturation risk; increased reactive draw and heating</li>
        </ul>
      </div>

      <p className="small-note" style={{ marginTop: "0.75rem" }}>
        Related tools:{" "}
        <Link href="/space-weather" className="link-inline">Live Space Weather</Link>
        {" · "}
        <Link href="/dashboard" className="link-inline">National Dashboard</Link>
        {" · "}
        <Link href="/anomaly-detection" className="link-inline">TEC Anomalies</Link>
        {" · "}
        <Link href="https://www.zesaholdings.co.zw/ZPC" className="link-inline" target="_blank" rel="noopener noreferrer">
          ZESA ZPC generation fleet
        </Link>
      </p>
    </section>
  );
}
