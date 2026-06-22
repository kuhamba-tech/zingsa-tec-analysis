"use client";

import { useEffect, useState } from "react";
import { getEkfStatus, getLivePipelineStatus, getSpaceWeather, getStations } from "@/lib/api";
import { mergeSpaceWeatherWithEkf } from "@/lib/homeSpaceWeather";
import { buildMetricCards } from "@/lib/spaceWeatherMetrics";
import { countLiveStationStatuses } from "@/lib/liveStationStatus";
import CorsMapWithLayers from "@/components/maps/CorsMapWithLayers";
import { useFeedFreshness, type FeedStatus } from "@/lib/feedStatus";
import type { Station, SpaceWeatherCurrent } from "@/lib/types";
import type { MetricKey } from "@/lib/spaceWeatherMetrics";
import Link from "next/link";
import Image from "next/image";

const MODULES = [
  { href: "/processing",        icon: "⚙️",  title: "Processing",        desc: "Upload and process RINEX/CMN files — includes RINEX converter" },
  { href: "/time-series",       icon: "📈",  title: "Time Series",       desc: "VTEC trends over time" },
  { href: "/prn-explorer",      icon: "🛰️",  title: "PRN Explorer",      desc: "Per-satellite TEC analysis" },
  { href: "/tec-heatmap",       icon: "🗺️",  title: "TEC Heatmap",       desc: "Interpolated VTEC grid over Zimbabwe" },
  { href: "/anomaly-detection", icon: "🔬",  title: "Anomaly Detection", desc: "Storm correlation and anomaly flagging" },
  { href: "/ai-assistant",      icon: "🤖",  title: "AI Assistant",      desc: "Ask questions about TEC and ionosphere" },
];

const GETTING_STARTED = [
  {
    step: 1,
    icon: "📡",
    title: "View live CORS status",
    desc: "See which of the 24 Zimbabwe CORS stations are streaming RTCM on NTRIP.",
    href: "/live-pipeline",
    cta: "Open Live Pipeline",
  },
  {
    step: 2,
    icon: "⚙️",
    title: "Upload RINEX or CMN",
    desc: "Run the VTEC pipeline on observation files, or reformat raw data with the RINEX converter.",
    href: "/processing",
    cta: "Go to Processing",
    altHref: "/processing#converter",
    altLabel: "RINEX converter",
  },
  {
    step: 3,
    icon: "📈",
    title: "Explore TEC trends",
    desc: "Review VTEC time series, regional heatmaps, and storm-correlated anomalies.",
    href: "/time-series",
    cta: "View Time Series",
  },
] as const;

const HOME_METRIC_KEYS: MetricKey[] = ["kp", "geomagnetic", "gnss_risk", "stations"];

const HOME_LABELS: Partial<Record<MetricKey, string>> = {
  geomagnetic: "Geomagnetic condition",
  stations: "Live Stream Status",
};

function HomeMetricCard({
  icon,
  label,
  value,
  note,
  valueColor,
  loading,
}: {
  icon: string;
  label: string;
  value: string;
  note: string;
  valueColor: string;
  loading?: boolean;
}) {
  return (
    <div className="sw-metric-card home-metric-card">
      <span className="sw-metric-icon">{icon}</span>
      <div className="sw-metric-label">{label}</div>
      <div className="sw-metric-value" style={{ color: loading ? "var(--text-muted)" : valueColor }}>
        {loading ? "…" : value}
      </div>
      <div className="sw-metric-note">{loading ? "Loading live feed…" : note}</div>
    </div>
  );
}

