"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getEkfStatus,
  getLivePipelineStatus,
  getSpaceWeather,
  getStations,
  getTecHeatmap,
} from "@/lib/api";
import { peekSpaceWeather, subscribeSpaceWeather } from "@/lib/spaceWeatherStore";
import { peekStations, subscribeStations, stationsAreSpiderAuthoritative } from "@/lib/stationsStore";
import { mergeSpaceWeatherWithEkf } from "@/lib/homeSpaceWeather";
import { buildMetricCards } from "@/lib/spaceWeatherMetrics";
import {
  countLiveStationStatuses,
  formatCorsConnectedShort,
  mergeStationsPreferLive,
} from "@/lib/liveStationStatus";
import { mergeTecHeatmapWithStations } from "@/lib/tecHeatmapMerge";
import AiRecommendationPanel from "@/components/layout/AiRecommendationPanel";
import HomeStormAlertBanner from "@/components/layout/HomeStormAlertBanner";
import { useFeedFreshness, type FeedStatus } from "@/lib/feedStatus";
import type {
  Station,
  SpaceWeatherCurrent,
  TecHeatmapResponse,
} from "@/lib/types";
import type { MetricKey } from "@/lib/spaceWeatherMetrics";
import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { DashboardHeaderClocks } from "@/components/dashboard/DashboardClocks";
import { PRODUCT_SHORT_NAME, PRODUCT_TAGLINE } from "@/lib/navigationNewsBranding";

const CorsMapWithLayers = dynamic(() => import("@/components/maps/CorsMapWithLayers"), {
  ssr: false,
  loading: () => (
    <div className="home-map-loading" role="status" aria-live="polite">
      <span className="home-map-loading-spinner" aria-hidden="true" />
      <span>Loading interactive CORS map…</span>
    </div>
  ),
});

