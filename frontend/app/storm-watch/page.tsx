"use client";
import StormWatchLog from "@/components/spaceWeather/StormWatchLog";

export default function StormWatchPage() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>
      <div className="dashboard-header-copy">
        <h1 className="page-title">Storm Watch</h1>
        <p className="page-subtitle">
          A running log of moments when live readings broke away from forecast — an early tell for geomagnetic
          storms and ionospheric disturbance over Zimbabwe.
        </p>
      </div>
      <StormWatchLog />
    </div>
  );
}
