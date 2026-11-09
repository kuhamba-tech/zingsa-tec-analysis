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
              The existing programme registry identifies GMW CPCO sensors, Campbell CR1000 loggers and Raspberry Pi gateways at Dema and Alaska. These descriptions are retained; actual commissioning and received current measurements require independent verification.
            </p>
          </div>
        </div>
        <div className="anomaly-guide-item">
          <span className="anomaly-guide-icon">🗺️</span>
          <div>
            <strong>Network map</strong>
            <p>
              HV substations and transmission lines across Zimbabwe, plus ZPC generation plants linked to the grid.
              Markers identify registered sites and stored observation history; they do not independently verify commissioning. Coordinates and line topology remain schematic pending an authoritative ZETDC register.
            </p>
          </div>
        </div>
        <div className="anomaly-guide-item">
          <span className="anomaly-guide-icon">📈</span>
          <div>
            <strong>Forecast &amp; alerts</strong>
            <p>
              The EKF is retained for research validation against measured GIC and simple baselines. Operational prediction overlays and residual warnings remain disabled pending independent evaluation and engineering approval.
            </p>
          </div>
        </div>
      </div>

      <div className="anomaly-legend-box">
        <div className="metric-label">Provisional monitoring categories / default 5, 10, 25 and 35 A</div>
        <p>These are descriptive screening categories, not universal transformer damage thresholds. Approved site-specific settings can replace the defaults. Interpret signed current together with duration, quality, transformer metadata and local engineering diagnostics. No universal reactive-power consumption per ampere is assumed.</p>

      </div>

      <p className="small-note" style={{ marginTop: "0.75rem" }}>
        Related tools:{" "}
        <Link href="/space-weather/" className="link-inline">Live Space Weather</Link>
        {" · "}
        <Link href="/dashboard/" className="link-inline">National Dashboard</Link>
        {" · "}
        <Link href="/anomaly-detection/" className="link-inline">TEC Anomalies</Link>
        {" · "}
        <Link href="https://www.zesaholdings.co.zw/ZPC" className="link-inline" target="_blank" rel="noopener noreferrer">
          ZESA ZPC generation fleet
        </Link>
      </p>
    </section>
  );
}