const MODULES = [
  { href: "/processing",       icon: "⚙️",  title: "Processing",        desc: "Upload RINEX/CMN, download CORS RINEX for post-processing, or convert files" },
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
    desc: "See which of the 25 Zimbabwe CORS stations are streaming RTCM on NTRIP.",
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

const HOME_METRIC_KEYS: MetricKey[] = ["kp", "geomagnetic", "dst", "gnss_risk", "stations"];

const HOME_LABELS: Partial<Record<MetricKey, string>> = {
  geomagnetic: "Geomagnetic condition",
  stations: "CORS Connected",
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
  const [liveSw, setLiveSw] = useState<SpaceWeatherCurrent | null>(null);
  const [displaySw, setDisplaySw] = useState<SpaceWeatherCurrent | null>(null);
  const [ekfFilled, setEkfFilled] = useState<Set<string>>(new Set());
  const [swStatus, setSwStatus] = useState<FeedStatus>("pending");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [ntripProbedAt, setNtripProbedAt] = useState<string | null>(null);
  const [pipelineNote, setPipelineNote] = useState<string | null>(null);
  const [tecHeatmap, setTecHeatmap] = useState<TecHeatmapResponse | null>(null);
  const [stationsLoading, setStationsLoading] = useState(true);
  const [ntripRefreshing, setNtripRefreshing] = useState(false);
  const [gettingStartedOpen, setGettingStartedOpen] = useState(true);

  useEffect(() => {
    try {
      const seen = window.localStorage.getItem("zgiis:getting-started-seen");
      if (seen === "1") setGettingStartedOpen(false);
      else window.localStorage.setItem("zgiis:getting-started-seen", "1");
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    const cachedSw = peekSpaceWeather();
    if (cachedSw) {
      setLiveSw(cachedSw);
      setDisplaySw(cachedSw);
      setSwStatus("stale");
    }
    // Do not paint station greens/reds from a previous session — wait for Spider.
  }, []);

  useEffect(() => subscribeSpaceWeather((next) => {
    setLiveSw(next);
    setDisplaySw((prev) => (prev ? { ...prev, ...next } : next));
    setSwStatus("ok");
    setLoadError(null);
  }), []);

  useEffect(() => subscribeStations((next) => {
    setStations((prev) => mergeStationsPreferLive(prev, next, { nextIsLiveProbe: false }));
    setStationsLoading(false);
  }), []);

  useEffect(() => {
    let cancelled = false;

    function applyStations(next: Station[]) {
      if (next.length === 0) return;
      setStations((prev) => mergeStationsPreferLive(prev, next, { nextIsLiveProbe: false }));
      const probed = next.find((s) => s.ntrip_probed_at)?.ntrip_probed_at ?? null;
      if (probed) setNtripProbedAt(probed);
    }

    async function load(background = false) {
      const cached = peekSpaceWeather();

      if (!background) {
        if (cached) {
          setDisplaySw(cached);
          setLiveSw(cached);
          setSwStatus("stale");
        } else {
          setSwStatus("pending");
          setLoadError(null);
        }
        setStationsLoading(peekStations().length === 0);
        setNtripRefreshing(!cached && peekStations().length === 0);
      }

      // Paint space-weather metrics as soon as they arrive — do not wait on Spider/stations.
      const swPromise = getSpaceWeather()
        .then((value) => {
          if (cancelled) return value;
          setLiveSw(value);
          setDisplaySw(value);
          setSwStatus("ok");
          setLoadError(null);
          return value;
        })
        .catch(() => {
          if (cancelled) return cached;
          if (cached) {
            setSwStatus("stale");
            return cached;
          }
          if (!background) {
            setSwStatus("down");
            setLoadError(
              "Live API is not connected. Start the FastAPI backend on port 8000, then refresh.",
            );
          } else {
            setSwStatus("stale");
          }
          return null;
        });

      const stationsPromise = getStations(false)
        .then((rows) => {
          if (cancelled) return rows;
          if (rows.length > 0) applyStations(rows);
          return rows;
        })
        .catch(() => [] as Station[])
        .finally(() => {
          if (!cancelled) {
            setStationsLoading(false);
            setNtripRefreshing(false);
          }
        });

      // Secondary widgets after SW resolves (stations may still be in flight).
      void swPromise.then((sw) => {
        if (cancelled) return;
        void Promise.allSettled([getEkfStatus(), getLivePipelineStatus()]).then(
          ([ekfResult, pipelineResult]) => {
            if (cancelled) return;
            const ekfData = ekfResult.status === "fulfilled" ? ekfResult.value : null;
            const merged = mergeSpaceWeatherWithEkf(sw, ekfData);
            if (merged) {
              setDisplaySw(merged.data);
              setEkfFilled(merged.ekfFilled);
            }
            if (pipelineResult.status === "fulfilled") {
              setPipelineNote(pipelineResult.value.message ?? null);
            }
          },
        );
        void getTecHeatmap(0.05, !background)
          .then((heatmap) => {
            if (!cancelled && heatmap) setTecHeatmap(heatmap);
          })
          .catch(() => null);
      });

      await Promise.allSettled([swPromise, stationsPromise]);
    }

    load(false);
    const timer = window.setInterval(() => load(true), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const freshnessMsg = useFeedFreshness("space-weather", swStatus);
  const loading = swStatus === "pending" && !displaySw;
  const gnssRisk = displaySw?.gnss_risk ?? (loading ? "…" : "N/A");

  const liveCounts = countLiveStationStatuses(stations);
  const spiderLive = stationsAreSpiderAuthoritative(stations);
  const displayHeatmap = useMemo(
    () => mergeTecHeatmapWithStations(tecHeatmap, stations),
    [tecHeatmap, stations],
  );

  const homeCards = buildMetricCards(displaySw, {
    // Catalog-only snapshots (cold Vercel) must not override Spider/SW counts.
    liveStationCounts: spiderLive ? liveCounts : undefined,
    ekfFilled,
  })
    .filter((card) => HOME_METRIC_KEYS.includes(card.key))
    .map((card) => ({
      ...card,
      label: HOME_LABELS[card.key] ?? card.label,
      value: card.key === "kp" && displaySw?.kp != null ? displaySw.kp.toFixed(1) : card.value,
      note:
        card.key === "stations" && spiderLive && liveCounts.total > 0
          ? formatCorsConnectedShort(liveCounts)
          : card.note,
    }));

  return (
    <div className="home-page">
      <div className="home-hero-header">
        <div className="home-top-intro">
          <h1 className="page-title home-page-title">
            <span className="home-page-title-icon home-page-title-logo" aria-hidden>
              <Image
                src="/zingsa_logo.webp"
                alt=""
                width={80}
                height={80}
                className="home-hero-logo"
                priority
              />
            </span>
            <span className="home-page-title-text">
              <span className="home-page-title-line">Zimbabwe Space Weather &amp; Navigation</span>
            </span>
          </h1>
          <p className="page-subtitle home-page-subtitle">
            Real-time ionospheric TEC, space weather, and GNSS navigation from the Zimbabwe CORS network
          </p>
        </div>
        <div className="home-hero-clocks page-header-clocks" aria-label="Live clocks">
          <DashboardHeaderClocks />
        </div>
      </div>

      <HomeStormAlertBanner sw={liveSw} />

      <div className="home-sw-row">
        <section className="home-sw-panel" aria-label="Live space weather">
          <h2 className="home-sw-heading">Live Space Weather · Zimbabwe CORS Network</h2>
          {freshnessMsg && <div className="banner banner-warn" style={{ fontSize: "0.8rem" }}>{freshnessMsg}</div>}
          {loadError && swStatus === "down" && (
            <div className="banner banner-warn" style={{ fontSize: "0.8rem" }}>
              {loadError}
            </div>
          )}
          {pipelineNote && !pipelineNote.includes("started") && (
            <div className="banner banner-info" style={{ fontSize: "0.78rem" }}>
              {pipelineNote}
            </div>
          )}
          {ntripRefreshing && stations.length === 0 && (
            <div className="banner banner-info" style={{ fontSize: "0.78rem" }}>
              Checking live CORS streams…
            </div>
          )}
          {ntripProbedAt && !stationsLoading && (
            <div className="banner banner-info" style={{ fontSize: "0.72rem" }} aria-live="polite">
              Live NTRIP probe at {ntripProbedAt.replace("T", " ").replace("Z", " UTC")} — Online {liveCounts.online},
              Offline {liveCounts.offline}, Unavailable {liveCounts.unavailable}.
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
      </div>

      <AiRecommendationPanel
        sw={displaySw}
        stations={stations}
        indicesLoading={swStatus === "pending"}
      />

      <div id="cors-network" className="home-cors-map-section">
        <CorsMapWithLayers
          stations={stations}
          height={480}
          riskLevel={gnssRisk}
          liveCounts={liveCounts}
          ntripProbedAt={ntripProbedAt}
          stationsLoading={stationsLoading}
          heatmap={displayHeatmap}
        />
      </div>

      <section className="home-getting-started" aria-label="Getting started">
        <div className="home-getting-started-panel">
          <div className="home-getting-started-head">
            <div className="home-getting-started-copy">
              <h2 className="home-section-heading">Getting Started</h2>
              <p className="home-getting-started-sub">
                New here? Follow this workflow from live station health through processing to analysis.
              </p>
            </div>
            <button
              type="button"
              className="home-getting-started-toggle"
              aria-expanded={gettingStartedOpen}
              onClick={() => {
                setGettingStartedOpen((open) => {
                  const next = !open;
                  try {
                    window.localStorage.setItem("zgiis:getting-started-seen", next ? "0" : "1");
                  } catch {
                    /* ignore */
                  }
                  return next;
                });
              }}
            >
              {gettingStartedOpen ? "Hide" : "Show"}
            </button>
          </div>
          {gettingStartedOpen && (
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
          )}
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
