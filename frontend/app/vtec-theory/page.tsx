"use client";

import { useEffect, useState } from "react";
import { getVtecTheory } from "@/lib/api";
import type { VtecTheoryPayload } from "@/lib/types";
import IllustrationCard from "@/components/theory/IllustrationCard";
import LatexEquation from "@/components/theory/LatexEquation";

export default function VtecTheoryPage() {
  const [data, setData] = useState<VtecTheoryPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    setLoading(true);
    setError(null);
    getVtecTheory()
      .then(setData)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [attempt]);

  if (loading) {
    return (
      <div className="page-title" style={{ padding: "2rem 0" }}>
        Loading VTEC Theory…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="banner banner-alert" style={{ display: "flex", flexDirection: "column", gap: "0.6rem", alignItems: "flex-start" }}>
        <span>
          Could not load theory content. Ensure the ZGIIS API is running on port 8000.
          {error ? ` (${error})` : ""}
        </span>
        <button className="btn" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
      </div>
    );
  }

  return (
    <div className="vtec-theory-page">
      <header className="vtec-theory-hero">
        <div className="vtec-theory-hero-kicker">ZGIIS · Ionospheric TEC Theory</div>
        <h1 className="page-title">📐 Calculating Vertical TEC (VTEC)</h1>
        <p className="page-subtitle">
          A step-by-step derivation from dual-frequency GNSS observations, following Gopi Krishna
          Seemala — Singh &amp; Tiwari (2022), Chapter 4. Equations numbered (4.1–4.22) with
          illustrations on each step.
        </p>
        <p className="vtec-theory-freq-note">
          GPS L1 = 1575.42 MHz · GPS L2 = 1227.60 MHz · 1 TECU = 10¹⁶ electrons m⁻²
        </p>
      </header>

      <div className="banner banner-info vtec-theory-reading-note">
        <strong>Reading order:</strong> Steps 1 → 10 follow the GPS_TEC v3.5 computational
        sequence. Each step builds on the previous one. Use the roadmap below, then scroll through
        the detailed steps with diagrams on the right.
      </div>

      <section className="vtec-steps-journey-wrap">
        <div className="vtec-steps-journey-title">
          10-step VTEC derivation — follow left to right
        </div>
        <div className="vtec-steps-journey">
          {data.journey.map((pill, i) => (
            <span key={pill.num} style={{ display: "contents" }}>
              <div
                className="vtec-journey-pill"
                style={{ ["--pill-accent" as string]: pill.accent }}
              >
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
            <span
              className="pipeline-overview-icon"
              dangerouslySetInnerHTML={{ __html: stage.icon }}
            />
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
              <div
                className="card vtec-theory-body-card"
                style={{ borderLeftColor: step.accent }}
              >
                <p>{step.body}</p>
              </div>
              <div className="vtec-why-box">
                <span className="vtec-why-label">Why this matters · </span>
                <span>{step.why}</span>
              </div>

              {step.equations.map((eq) => (
                <LatexEquation
                  key={eq.number}
                  latex={eq.latex}
                  number={eq.number}
                  caption={eq.caption}
                />
              ))}

              {step.variables.length > 0 ? (
                <div className="vtec-vars-wrap">
                  <div className="vtec-vars-title">Where</div>
                  <table className="vtec-vars-table">
                    <tbody>
                      {step.variables.map((row) => (
                        <tr key={row.symbol}>
                          <td
                            className="vtec-vars-sym"
                            dangerouslySetInnerHTML={{ __html: row.symbol }}
                          />
                          <td
                            className="vtec-vars-meaning"
                            dangerouslySetInnerHTML={{ __html: row.meaning }}
                          />
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {step.ipp_detail ? (
                <div className="vtec-ipp-detail">
                  <div className="vtec-ipp-detail-title">Detailed IPP geometry reference</div>
                  <div className="vtec-ipp-detail-grid">
                    <div className="ipp-geom-card">
                      <div
                        className="ipp-geom-svg-wrap"
                        dangerouslySetInnerHTML={{ __html: data.ipp.svg }}
                      />
                    </div>
                    <div
                      className="ipp-geom-legend-wrap"
                      dangerouslySetInnerHTML={{ __html: data.ipp.legend_html }}
                    />
                  </div>
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
        <div className="vtec-computation-pipeline-title">Complete Computation Pipeline</div>
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
