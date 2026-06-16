"use client";
import { useState, useRef } from "react";
import dynamic from "next/dynamic";
import { uploadCmn, uploadRinex, getSessionSummary } from "@/lib/api";
import LineChart from "@/components/charts/LineChart";
import type { TecSummaryRow } from "@/lib/types";
import type { MapLayer } from "@/components/maps/CorsMapWithLayers";

const CorsMap = dynamic(() => import("@/components/maps/CorsMap"), { ssr: false });

type Mode = "daily" | "monthly" | "yearly";

const LAYERS: MapLayer[] = ["Hybrid", "Satellite", "Street", "TEC Heat Map"];

const PIPELINE_STAGES = [
  { icon: "📂", label: "RINEX/CMN loading",        color: "#ffcc00" },
  { icon: "🔍", label: "Cycle slip detection",      color: "#168bd2" },
  { icon: "✂️",  label: "Satellite bias correction", color: "#a78bfa" },
  { icon: "▶",  label: "Receiver bias correction",  color: "#00cc88" },
  { icon: "↗",  label: "Slant TEC calculation",     color: "#ff8c00" },
  { icon: "⊞",  label: "Vertical TEC calculation",  color: "#168bd2" },
  { icon: "🗺️", label: "Map/table generation",      color: "#00ff88" },
];