export default function HomePage() {
  const [stations, setStations] = useState<Station[]>([]);
  const [displaySw, setDisplaySw] = useState<SpaceWeatherCurrent | null>(null);
  const [ekfFilled, setEkfFilled] = useState<Set<string>>(new Set());
  const [swStatus, setSwStatus] = useState<FeedStatus>("pending");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ntripProbedAt, setNtripProbedAt] = useState<string | null>(null);
  const [pipelineNote, setPipelineNote] = useState<string | null>(null);
  const [stationsLoading, setStationsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setSwStatus("pending");
      setLoadError(null);

      const [swResult, ekfResult, pipelineResult] = await Promise.allSettled([
        getSpaceWeather(),
        getEkfStatus(),
        getLivePipelineStatus(),
      ]);

      if (cancelled) return;

      const sw = swResult.status === "fulfilled" ? swResult.value : null;
      const ekf = ekfResult.status === "fulfilled" ? ekfResult.value : null;
      const merged = mergeSpaceWeatherWithEkf(sw, ekf);

      if (merged) {
        setDisplaySw(merged.data);
        setEkfFilled(merged.ekfFilled);
        setSwStatus("ok");
      } else if (swResult.status === "fulfilled") {
        setDisplaySw(swResult.value);
        setEkfFilled(new Set());
        setSwStatus("ok");
      } else {
        setDisplaySw(null);
        setEkfFilled(new Set());
        setSwStatus("down");
        setLoadError(
          swResult.reason instanceof Error
            ? swResult.reason.message
            : "Could not reach the space-weather API.",
        );
      }

      if (pipelineResult.status === "fulfilled") {
        const p = pipelineResult.value;
        setPipelineNote(p.message ?? null);
      }

      setStationsLoading(true);
      try {
        const stationsResult = await getStations(true);
        if (cancelled) return;

        setStations(stationsResult);
        const liveCounts = countLiveStationStatuses(stationsResult);
        const probed = stationsResult.find((s) => s.ntrip_probed_at)?.ntrip_probed_at;
        if (probed) setNtripProbedAt(probed);
        setDisplaySw((prev) =>
          prev && stationsResult.some((s) => s.ntrip_verdict || s.status_source === "ntrip")
            ? { ...prev, stations_online: liveCounts.online, stations_total: liveCounts.total }
            : prev,
        );
      } catch {
        if (!cancelled) setStations([]);
      } finally {
        if (!cancelled) setStationsLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, []);

  const freshnessMsg = useFeedFreshness("space-weather", swStatus);
  const loading = swStatus === "pending";
  const gnssRisk = displaySw?.gnss_risk ?? (loading ? "…" : "N/A");

  const liveCounts = countLiveStationStatuses(stations);

  const homeCards = buildMetricCards(displaySw, {
    liveStationCounts: liveCounts,
    ekfFilled,
  })
    .filter((card) => HOME_METRIC_KEYS.includes(card.key))
    .map((card) => ({
      ...card,
      label: HOME_LABELS[card.key] ?? card.label,
      value: card.key === "kp" && displaySw?.kp != null ? displaySw.kp.toFixed(1) : card.value,
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
          {freshnessMsg && <div className="banner banner-warn" style={{ fontSize: "0.8rem" }}>{freshnessMsg}</div>}
          {loadError && swStatus === "down" && (
            <div className="banner banner-alert" style={{ fontSize: "0.8rem" }}>
              {loadError} — retry by refreshing the page.
            </div>
          )}
          {pipelineNote && !pipelineNote.includes("started") && (
            <div className="banner banner-info" style={{ fontSize: "0.78rem" }}>
              {pipelineNote}
            </div>
          )}
          {stationsLoading && (
            <div className="banner banner-info" style={{ fontSize: "0.78rem" }}>
              Probing NTRIP caster for live RTCM/MSM on all 24 mountpoints…
            </div>
          )}
          {ntripProbedAt && !stationsLoading && (
            <div className="banner banner-info" style={{ fontSize: "0.72rem" }}>
              Live NTRIP probe at {ntripProbedAt.replace("T", " ").replace("Z", " UTC")} — Online {liveCounts.online},
              Degraded {liveCounts.degraded}, Offline {liveCounts.offline}, Unavailable {liveCounts.unavailable}.
            </div>
          )}
          <div className="dashboard-metric-grid home-metric-grid">
            {homeCards.map((card) => (
              <HomeMetricCard
                key={card.key}
                icon={card.icon}
                label={card.label}
                value={card.value}
                note={card.note}
                valueColor={card.valueColor}
                loading={card.key === "stations" ? stationsLoading : loading && card.value === "N/A"}
              />
            ))}
          </div>
        </section>

        <div className="home-hero-logo-wrap">
          <Image
            src="/zingsa_logo.webp"
            alt="ZINGSA — Zimbabwe National Geospatial and Space Agency"
            width={168}
            height={168}
            className="home-hero-logo"
            priority
          />
        </div>
      </div>

      <CorsMapWithLayers
        stations={stations}
        height={480}
        riskLevel={gnssRisk}
        liveCounts={liveCounts}
        ntripProbedAt={ntripProbedAt}
        stationsLoading={stationsLoading}
      />

      <section className="home-getting-started" aria-label="Getting started">
        <div className="home-getting-started-panel">
          <div className="home-getting-started-head">
            <h2 className="home-section-heading">Getting Started</h2>
            <p className="home-getting-started-sub">
              New to GNSS-TEC? Follow this workflow from live station health through processing to analysis.
            </p>
          </div>
          <ol className="home-steps-strip">
            {GETTING_STARTED.map((item, index) => (
              <li key={item.step} className="home-step-item">
                {index > 0 && (
                  <span className="home-step-connector" aria-hidden="true">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                      <path d="M8 5l8 7-8 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                )}
                <article className="home-step-card">
                  <div className="home-step-card-top">
                    <span className="home-step-badge">Step {item.step}</span>
                    <span className="home-step-icon" aria-hidden="true">{item.icon}</span>
                  </div>
                  <h3 className="home-step-title">{item.title}</h3>
                  <p className="home-step-desc">{item.desc}</p>
                  <div className="home-step-actions">
                    <Link href={item.href} className="home-step-cta">
                      {item.cta}
                      <span aria-hidden="true"> →</span>
                    </Link>
                    {"altHref" in item && item.altHref && (
                      <Link href={item.altHref} className="home-step-alt">
                        {item.altLabel}
                      </Link>
                    )}
                  </div>
                </article>
              </li>
            ))}
          </ol>
        </div>
      </section>

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
