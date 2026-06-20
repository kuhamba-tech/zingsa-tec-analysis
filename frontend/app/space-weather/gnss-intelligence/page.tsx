"use client";

import Link from "next/link";
import {
  AI_LEARNS,
  CORS_INPUTS,
  DIGITAL_TWIN_SITES,
  GNSS_ARCHITECTURE_ASCII,
  INDUSTRY_ALERTS,
  NATIONAL_ARCHITECTURE_ASCII,
  PLATFORM_MODULES,
  SAMPLE_FORECASTS,
  SPACE_WEATHER_INPUTS,
  STATUS_COLORS,
} from "@/lib/gnssWeatherIntelligence";

function ArchitectureBlock({ title, diagram }: { title: string; diagram: string }) {
  return (
    <div className="gnwi-arch-block">
      <div className="gnwi-arch-title">{title}</div>
      <pre className="gnwi-arch-pre" aria-label={title}>
        {diagram}
      </pre>
    </div>
  );
}

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

export default function GnssIntelligencePage() {
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
        <strong>Product vision layer.</strong> Sample forecasts and industry alerts below illustrate
        the target user experience. Live indices are on{" "}
        <Link href="/space-weather">Space Weather Monitoring</Link> and the{" "}
        <Link href="/dashboard">Operations Dashboard</Link>; full AI forecasting is on the platform
        roadmap.
      </div>

      <section className="gnwi-section">
        <h2 className="gnwi-section-title">Architecture</h2>
        <ArchitectureBlock title="Data fusion pipeline" diagram={GNSS_ARCHITECTURE_ASCII} />
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
        <p className="gnwi-section-lead">Like a weather report, but for positioning reliability.</p>
        <div className="gnwi-forecast-header">
          <span>🇿🇼 Zimbabwe GNSS Forecast</span>
          <span className="gnwi-forecast-day">Today · illustrative examples</span>
        </div>
        <div className="gnwi-forecast-grid">
          {SAMPLE_FORECASTS.map((city) => (
            <article
              key={city.city}
              className="gnwi-forecast-card"
              style={{ borderColor: STATUS_COLORS[city.status] }}
            >
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
                  <strong>Cause:</strong> {city.cause}
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
          ))}
        </div>
      </section>

      <section className="gnwi-section">
        <h2 className="gnwi-section-title">Zimbabwe GNSS Digital Twin</h2>
        <p className="gnwi-section-lead">
          Advanced layer — a live model of the national positioning environment.
        </p>
        <div className="gnwi-twin-banner">ZIMBABWE DIGITAL TWIN · Prediction: Tomorrow</div>
        <div className="gnwi-twin-grid">
          {DIGITAL_TWIN_SITES.map((site) => (
            <article key={site.city} className="gnwi-twin-card">
              <div className="gnwi-twin-city">{site.city}</div>
              <div className="gnwi-twin-status" style={{ color: STATUS_COLORS[site.status] }}>
                Status {site.status === "excellent" ? "🟢" : "🟡"} {site.statusLabel}
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
              {site.reason && (
                <p className="gnwi-forecast-cause">
                  <strong>Reason:</strong> {site.reason}
                </p>
              )}
              {site.cause && (
                <p className="gnwi-forecast-cause">
                  <strong>Cause:</strong> {site.cause}
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
        <p className="gnwi-section-lead">
          Tailored warnings — not one message for every user.
        </p>
        <div className="gnwi-alerts-grid">
          {INDUSTRY_ALERTS.map((alert) => (
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
        <ArchitectureBlock title="Full platform stack" diagram={NATIONAL_ARCHITECTURE_ASCII} />
        <ul className="gnwi-module-list">
          {PLATFORM_MODULES.map((mod) => (
            <li key={mod}>
              <span className="gnwi-module-check">✓</span> {mod}
            </li>
          ))}
        </ul>
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
