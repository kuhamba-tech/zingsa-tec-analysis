"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSpaceWeather, getStations } from "@/lib/api";
import { buildGnssForecastBundle, type GnssForecastBundle } from "@/lib/gnssForecastEngine";
import type { NavigationNewsBrief } from "@/lib/gnssAudienceNews";
import {
  STATUS_COLORS,
  type GnssForecastCity,
  type GnssPerformanceForecast,
  AI_LEARNS,
  CORS_INPUTS,
  PLATFORM_MODULES,
  SPACE_WEATHER_INPUTS,
} from "@/lib/gnssWeatherIntelligence";
import {
  DataFusionPipelineDiagram,
  NationalPlatformDiagram,
} from "@/components/gnssIntelligence/GnssArchitectureDiagrams";
import BroadcastRecipientsPanel from "@/components/gnssIntelligence/BroadcastRecipientsPanel";
import FacebookPostPanel from "@/components/gnssIntelligence/FacebookPostPanel";
import NationalGnssStatusCard from "@/components/gnssIntelligence/NationalGnssStatusCard";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import { analyzeNavigationNewsBrief, analyzeNavigationNewsSection } from "@/lib/navigationNewsAnalysis";
import { effectiveNavigationTone } from "@/lib/gnssAudienceNews";
import type { SpaceWeatherCurrent, Station } from "@/lib/types";
import {
  ZINGSA_ADDRESS,
  ZINGSA_EMAIL,
  ZINGSA_HOURS,
  ZINGSA_PHONE,
  ZINGSA_WEBSITE,
} from "@/lib/zingsaContact";

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

function PerformanceForecastPanel({ forecast }: { forecast: GnssPerformanceForecast }) {
  const summary = [
    { label: "Storm probability", value: `${forecast.stormProbability}%`, sub: `Kp ${forecast.expectedKp} / Dst ${forecast.expectedDst} nT` },
    { label: "TEC forecast", value: `${forecast.forecastTec1h} TECU`, sub: `30 min ${forecast.forecastTec30m} · 6 h ${forecast.forecastTec6h}` },
    { label: "ROTI forecast", value: `${forecast.roti1h}`, sub: `Current ${forecast.rotiCurrent} · 30 min ${forecast.roti30m}` },
    { label: "Scintillation", value: `${forecast.scintillationProbability}%`, sub: "Probability from S4 + ROTI" },
    { label: "Cycle slips", value: `${forecast.cycleSlipProbability}%`, sub: `${forecast.expectedCycleSlipsPerHour}/hour expected` },
    { label: "PPP convergence", value: `${forecast.pppConvergenceMinutes} min`, sub: "Predicted wait to stable PPP" },
    { label: "Position error", value: `${forecast.horizontalErrorM} m`, sub: `${forecast.verticalErrorM} m vertical` },
    { label: "Integrity index", value: `${forecast.integrityIndex}/100`, sub: forecast.integrityLabel },
  ];

  return (
    <div className="gnwi-performance">
      <div className="gnwi-performance-head">
        <div>
          <p className="gnwi-performance-kicker">Space weather to GNSS performance</p>
          <h3 className="gnwi-performance-title">Operational GNSS impact forecast</h3>
        </div>
        <div className={`gnwi-integrity-pill gnwi-integrity-pill--${forecast.integrityLabel.toLowerCase()}`}>
          {forecast.integrityLabel}
        </div>
      </div>
      <p className="gnwi-performance-lead">
        The platform now treats TEC as one link in a chain: solar wind, storm probability, TEC,
        ROTI, scintillation, cycle slips, PPP convergence, position error, and a national integrity score.
      </p>
      <div className="gnwi-performance-summary">
        {summary.map((item) => (
          <article key={item.label} className="gnwi-performance-metric">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <small>{item.sub}</small>
          </article>
        ))}
      </div>
      <div className="gnwi-performance-chain">
        {forecast.stages.map((stage) => (
          <article key={stage.stage} className="gnwi-performance-stage">
            <div className="gnwi-performance-stage-num">{stage.stage}</div>
            <div className="gnwi-performance-stage-body">
              <h4>{stage.title}</h4>
              <strong>{stage.output}</strong>
              <p>{stage.detail}</p>
              <span>Confidence {stage.confidence}%</span>
            </div>
          </article>
        ))}
      </div>
      <div className="banner banner-info gnwi-performance-advisory">
        <strong>Operational advisory:</strong> {forecast.advisory}
      </div>
    </div>
  );
}

function CopyScriptButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <button type="button" className="gnwi-copy-btn" onClick={copy}>
      {copied ? "Copied!" : label}
    </button>
  );
}

function AudienceNewsCard({
  brief,
  sw,
  forecasts,
}: {
  brief: NavigationNewsBrief;
  sw: SpaceWeatherCurrent | null;
  forecasts: GnssForecastCity[];
}) {
  return (
    <article className="card gnwi-news-card" style={{ borderColor: STATUS_COLORS[brief.statusTone] }}>
      <div className="gnwi-news-meta">
        <span className="gnwi-news-icon" aria-hidden>
          {brief.icon}
        </span>
        <div>
          <h3 className="gnwi-news-title">{brief.title}</h3>
          <p className="gnwi-news-audience">{brief.audience}</p>
        </div>
      </div>
      <div className="gnwi-sw-box">
        <p className="gnwi-sw-box-label">Space weather today</p>
        <p className="gnwi-sw-box-text">{brief.spaceWeatherToday}</p>
        <ul className="gnwi-sw-readout">
          {brief.spaceWeatherBullets.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <p className="gnwi-news-headline">{brief.headline}</p>
      <p className="gnwi-news-summary">{brief.summary}</p>
      <p className="gnwi-news-impact-label">What this means for you</p>
      <ul className="gnwi-alert-lines">
        {brief.bullets.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="gnwi-news-action">
        <strong>What to do:</strong> {brief.action}
      </p>
      <p className="gnwi-news-channels">
        <strong>Future channels:</strong> {brief.channels.join(" · ")}
      </p>
      <ChartAnalysisBox
        block={analyzeNavigationNewsBrief(brief, sw, forecasts)}
        title="Analysis — why this brief says what it says"
      />
      <details className="gnwi-news-script-details">
        <summary>Broadcast script (WhatsApp / groups)</summary>
        <div className="gnwi-script-toolbar">
          <CopyScriptButton text={brief.broadcastScript} label="Copy for WhatsApp" />
        </div>
        <pre className="gnwi-news-script">{brief.broadcastScript}</pre>
      </details>
      <details className="gnwi-news-script-details">
        <summary>Social post (Facebook / X)</summary>
        <div className="gnwi-script-toolbar">
          <CopyScriptButton text={brief.socialScript} label="Copy for social" />
        </div>
        <pre className="gnwi-news-script gnwi-news-script--short">{brief.socialScript}</pre>
      </details>
    </article>
  );
}

export default function GnssIntelligencePage() {
  const [bundle, setBundle] = useState<GnssForecastBundle | null>(null);
  const [sw, setSw] = useState<SpaceWeatherCurrent | null>(null);
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
          setSw(null);
          return;
        }

        setSw(sw);
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
  const nationalTone = bundle ? effectiveNavigationTone(forecasts, sw) : "excellent";
  const updatedLabel = bundle?.computedAt
    ? bundle.computedAt.replace("T", " ").replace("Z", " UTC").slice(0, 19)
    : null;

  return (
    <div className="gnwi-page">
      <header className="gnwi-hero">
        <div className="gnwi-hero-kicker">Navigation Weather · National Positioning Intelligence</div>
        <h1 className="page-title">🛰️ Navigation Weather</h1>
        <p className="page-subtitle">
          How space weather — activity on the Sun and in Earth&apos;s magnetic field — affects
          navigation in your everyday life. News for citizens, farmers, surveyors, aviation, and
          drivers, updated from live NOAA indices and the ZINGSA CORS network.
        </p>
      </header>

      <div className="banner banner-info gnwi-vision-note">
        <strong>Space weather affects everyone.</strong> Solar flares, geomagnetic storms, and
        ionospheric disturbance change how GPS reaches your phone, tractor, taxi, and survey
        instruments. Briefs below translate live{" "}
        <Link href="/space-weather">Kp, Dst, S4, and GNSS risk</Link> into plain language — ready
        for WhatsApp groups, radio, and social media.
      </div>

      {error && <div className="banner banner-alert">{error}</div>}
      {bundle && (
        <section className="gnwi-section gnwi-section--status">
          <NationalGnssStatusCard
            forecasts={forecasts}
            tone={nationalTone}
            sw={sw}
            updatedLabel={updatedLabel}
          />
        </section>
      )}
      {bundle && (
        <div className="banner banner-info gnwi-live-sources" style={{ fontSize: "0.78rem" }}>
          <strong>Input routing:</strong> {bundle.inputSummary}
          {updatedLabel && <> · Computed {updatedLabel}</>}
        </div>
      )}

      {bundle && (
        <section className="gnwi-section">
          <PerformanceForecastPanel forecast={bundle.performanceForecast} />
        </section>
      )}

      <section className="gnwi-section">
        <h2 className="gnwi-section-title">Navigation News — space weather &amp; you</h2>
        <p className="gnwi-section-lead">
          Space weather is not only for scientists. When the Sun stirs the ionosphere, maps drift,
          tractors lose RTK fix, and taxis miss pickup points. Each brief explains what is happening
          in space today, what it means for your group, and what to do — in language anyone can
          understand.
        </p>
        <div className="gnwi-news-grid">
          {(bundle?.audienceNews ?? []).map((brief) => (
            <AudienceNewsCard
              key={brief.id}
              brief={brief}
              sw={sw}
              forecasts={bundle?.forecasts ?? []}
            />
          ))}
        </div>
        {bundle && (
          <ChartAnalysisBox
            block={analyzeNavigationNewsSection(bundle, sw)}
            title="Analysis — how to read today's Navigation News"
          />
        )}
        {loading && !bundle && (
          <div className="banner banner-info">Preparing audience briefs from live inputs…</div>
        )}
        <div className="card gnwi-agent-api">
          <h3 className="gnwi-agent-api-title">Broadcast agent API</h3>
          <p className="gnwi-agent-api-lead">
            Your AI agent can fetch the same scripts programmatically. Each response includes{" "}
            <code>broadcast_script</code> and <code>social_script</code> ready to post.
          </p>
          <ul className="gnwi-agent-api-list">
            <li>
              <code>GET /navigation-news</code> — all audience briefs
            </li>
            <li>
              <code>GET /navigation-news/briefs/citizen</code> — single brief (also{" "}
              <code>farmer</code>, <code>surveyor</code>, <code>driver</code>, <code>aviation</code>,{" "}
              <code>scientist</code>)
            </li>
            <li>
              Use <strong>Send live to WhatsApp</strong> below (Navigation Weather → Broadcast panel)
              or <code>POST /navigation-news/broadcast/whatsapp/send?live=true</code> with your API key.
            </li>
          </ul>
        </div>
        <BroadcastRecipientsPanel />
        <FacebookPostPanel />
      </section>

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
        <h2 className="gnwi-section-title">Regional GNSS forecast</h2>
        <p className="gnwi-section-lead">
          Technical outlook by city — the live inputs behind the audience briefs above.
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
        <h2 className="gnwi-section-title">National positioning intelligence platform</h2>
        <p className="gnwi-section-lead">
          This Navigation Weather service moves the platform beyond a standard CORS network toward a
          national positioning reliability service.
        </p>
        <NationalPlatformDiagram modules={PLATFORM_MODULES} />
      </section>

      <section className="gnwi-section">
        <h2 className="gnwi-section-title">Contact ZINGSA</h2>
        <p className="gnwi-section-lead">
          For space-weather and navigation guidance, reach the Zimbabwe National Geospatial and Space
          Agency using the official contact details from{" "}
          <a href={ZINGSA_WEBSITE} target="_blank" rel="noopener noreferrer">
            zingsa.ac.zw
          </a>
          .
        </p>
        <div className="card gnwi-input-card" style={{ borderTopColor: "var(--accent)" }}>
          <ul className="gnwi-check-list">
            <li>
              <strong>Phone:</strong>{" "}
              <a href={`tel:${ZINGSA_PHONE.replace(/\s/g, "")}`}>{ZINGSA_PHONE}</a>
            </li>
            <li>
              <strong>Email:</strong>{" "}
              <a href={`mailto:${ZINGSA_EMAIL}`}>{ZINGSA_EMAIL}</a>
            </li>
            <li>
              <strong>Hours:</strong> {ZINGSA_HOURS}
            </li>
            <li>
              <strong>Address:</strong> {ZINGSA_ADDRESS}
            </li>
          </ul>
        </div>
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
