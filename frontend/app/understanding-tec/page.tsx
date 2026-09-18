"use client";

import Link from "next/link";
import type { UnderstandingTecPayload } from "@/lib/types";
import understandingTecStatic from "@/lib/understandingTecStatic.json";
import IllustrationCard from "@/components/theory/IllustrationCard";
import LatexEquation from "@/components/theory/LatexEquation";

const data = understandingTecStatic as UnderstandingTecPayload;

export default function UnderstandingTecPage() {
  return (
    <div className="vtec-theory-page">
      <header className="vtec-theory-hero">
        <div className="vtec-theory-hero-kicker">ZGIIS - Ionospheric TEC Explained</div>
        <h1 className="page-title">Understanding TEC</h1>
        <p className="page-subtitle">
          Imagine standing at a Zimbabwe CORS station in Harare. A GPS satellite is 20,200 km above you.
          This guide explains, in plain language, how electrons in the ionosphere affect that signal,
          what Total Electron Content means, and how ZGIIS turns dual-frequency GNSS into the maps on
          your dashboard.
        </p>
        <p className="vtec-theory-freq-note">
          GPS L1 = 1575.42 MHz | GPS L2 = 1227.60 MHz | 1 TECU = 10^16 electrons m^-2
        </p>
      </header>

      <div className="banner banner-info vtec-theory-reading-note">
        <strong>Reading order:</strong> Steps 1 to 10 build from the Harare CORS signal path to the
        Zimbabwe VTEC map. For the full mathematical derivation see{" "}
        <Link href="/vtec-theory">Calculating VTEC</Link>.
      </div>

      <section className="vtec-steps-journey-wrap">
        <div className="vtec-steps-journey-title">10 concepts - follow left to right</div>
        <div className="vtec-steps-journey">
          {data.journey.map((pill, i) => (
            <span key={pill.num} style={{ display: "contents" }}>
              <div className="vtec-journey-pill" style={{ ["--pill-accent" as string]: pill.accent }}>
                <span className="vtec-journey-num">{pill.num}</span>
                <span className="vtec-journey-label">{pill.short}</span>
              </div>
              {i < data.journey.length - 1 ? (
                <span className="vtec-journey-arrow" aria-hidden>
                  {">"}
                </span>
              ) : null}
            </span>
          ))}
        </div>
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
                <span className="vtec-why-label">Why this matters: </span>
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
        <div className="vtec-computation-pipeline-title">From GPS observations to ZGIIS maps</div>
        <div className="vtec-computation-pipeline-box">
          <div className="vtec-pipeline-inputs">
            {data.computation_pipeline.inputs.map((item, i) => (
              <span key={item}>
                {i > 0 ? " + " : ""}
                <strong>{item}</strong>
              </span>
            ))}
          </div>
          <div className="vtec-pipeline-connector">|</div>
          {data.computation_pipeline.stages.map((stage, i) => (
            <div key={stage.label}>
              <div className="vtec-pipeline-stage">
                <strong>
                  {i + 1}. {stage.label}
                </strong>
                <em>{"<-"} {stage.ref}</em>
              </div>
              <div className="vtec-pipeline-connector">|</div>
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