export default function ProcessingPage() {
  const [status, setStatus]     = useState<string>("");
  const [rows, setRows]         = useState<TecSummaryRow[]>([]);
  const [mode, setMode]         = useState<Mode>("daily");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading]   = useState(false);
  const [tab, setTab]           = useState<"cmn" | "rinex">("cmn");
  const [mapLayer, setMapLayer] = useState<MapLayer>("Hybrid");
  const obsRef = useRef<HTMLInputElement>(null);
  const navRef = useRef<HTMLInputElement>(null);
  const cmnRef = useRef<HTMLInputElement>(null);

  async function loadSummary(id: string, m: Mode) {
    const data = await getSessionSummary(id, m);
    setRows(data);
  }

  async function handleProcess() {
    if (tab === "cmn") {
      const file = cmnRef.current?.files?.[0];
      if (!file) return setStatus("Select a .Cmn file first.");
      setLoading(true); setStatus("Processing…");
      try {
        const sess = await uploadCmn(file);
        setSessionId(sess.session_id);
        setStatus(`Done — ${sess.rows.toLocaleString()} observations`);
        await loadSummary(sess.session_id, mode);
      } catch (e) { setStatus(`Error: ${e}`); }
    } else {
      const obs = Array.from(obsRef.current?.files ?? []);
      const nav = Array.from(navRef.current?.files ?? []);
      if (!obs.length) return setStatus("Select at least one observation file.");
      setLoading(true); setStatus("Processing RINEX…");
      try {
        const sess = await uploadRinex(obs, nav);
        setSessionId(sess.session_id);
        setStatus(`Done — ${sess.rows.toLocaleString()} observations`);
        await loadSummary(sess.session_id, mode);
      } catch (e) { setStatus(`Error: ${e}`); }
    }
    setLoading(false);
  }

  async function changeMode(m: Mode) {
    setMode(m);
    if (sessionId) { setLoading(true); await loadSummary(sessionId, m); setLoading(false); }
  }

  const labels = rows.map((r) => r.date.slice(0, 10));
  const values = rows.map((r) => r.mean_vtec ?? 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>

      {/* Title */}
      <div>
        <h1 className="page-title">⚙️ RINEX / CMN Processing</h1>
        <p className="page-subtitle">GOP-compatible CMN and RINEX observation file processor with VTEC computation</p>
      </div>

      {/* File selection */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
        <div className="tabs" style={{ marginBottom: "0.2rem" }}>
          <button className={`tab${tab === "cmn" ? " active" : ""}`} onClick={() => setTab("cmn")}>CMN File</button>
          <button className={`tab${tab === "rinex" ? " active" : ""}`} onClick={() => setTab("rinex")}>RINEX Files</button>
        </div>

        {tab === "cmn" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Select .Cmn observation file</label>
            <input ref={cmnRef} type="file" accept=".Cmn,.cmn,.csv"
              style={{ color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.4rem", fontSize: "0.82rem" }} />
          </div>
        )}

        {tab === "rinex" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <label style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Observation files (.rnx, .o)</label>
            <input ref={obsRef} type="file" multiple accept=".rnx,.o,.obs"
              style={{ color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.4rem", fontSize: "0.82rem" }} />
            <label style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Navigation files (.nav, .n) — optional</label>
            <input ref={navRef} type="file" multiple accept=".nav,.n,.gnav,.hnav"
              style={{ color: "var(--text)", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.4rem", fontSize: "0.82rem" }} />
          </div>
        )}
      </div>

      {/* Info banner */}
      <div className="banner banner-info">
        Select a {tab === "cmn" ? ".Cmn" : "RINEX observation"} file above, then click Start Process to run the VTEC computation pipeline.
      </div>

      {/* Start Process button */}
      <div>
        <button className="btn btn-primary" onClick={handleProcess} disabled={loading}
          style={{ fontSize: "0.9rem", padding: "0.5rem 1.4rem" }}>
          {loading ? "⏳ Processing…" : "► Start Process"}
        </button>
      </div>

      {status && (
        <div className={`banner ${status.startsWith("Error") ? "banner-alert" : "banner-info"}`}>{status}</div>
      )}

      {/* Map section */}
      <div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem", marginBottom: "0.4rem" }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: "0.9rem" }}>Zimbabwe CORS Processing Map</div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
              {rows.length > 0
                ? `${rows.length} sessions loaded.`
                : "No stations loaded for processing. Select RINEX/CMN files to add sites."}
            </div>
          </div>
          {/* Layer switcher */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap" }}>
            <span style={{ fontSize: "0.65rem", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)" }}>Map Layer</span>
            {LAYERS.map((l) => (
              <button key={l} onClick={() => setMapLayer(l)} style={{
                padding: "0.3rem 0.8rem",
                borderRadius: "6px",
                fontSize: "0.8rem",
                fontWeight: 600,
                cursor: "pointer",
                border: `1px solid ${mapLayer === l ? "var(--accent)" : "var(--border)"}`,
                background: mapLayer === l ? "var(--accent)" : "transparent",
                color: mapLayer === l ? "#000" : "var(--text)",
                transition: "background 0.12s",
              }}>{l}</button>
            ))}
          </div>
        </div>

        {/* Map with station status legend overlay */}
        <div style={{ position: "relative" }}>
          <CorsMap stations={[]} height={420} layer={mapLayer} />
          <div style={{
            position: "absolute", bottom: "12px", left: "12px",
            display: "inline-flex", flexDirection: "column", gap: "0.3rem",
            background: "rgba(0,0,0,0.82)", border: "1px solid var(--border)",
            borderRadius: "8px", padding: "0.55rem 0.8rem",
            fontSize: "0.75rem", fontWeight: 700, zIndex: 10, pointerEvents: "none",
          }}>
            <div style={{ textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--text-muted)", marginBottom: "0.2rem", fontSize: "0.68rem" }}>
              Station Status
            </div>
            {[
              { color: "#00ff88", label: "Online" },
              { color: "#ff8c00", label: "Degraded" },
              { color: "#ff4444", label: "Offline" },
              { color: "#666",    label: "Telemetry Unavailable" },
            ].map(({ color, label }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span className="dot" style={{ background: color }} />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Processing Pipeline */}
      <div>
        <div style={{ fontWeight: 700, fontSize: "0.9rem", marginBottom: "0.2rem" }}>Processing Pipeline</div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginBottom: "0.8rem" }}>Click a card for an explanation of what the value means.</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: "0.6rem" }}>
          {PIPELINE_STAGES.map(({ icon, label, color }, i) => (
            <div key={label} className="card" style={{ textAlign: "center", cursor: "default", borderLeft: `3px solid ${color}`, padding: "0.8rem" }}>
              <div style={{ fontSize: "1.3rem", marginBottom: "0.3rem" }}>{icon}</div>
              <div style={{ fontSize: "0.75rem", fontWeight: 600, lineHeight: 1.3 }}>{label}</div>
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.25rem" }}>Stage {i + 1}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Results */}
      {rows.length > 0 && (
        <>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            {(["daily", "monthly", "yearly"] as Mode[]).map((m) => (
              <button key={m} className={`tab${mode === m ? " active" : ""}`}
                onClick={() => changeMode(m)}
                style={{ borderBottom: "none", border: "1px solid var(--border)", borderRadius: "6px" }}>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
          </div>
          <div className="card">
            <div className="metric-label" style={{ marginBottom: "0.6rem" }}>Mean VTEC — {mode}</div>
            <LineChart labels={labels} datasets={[{ label: "Mean VTEC (TECU)", data: values, color: "#168bd2", fill: true }]} height={280} />
          </div>
          <div className="card" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}>
                  <th style={{ padding: "0.4rem 0.6rem", textAlign: "left" }}>Date</th>
                  <th style={{ padding: "0.4rem 0.6rem", textAlign: "right" }}>Mean VTEC</th>
                  <th style={{ padding: "0.4rem 0.6rem", textAlign: "right" }}>Max VTEC</th>
                  <th style={{ padding: "0.4rem 0.6rem", textAlign: "right" }}>Min VTEC</th>
                  <th style={{ padding: "0.4rem 0.6rem", textAlign: "right" }}>Samples</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.date} style={{ borderBottom: "1px solid #1a2a3a" }}>
                    <td style={{ padding: "0.35rem 0.6rem" }}>{r.date.slice(0, 10)}</td>
                    <td style={{ padding: "0.35rem 0.6rem", textAlign: "right", color: "#168bd2" }}>{r.mean_vtec?.toFixed(2) ?? "N/A"}</td>
                    <td style={{ padding: "0.35rem 0.6rem", textAlign: "right" }}>{r.max_vtec?.toFixed(2) ?? "N/A"}</td>
                    <td style={{ padding: "0.35rem 0.6rem", textAlign: "right" }}>{r.min_vtec?.toFixed(2) ?? "N/A"}</td>
                    <td style={{ padding: "0.35rem 0.6rem", textAlign: "right" }}>{r.samples?.toLocaleString() ?? "N/A"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

    </div>
  );
}
