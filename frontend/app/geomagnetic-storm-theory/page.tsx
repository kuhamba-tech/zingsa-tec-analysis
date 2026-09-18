"use client";

import { useEffect, useState } from "react";
import { getGeomagneticTheory } from "@/lib/api";
import type { GeomagneticTheoryPayload } from "@/lib/types";
import IllustrationCard from "@/components/theory/IllustrationCard";
import LatexEquation from "@/components/theory/LatexEquation";

export default function GeomagneticStormTheoryPage() {
  const [data, setData] = useState<GeomagneticTheoryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getGeomagneticTheory()
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [attempt]);

  if (loading) {
    return (
      <div className="page-title" style={{ padding: "2rem 0" }}>
        Loading Geomagnetic Storm Metrics Theory…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div
        className="banner banner-alert"
        style={{ display: "flex", flexDirection: "column", gap: "0.6rem", alignItems: "flex-start" }}
      >
        <span>
          Could not load theory content. Ensure the ZGIIS API is running on port 8000.
          {error ? ` (${error})` : ""}
        </span>
        <button className="btn" onClick={() => setAttempt((n) => n + 1)}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="vtec-theory-page">
      <header className="vtec-theory-hero">
        <div className="vtec-theory-hero-kicker">ZGIIS · Space Weather Theory</div>
        <h1 className="page-title">🧲 Geomagnetic Storm Metrics</h1>
        <p className="page-subtitle">
          Understand the indices on the ZGIIS dashboard and Time Series tab — Kp, Dst, Ap, F10.7 solar
          flux, solar wind, and how they connect to storms over Zimbabwe. Each metric has an illustration
          and plain-language explanation.
        </p>
        <p className="vtec-theory-freq-note">
          Storm thresholds · Kp ≥ 5 (G1) · Dst ≤ −50 nT · Ap ≥ 50 · F10.7 in sfu · solar wind in km/s
        </p>
      </header>

      <div className="banner banner-info vtec-theory-reading-note">
        <strong>Reading order:</strong> Steps 1 → 8 follow the chain from the Sun to Zimbabwe&apos;s
        infrastructure. Start with the Sun–Earth link, learn each index, then see how ZGIIS combines them
        for operational monitoring.
      </div>

      <section className="vtec-steps-journey-wrap">
        <div className="vtec-steps-journey-title">8 metrics — follow left to right</div>
        <div className="vtec-steps-journey">
          {data.journey.map((pill, i) => (
            <span key={pill.num} style={{ display: "contents" }}>
              <div className="vtec-journey-pill" style={{ ["--pill-accent" as string]: pill.accent }}>
                <span className="vtec-journey-num">{pill.num}</span>
                <span className="vtec-journey-label">{pill.short}</span>
              </div>
              {i < data.journey.length - 1 ? (
                <span className="vtec-journey-arrow" aria-hidden>
                  →
                </span>
              ) : null}
            </span>
          ))}
        </div>
      </section>

      <section className="pipeline-overview-cards">
        {data.pipeline_stages.map((stage) => (
          <div key={stage.label} className="pipeline-overview-card">
            <span className="pipeline-overview-icon">{stage.icon}</span>
            <span>{stage.label}</span>
          </div>
        ))}
      </section>

      {data.steps.map((step) => (
        <section key={step.id} className="vtec-theory-step">
          <div className="vtec-theory-step-header">
            <span className="vtec-theory-step-badge" style={{ background: step.accent }}>
              STEP {step.id.toUpperCase()}
            </span>
            <h2 className="vtec-theory-step-title">{step.title}</h2>
          </div>

          <div className="vtec-theory-step-grid">
            <div className="vtec-theory-step-text">
              <div className="card vtec-theory-body-card" style={{ borderLeftColor: step.accent }}>
                <p>{step.body}</p>
              </div>
              <div className="vtec-why-box">
                <span className="vtec-why-label">Why this matters · </span>
                <span>{step.why}</span>
              </div>

              {step.equations.map((eq) => (
                <LatexEquation key={eq.number} latex={eq.latex} number={eq.number} caption={eq.caption} />
              ))}

              {step.variables.length > 0 ? (
                <div className="vtec-vars-wrap">
                  <div className="vtec-vars-title">Key terms</div>
                  <table className="vtec-vars-table">
                    <tbody>
                      {step.variables.map((row) => (
                        <tr key={row.symbol}>
                          <td className="vtec-vars-sym" dangerouslySetInnerHTML={{ __html: row.symbol }} />
                          <td className="vtec-vars-meaning" dangerouslySetInnerHTML={{ __html: row.meaning }} />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </div>

            <aside className="vtec-theory-step-figure">
              <div className="vtec-figure-label">Illustration</div>
              <IllustrationCard illustration={step.illustration} />
            </aside>
          </div>
        </section>
      ))}

      <section className="vtec-computation-pipeline">
        <div className="vtec-computation-pipeline-title">How ZGIIS uses these metrics</div>
        <div className="vtec-computation-pipeline-box">
          <div className="vtec-pipeline-inputs">
            {data.computation_pipeline.inputs.map((item, i) => (
              <span key={item}>
                {i > 0 ? " + " : ""}
                <strong>{item}</strong>
              </span>
            ))}
          </div>
          <div className="vtec-pipeline-connector">│</div>
          {data.computation_pipeline.stages.map((stage, i) => (
            <div key={stage.label}>
              <div className="vtec-pipeline-stage">
                <strong>
                  {String.fromCharCode(0x2460 + i)} {stage.label}
                </strong>
                <em>← {stage.ref}</em>
              </div>
              <div className="vtec-pipeline-connector">│</div>
            </div>
          ))}
          <div className="vtec-pipeline-output">
            <strong>Output: {data.computation_pipeline.output}</strong>
          </div>
        </div>
      </section>

      <footer className="banner banner-info vtec-theory-citation">{data.citation}</footer>
    </div>
  );
}
