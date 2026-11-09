"use client";

import { useState } from "react";
import { askScientificRag, type ScientificRagEvidence } from "@/lib/api";

const SUGGESTIONS = [
  "What is the expected diurnal TEC behaviour over Zimbabwe?",
  "What do published studies report about seasonal TEC variation in Southern Africa?",
  "How do geomagnetic storms influence TEC at low latitudes?",
  "What causes positive and negative ionospheric storms?",
  "How does the Equatorial Ionization Anomaly affect Southern Africa?",
  "How do today's ZINGSA TEC observations compare with relevant published research?",
];

export default function ScientificKnowledgeAssistant() {
  const [question, setQuestion] = useState("");
  const [includeLive, setIncludeLive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [mode, setMode] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<ScientificRagEvidence[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function ask(text: string) {
    const q = text.trim();
    if (!q) return;
    setBusy(true);
    setError(null);
    setAnswer(null);
    setEvidence([]);
    try {
      const res = await askScientificRag(q, includeLive);
      setAnswer(res.answer);
      setMode(res.mode);
      setEvidence(res.evidence || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function copyAnswer() {
    if (!answer) return;
    void import("@/lib/safeClipboard").then(({ safeClipboardWrite }) => {
      void safeClipboardWrite(
        [
          answer,
          "",
          "Sources:",
          ...evidence.map((item, i) => `[${i + 1}] ${item.citation_label || item.title || "Untitled"}`),
        ].join("\n"),
      );
    });
  }

  return (
    <section className="card" aria-labelledby="scientific-knowledge-assistant-title" style={{ marginTop: "1rem" }}>
      <h3 id="scientific-knowledge-assistant-title" style={{ margin: "0 0 0.35rem", color: "#ffffff" }}>
        Scientific Knowledge Assistant
      </h3>
      <p style={{ margin: "0 0 0.85rem", color: "#ffffff", fontSize: "0.86rem", lineHeight: 1.5 }}>
        Answers use indexed Google Drive publications. Live ZINGSA numbers stay authoritative when included —
        literature never replaces measurements.
      </p>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", marginBottom: "0.75rem" }}>
        {SUGGESTIONS.map((item) => (
          <button
            key={item}
            type="button"
            className="btn"
            style={{ fontSize: "0.75rem" }}
            onClick={() => {
              setQuestion(item);
              void ask(item);
            }}
          >
            {item}
          </button>
        ))}
      </div>

      <label style={{ display: "flex", alignItems: "center", gap: "0.45rem", color: "#ffffff", fontSize: "0.82rem", marginBottom: "0.55rem" }}>
        <input type="checkbox" checked={includeLive} onChange={(e) => setIncludeLive(e.target.checked)} />
        Include live ZINGSA observation context
      </label>

      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input
          className="form-input"
          style={{ flex: "1 1 16rem" }}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask a scientific literature question…"
          onKeyDown={(e) => {
            if (e.key === "Enter") void ask(question);
          }}
        />
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void ask(question)}>
          {busy ? "Retrieving…" : "Ask"}
        </button>
        <button type="button" className="btn" disabled={!answer} onClick={copyAnswer}>
          Copy
        </button>
      </div>

      {mode ? (
        <p style={{ margin: "0.75rem 0 0", color: "#ffffff", fontSize: "0.78rem" }}>
          Mode: {mode === "literature+observations" ? "Literature + live observations" : "Literature only"}
        </p>
      ) : null}
      {error ? <div className="banner banner-warn" style={{ marginTop: "0.75rem" }}>{error}</div> : null}
      {answer ? (
        <div style={{ marginTop: "0.85rem", color: "#ffffff", whiteSpace: "pre-wrap", lineHeight: 1.6, fontSize: "0.9rem" }}>
          {answer}
        </div>
      ) : null}
      {evidence.length > 0 ? (
        <div style={{ marginTop: "1rem" }}>
          <h4 style={{ margin: "0 0 0.5rem", color: "#7dd3fc", fontSize: "0.78rem", letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Source passages
          </h4>
          <ul style={{ margin: 0, paddingLeft: "1.1rem", color: "#ffffff", fontSize: "0.82rem", lineHeight: 1.5 }}>
            {evidence.map((item, index) => (
              <li key={`${item.title}-${index}`} style={{ marginBottom: "0.65rem" }}>
                <strong>[{index + 1}] {item.citation_label || item.title || "Untitled"}</strong>
                {item.source_url ? (
                  <>
                    {" · "}
                    <a href={item.source_url} target="_blank" rel="noreferrer" style={{ color: "#7dd3fc" }}>
                      Open authorised document
                    </a>
                  </>
                ) : null}
                <div style={{ marginTop: "0.25rem", opacity: 0.95 }}>{item.passage.slice(0, 500)}{item.passage.length > 500 ? "…" : ""}</div>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
