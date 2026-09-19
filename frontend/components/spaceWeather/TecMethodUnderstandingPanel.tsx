"use client";

import { useState } from "react";
import {
  TEC_CLASSIFICATIONS,
  TEC_DEFINITION,
  TEC_FORMULA,
  TEC_L1_DELAY_NOTE,
  TEC_METHOD_BOTTOM_LINE,
  TEC_METHOD_DIFFERENCES,
  TEC_METHOD_GUIDES,
  TEC_OPERATIONAL_NOTE,
  TEC_SHARED_PIPELINE,
  TEC_TYPICAL_VALUES,
  TEC_UNIT,
} from "@/lib/tecPrimer";

/**
 * Teaching panel: what TEC is, how to classify TEC quantities, and how
 * GOPI vs Gg (notebook / PyTECGg) calculations differ — for Zimbabwe Response.
 */
export default function TecMethodUnderstandingPanel() {
  const [open, setOpen] = useState(true);

  return (
    <section className="card" style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
      <div>
        <div className="metric-label" style={{ marginBottom: 4 }}>
          Understand TEC · classify quantities · compare GOPI vs Gg
        </div>
        <p className="sw-supporting-text" style={{ margin: 0 }}>
          From the TEC_GNSS_Notebook_v5 teaching path: what TEC means, how to label STEC/VTEC and
          calibration stages, then what changes between{" "}
          <span style={{ color: "#38bdf8", fontWeight: 700 }}>GOPI / Seemala</span> and{" "}
          <span style={{ color: "#f59e0b", fontWeight: 700 }}>Gg / Ciraolo–Cesaroni (PyTECGg)</span>.
        </p>
        <button
          type="button"
          className="sw-supporting-text"
          onClick={() => setOpen((v) => !v)}
          style={{
            marginTop: "0.55rem",
            background: "transparent",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "0.35rem 0.65rem",
            cursor: "pointer",
            color: "var(--text-muted)",
          }}
        >
          {open ? "Hide teaching guide" : "Show teaching guide"}
        </button>
      </div>

      {open && (
        <>
          {/* 1 · What is TEC */}
          <div>
            <div className="metric-label" style={{ marginBottom: 6 }}>1 · What is TEC</div>
            <p className="sw-supporting-text" style={{ margin: 0 }}>{TEC_DEFINITION}</p>
            <p
              className="sw-supporting-text"
              style={{
                margin: "0.55rem 0 0",
                fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
                fontSize: "0.82rem",
                color: "var(--text)",
              }}
            >
              {TEC_FORMULA} · {TEC_UNIT}
            </p>
            <p className="sw-supporting-text" style={{ margin: "0.45rem 0 0" }}>{TEC_L1_DELAY_NOTE}</p>
            <div style={{ overflowX: "auto", marginTop: "0.65rem" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
                <thead>
                  <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                    <th style={{ padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--border)" }}>Condition</th>
                    <th style={{ padding: "0.35rem 0.5rem", borderBottom: "1px solid var(--border)" }}>Typical TEC</th>
                  </tr>
                </thead>
                <tbody>
                  {TEC_TYPICAL_VALUES.map((row) => (
                    <tr key={row.condition}>
                      <td style={{ padding: "0.35rem 0.5rem", borderBottom: "1px solid rgba(148,163,184,0.15)" }}>
                        {row.condition}
                      </td>
                      <td style={{ padding: "0.35rem 0.5rem", borderBottom: "1px solid rgba(148,163,184,0.15)" }}>
                        {row.range}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="sw-supporting-text" style={{ margin: "0.55rem 0 0" }}>{TEC_OPERATIONAL_NOTE}</p>
          </div>

          {/* 2 · Classify */}
          <div>
            <div className="metric-label" style={{ marginBottom: 6 }}>2 · Classify the TEC you are looking at</div>
            <p className="sw-supporting-text" style={{ margin: "0 0 0.55rem" }}>
              Before comparing methods, name the quantity. Mixing STEC with VTEC, or levelled with
              calibrated TEC, invents false “storms.”
            </p>
            <div
              style={{
                display: "grid",
                gap: "0.55rem",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
              }}
            >
              {TEC_CLASSIFICATIONS.map((c) => (
                <div
                  key={c.id}
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: 8,
                    padding: "0.65rem 0.75rem",
                    background: "rgba(15, 23, 42, 0.35)",
                  }}
                >
                  <div style={{ fontWeight: 700, fontSize: "0.82rem", marginBottom: 4 }}>{c.term}</div>
                  <p className="sw-supporting-text" style={{ margin: 0 }}>{c.meaning}</p>
                  <p className="sw-supporting-text" style={{ margin: "0.4rem 0 0", fontSize: "0.72rem" }}>
                    Spot it: {c.howToSpot}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* 3 · Shared pipeline */}
          <div>
            <div className="metric-label" style={{ marginBottom: 6 }}>3 · Shared calculation steps (both methods)</div>
            <ol
              style={{
                margin: 0,
                paddingLeft: "1.15rem",
                fontSize: "0.8rem",
                color: "var(--text-muted)",
                lineHeight: 1.55,
              }}
            >
              {TEC_SHARED_PIPELINE.map((step) => (
                <li key={step} style={{ marginBottom: 4 }}>{step}</li>
              ))}
            </ol>
          </div>

          {/* 4 · Side-by-side methods */}
          <div>
            <div className="metric-label" style={{ marginBottom: 6 }}>4 · Where GOPI and Gg diverge</div>
            <div
              style={{
                display: "grid",
                gap: "0.75rem",
                gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              }}
            >
              {TEC_METHOD_GUIDES.map((m) => (
                <div
                  key={m.id}
                  style={{
                    borderLeft: `3px solid ${m.color}`,
                    padding: "0.65rem 0.75rem",
                    background: "rgba(15, 23, 42, 0.35)",
                    borderRadius: "0 8px 8px 0",
                  }}
                >
                  <div style={{ color: m.color, fontWeight: 800, fontSize: "0.9rem" }}>{m.short}</div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text)", margin: "0.2rem 0 0.45rem" }}>
                    {m.label}
                  </div>
                  <p className="sw-supporting-text" style={{ margin: "0 0 0.55rem" }}>{m.origin}</p>
                  <div className="metric-label" style={{ marginBottom: 4, fontSize: "0.72rem" }}>Calculation steps</div>
                  <ol
                    style={{
                      margin: "0 0 0.55rem",
                      paddingLeft: "1.1rem",
                      fontSize: "0.76rem",
                      color: "var(--text-muted)",
                      lineHeight: 1.5,
                    }}
                  >
                    {m.steps.map((s) => (
                      <li key={s} style={{ marginBottom: 3 }}>{s}</li>
                    ))}
                  </ol>
                  <p className="sw-supporting-text" style={{ margin: "0 0 0.35rem" }}>
                    <strong style={{ color: "var(--text)" }}>Bias handling:</strong> {m.biasHandling}
                  </p>
                  <p className="sw-supporting-text" style={{ margin: "0 0 0.35rem" }}>
                    <strong style={{ color: "var(--text)" }}>Strength:</strong> {m.strengths}
                  </p>
                  <p className="sw-supporting-text" style={{ margin: 0 }}>
                    <strong style={{ color: "var(--text)" }}>Watch out:</strong> {m.watchOut}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* 5 · Difference table */}
          <div>
            <div className="metric-label" style={{ marginBottom: 6 }}>5 · Calculation differences at a glance</div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem", minWidth: 520 }}>
                <thead>
                  <tr style={{ textAlign: "left", color: "var(--text-muted)" }}>
                    <th style={{ padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--border)" }}>Topic</th>
                    <th style={{ padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--border)", color: "#38bdf8" }}>
                      GOPI
                    </th>
                    <th style={{ padding: "0.4rem 0.5rem", borderBottom: "1px solid var(--border)", color: "#f59e0b" }}>
                      Gg
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {TEC_METHOD_DIFFERENCES.map((row) => (
                    <tr key={row.topic}>
                      <td
                        style={{
                          padding: "0.45rem 0.5rem",
                          borderBottom: "1px solid rgba(148,163,184,0.15)",
                          fontWeight: 600,
                          color: "var(--text)",
                          verticalAlign: "top",
                        }}
                      >
                        {row.topic}
                      </td>
                      <td
                        style={{
                          padding: "0.45rem 0.5rem",
                          borderBottom: "1px solid rgba(148,163,184,0.15)",
                          color: "var(--text-muted)",
                          verticalAlign: "top",
                        }}
                      >
                        {row.gopi}
                      </td>
                      <td
                        style={{
                          padding: "0.45rem 0.5rem",
                          borderBottom: "1px solid rgba(148,163,184,0.15)",
                          color: "var(--text-muted)",
                          verticalAlign: "top",
                        }}
                      >
                        {row.gg}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p
              className="sw-supporting-text"
              style={{
                margin: "0.75rem 0 0",
                padding: "0.65rem 0.75rem",
                borderLeft: "3px solid var(--accent)",
                background: "rgba(22, 139, 210, 0.08)",
                borderRadius: "0 6px 6px 0",
                color: "var(--text)",
              }}
            >
              {TEC_METHOD_BOTTOM_LINE}
            </p>
          </div>
        </>
      )}
    </section>
  );
}
