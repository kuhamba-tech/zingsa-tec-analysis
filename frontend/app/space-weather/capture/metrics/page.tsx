"use client";

import HeliosphericMonitorStack from "@/components/spaceWeather/HeliosphericMonitorStack";

export default function LiveMetricsCapturePage() {
  return (
    <div style={{ background: "#07111c", minHeight: "100vh", padding: "0.5rem" }}>
      <HeliosphericMonitorStack only="kp" />
    </div>
  );
}
