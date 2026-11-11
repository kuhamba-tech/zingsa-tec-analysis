"use client";

import EarthsideSolarNews from "@/components/spaceWeather/EarthsideSolarNews";

export default function SolarActivityCapturePage() {
  return (
    <div style={{ background: "#07111c", minHeight: "100vh", padding: "0.5rem" }}>
      <EarthsideSolarNews solar={null} kp={null} diskOnly />
    </div>
  );
}
