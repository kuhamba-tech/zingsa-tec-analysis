"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSpaceWeather, getStations } from "@/lib/api";
import { buildGnssForecastBundle } from "@/lib/gnssForecastEngine";
import {
  AI_LEARNS,
  CORS_INPUTS,
  PLATFORM_MODULES,
  SPACE_WEATHER_INPUTS,
  STATUS_COLORS,
  type GnssForecastCity,
} from "@/lib/gnssWeatherIntelligence";
import {
  DataFusionPipelineDiagram,
  NationalPlatformDiagram,
} from "@/components/gnssIntelligence/GnssArchitectureDiagrams";
import type { GnssForecastBundle } from "@/lib/gnssForecastEngine";
import type { SpaceWeatherCurrent, Station } from "@/lib/types";

function InputList({ title, subtitle, items, accent }: { title: string; subtitle: string; items: string[]; accent: string }) {
  return (
    <div className="card gnwi-input-card" style={{ borderTopColor: accent }}>
      <h3 className="gnwi-card-heading">{title}</h3>
      <p className="gnwi-card-sub">{subtitle}</p>
      <ul className="gnwi-check-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function ForecastCard({ city }: { city: GnssForecastCity }) {
  return (
    <article className="gnwi-forecast-card" style={{ borderColor: STATUS_COLORS[city.status] }}>
      <div className="gnwi-forecast-city">
        <span>{city.emoji}</span>
        <span>{city.city}</span>
      </div>
      <div className="gnwi-forecast-status" style={{ color: STATUS_COLORS[city.status] }}>
        {city.statusLabel}
      </div>
      <dl className="gnwi-forecast-fields">
        {city.fields.map(({ label, value }) => (
          <div key={label} className="gnwi-forecast-row">
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {city.cause && (
        <p className="gnwi-forecast-cause">
          <strong>Inputs:</strong> {city.cause}
        </p>
      )}
      {city.recommendation && (
        <p className="gnwi-forecast-rec">
          <strong>Recommendation:</strong> {city.recommendation}
        </p>
      )}
      {city.effects && city.effects.length > 0 && (
        <ul className="gnwi-effects-list">
          {city.effects.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

export default function GnssIntelligencePage() {
  const [bundle, setBundle] = useState<GnssForecastBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [swResult, stationsResult] = await Promise.allSettled([
          getSpaceWeather(),
          getStations(true),
        ]);
        if (cancelled) return;

        const sw: SpaceWeatherCurrent | null =
          swResult.status === "fulfilled" ? swResult.value : null;
        const stationsRaw =
          stationsResult.status === "fulfilled" ? stationsResult.value : [];
        const stations: Station[] = Array.isArray(stationsRaw) ? stationsRaw : [];

        if (!sw && stations.length === 0) {
          setError("Could not load space-weather or CORS station feeds.");
          setBundle(null);
          return;
        }

        setBundle(buildGnssForecastBundle(sw, stations));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load forecast inputs");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, 120_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  const forecasts = bundle?.forecasts ?? [];
  const updatedLabel = bundle?.computedAt
    ? bundle.computedAt.replace("T", " ").replace("Z", " UTC").slice(0, 19)
    : null;

  return (
    <div className="gnwi-page">
      <header className="gnwi-hero">
        <div className="gnwi-hero-kicker">Space Weather · National Positioning Intelligence</div>
        <h1 className="page-title">🛰️ GNSS Weather Intelligence Module</h1>
        <p className="page-subtitle">
          Fuse Zimbabwe CORS network observations with NOAA space-weather indices to forecast
          positioning reliability — RTK, drones, agriculture, transport, and surveying.
        </p>
      </header>

      <div className="banner banner-info gnwi-vision-note">
        <strong>Live-routed forecasts.</strong> City cards below are computed from{" "}
        <Link href="/space-weather">live space-weather indices</Link> (Kp, Dst, S4, GNSS risk) and{" "}
        <Link href="/live-pipeline">NTRIP-probed CORS stations</Link> (HARARE→HARA/ZINH, MUTARE→MUTA,
        VICTORIA FALLS→VICF). Refreshes every 2 minutes.
      </div>

      {error && <div className="banner banner-alert">{error}</div>}
      {bundle && (
        <div className="banner banner-info gnwi-live-sources" style={{ fontSize: "0.78rem" }}>
          <strong>Input routing:</strong> {bundle.inputSummary}
          {updatedLabel && <> · Computed {updatedLabel}</>}
        </div>
      )}

      <section className="gnwi-section">
        <h2 className="gnwi-section-title">Architecture</h2>
        <DataFusionPipelineDiagram />
      </section>

      <section className="gnwi-section">
        <h2 className="gnwi-section-title">Inputs</h2>
        <div className="gnwi-input-grid">
          <InputList
            title="1. CORS Network Data"
            subtitle="From 24 Zimbabwe CORS stations — observations processed to:"
            items={CORS_INPUTS}
            accent="#00ff88"
          />
          <InputList
            title="2. Space Weather Data"
            subtitle="NOAA / SWPC and allied feeds — collect:"
            items={SPACE_WEATHER_INPUTS}
            accent="#168bd2"
          />
          <div className="card gnwi-input-card" style={{ borderTopColor: "#a855f7" }}>
            <h3 className="gnwi-card-heading">3. AI Prediction Engine</h3>
            <p className="gnwi-card-sub">When TEC increases, the engine learns what happens to:</p>
            <ul className="gnwi-check-list">
              {AI_LEARNS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="gnwi-section">
        <h2 className="gnwi-section-title">User product — Zimbabwe GNSS Forecast</h2>
        <p className="gnwi-section-lead">
          Like a weather report, but for positioning reliability — derived from live inputs above.
        </p>
        <div className="gnwi-forecast-header">
          <span>🇿🇼 Zimbabwe GNSS Forecast</span>
          <span className="gnwi-forecast-day">
            {loading ? "Loading live inputs…" : updatedLabel ? `Today · live · ${updatedLabel}` : "Today"}
          </span>
        </div>
        {loading && !bundle ? (
          <div className="banner banner-info">Probing CORS NTRIP and fetching space-weather indices…</div>
        ) : (
          <div className="gnwi-forecast-grid">
            {forecasts.map((city) => (
              <ForecastCard key={city.city} city={city} />
            ))}
          </div>
        )}
      </section>

      <section className="gnwi-section">
        <h2 className="gnwi-section-title">Zimbabwe GNSS Digital Twin</h2>
        <p className="gnwi-section-lead">
          Regional positioning model — same live inputs, tomorrow-style outlook.
        </p>
        <div className="gnwi-twin-banner">ZIMBABWE DIGITAL TWIN · Routed from live CORS + space weather</div>
        <div className="gnwi-twin-grid">
          {(bundle?.digitalTwin ?? []).map((site) => (
            <article key={site.city} className="gnwi-twin-card">
              <div className="gnwi-twin-city">{site.city}</div>
              <div className="gnwi-twin-status" style={{ color: STATUS_COLORS[site.status] }}>
                Status {site.status === "excellent" ? "🟢" : site.status === "moderate" ? "🟡" : "🟠"}{" "}
                {site.statusLabel}
              </div>
              <dl className="gnwi-forecast-fields">
                <div className="gnwi-forecast-row">
                  <dt>RTK</dt>
                  <dd>{site.rtk}</dd>
                </div>
                <div className="gnwi-forecast-row">
                  <dt>Accuracy forecast</dt>
                  <dd>{site.accuracy}</dd>
                </div>
                {site.confidence && (
                  <div className="gnwi-forecast-row">
                    <dt>Confidence</dt>
                    <dd>{site.confidence}</dd>
                  </div>
                )}
              </dl>
              {site.cause && (
                <p className="gnwi-forecast-cause">
                  <strong>Inputs:</strong> {site.cause}
                </p>
              )}
              {site.recommendations && site.recommendations.length > 0 && (
                <ul className="gnwi-rec-list">
                  {site.recommendations.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="gnwi-section">
        <h2 className="gnwi-section-title">Industry-specific alerts</h2>
        <p className="gnwi-section-lead">Generated from the live forecast state — not static templates.</p>
        <div className="gnwi-alerts-grid">
          {(bundle?.industryAlerts ?? []).map((alert) => (
            <article key={alert.id} className="card gnwi-alert-card">
              <h3 className="gnwi-alert-title">
                <span aria-hidden>{alert.icon}</span> {alert.title}
              </h3>
              <ul className="gnwi-alert-lines">
                {alert.lines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>

      <section className="gnwi-section">
        <h2 className="gnwi-section-title">National positioning intelligence platform</h2>
        <p className="gnwi-section-lead">
          This GNSS Weather service moves the platform beyond a standard CORS network toward a
          national positioning reliability service.
        </p>
        <NationalPlatformDiagram modules={PLATFORM_MODULES} />
      </section>

      <div className="gnwi-footer-links">
        <Link href="/space-weather" className="btn">
          ← Live Space Weather
        </Link>
        <Link href="/dashboard" className="btn btn-accent">
          Operations Dashboard →
        </Link>
        <Link href="/live-pipeline" className="btn">
          Live CORS Pipeline →
        </Link>
      </div>
    </div>
  );
}
