"use client";

import { useEffect, useState } from "react";
import { getStations, getSpaceWeather } from "@/lib/api";
import { buildMetricCards } from "@/lib/spaceWeatherMetrics";
import CorsMapWithLayers from "@/components/maps/CorsMapWithLayers";
import type { Station, SpaceWeatherCurrent } from "@/lib/types";
import type { MetricKey } from "@/lib/spaceWeatherMetrics";
import Link from "next/link";
import Image from "next/image";

const MODULES = [
  { href: "/processing",        icon: "⚙️",  title: "Processing",        desc: "Upload and process RINEX/CMN files" },
  { href: "/time-series",       icon: "📈",  title: "Time Series",       desc: "VTEC trends over time" },
  { href: "/prn-explorer",      icon: "🛰️",  title: "PRN Explorer",      desc: "Per-satellite TEC analysis" },
  { href: "/tec-heatmap",       icon: "🗺️",  title: "TEC Heatmap",       desc: "Interpolated VTEC grid over Zimbabwe" },
  { href: "/anomaly-detection", icon: "🔬",  title: "Anomaly Detection", desc: "Storm correlation and anomaly flagging" },
  { href: "/ai-assistant",      icon: "🤖",  title: "AI Assistant",      desc: "Ask questions about TEC and ionosphere" },
];

const HOME_METRIC_KEYS: MetricKey[] = ["kp", "geomagnetic", "gnss_risk", "stations"];

const HOME_LABELS: Partial<Record<MetricKey, string>> = {
  geomagnetic: "Geomagnetic condition",
};

function HomeMetricCard({
  icon,
  label,
  value,
  note,
  valueColor,
}: {
  icon: string;
  label: string;
  value: string;
  note: string;
  valueColor: string;
}) {
  return (
    <div className="sw-metric-card home-metric-card">
      <span className="sw-metric-icon">{icon}</span>
      <div className="sw-metric-label">{label}</div>
      <div className="sw-metric-value" style={{ color: valueColor }}>
        {value}
      </div>
      <div className="sw-metric-note">{note}</div>
    </div>
  );
}

export default function HomePage() {
  const [stations, setStations] = useState<Station[]>([]);
  const [sw, setSw] = useState<SpaceWeatherCurrent | null>(null);

  useEffect(() => {
    getStations().then(setStations).catch(() => setStations([]));
    getSpaceWeather().then(setSw).catch(() => setSw(null));
  }, []);

  const gnssRisk = sw?.gnss_risk ?? "N/A";
  const homeCards = buildMetricCards(sw)
    .filter((card) => HOME_METRIC_KEYS.includes(card.key))
    .map((card) => ({
      ...card,
      label: HOME_LABELS[card.key] ?? card.label,
      value: card.key === "kp" && sw?.kp != null ? sw.kp.toFixed(1) : card.value,
    }));

  return (
    <div className="home-page">
      <div className="home-top-intro">
        <h1 className="page-title home-page-title">
          🛰️ GNSS Based TEC Analysis Using Zimbabwe CORS Network
        </h1>
        <p className="page-subtitle">
          Dual-frequency GPS/GNSS Total Electron Content (TEC) computation from Zimbabwe CORS RINEX observations
        </p>
      </div>

      <div className="home-sw-row">
        <section className="home-sw-panel" aria-label="Live space weather">
          <h2 className="home-sw-heading">Live Space Weather · Zimbabwe CORS Network</h2>
          <div className="dashboard-metric-grid home-metric-grid">
            {homeCards.map((card) => (
              <HomeMetricCard
                key={card.key}
                icon={card.icon}
                label={card.label}
                value={card.value}
                note={card.note}
                valueColor={card.valueColor}
              />
            ))}
          </div>
        </section>

        <div className="home-hero-logo-wrap">
          <Image
            src="/zingsa_logo.webp"
            alt="ZINGSA — Zimbabwe National Geospatial and Space Agency"
            width={64}
            height={64}
            className="home-hero-logo"
            priority
          />
        </div>
      </div>

      <CorsMapWithLayers stations={stations} height={480} riskLevel={gnssRisk} />

      <section className="home-modules">
        <h2 className="home-section-heading">Analysis Modules</h2>
        <div className="analysis-modules-grid">
          {MODULES.map(({ href, icon, title, desc }) => (
            <Link key={href} href={href} className="home-module-link">
              <div className="card card-accent home-module-card">
                <div className="home-module-icon">{icon}</div>
                <div className="home-module-title">{title}</div>
                <div className="home-module-desc">{desc}</div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
