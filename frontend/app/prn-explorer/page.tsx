"use client";
import { useEffect, useState } from "react";
import { getPrn, getTimeSeries } from "@/lib/api";
import LineChart from "@/components/charts/LineChart";
import type { PrnRow, TecObservation } from "@/lib/types";

const CONSTELLATIONS = [
  { id: "GPS",     label: "GPS",     icon: "⚙️",  color: "#168bd2", prnRange: "G01–G32" },
  { id: "Galileo", label: "Galileo", icon: "🌐",  color: "#00cc88", prnRange: "E01–E36" },
  { id: "BeiDou",  label: "BeiDou",  icon: "🔶",  color: "#ff8c00", prnRange: "C01–C63" },
  { id: "GLONASS", label: "GLONASS", icon: "🛰️",  color: "#a78bfa", prnRange: "R01–R24" },
];

const PRN_COLORS = ["#168bd2","#ff4444","#00ff88","#ff8c00","#a78bfa","#ffcc00","#34d399","#f472b6","#60a5fa"];

type Tab = "vtec" | "sky" | "elev" | "quality";

export default function PrnExplorerPage() {
  const [allRows, setAllRows]     = useState<PrnRow[]>([]);
  const [obsData, setObsData]     = useState<TecObservation[]>([]);
  const [selected, setSelected]   = useState<string>("GPS");
  const [tab, setTab]             = useState<Tab>("vtec");
  const [loading, setLoading]     = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [rows, obs] = await Promise.all([
          getPrn(undefined),
          getTimeSeries({ limit: 5000 }),
        ]);
        setAllRows(rows);
        setObsData(obs);
      } catch { /* offline */ }
      setLoading(false);
    })();
  }, []);

  // Rows filtered to selected constellation
  const filteredRows = allRows.filter((r) =>
    r.constellation?.toLowerCase() === selected.toLowerCase()
  );

  // Constellation summary stats
  function constellationStats(cid: string) {
    const rows = allRows.filter((r) => r.constellation?.toLowerCase() === cid.toLowerCase());
    const vtecs = rows.map((r) => r.mean_vtec ?? 0).filter((v) => v > 0);
    const meanVtec = vtecs.length ? vtecs.reduce((a, b) => a + b, 0) / vtecs.length : null;
    const quals = rows.map((r) => r.mean_qual ?? 0).filter((v) => v > 0);
    const meanQual = quals.length ? quals.reduce((a, b) => a + b, 0) / quals.length : null;
    return { count: rows.length, meanVtec, meanQual };
  }

  // Build VTEC by PRN time-series chart
  // Group observations by PRN + hour-of-day
  const selectedObs = obsData.filter((o) => {
    const prn = (o.prn ?? "").toUpperCase();
    if (selected === "GPS")     return prn.startsWith("G");
    if (selected === "Galileo") return prn.startsWith("E");
    if (selected === "BeiDou")  return prn.startsWith("C");
    if (selected === "GLONASS") return prn.startsWith("R");
    return true;
  });

  const prnSet = [...new Set(selectedObs.map((o) => o.prn ?? "").filter(Boolean))].sort().slice(0, 9);
  const hourSet = Array.from({ length: 25 }, (_, i) => i); // 0..24

  const byPrnHour: Record<string, Record<number, number[]>> = {};
  for (const o of selectedObs) {
    const prn  = o.prn ?? "";
    if (!prn || !prnSet.includes(prn)) continue;
    const hour = new Date(o.timestamp).getUTCHours();
    if (!byPrnHour[prn]) byPrnHour[prn] = {};
    if (!byPrnHour[prn][hour]) byPrnHour[prn][hour] = [];
    if (o.vtec !== null) byPrnHour[prn][hour].push(o.vtec);
  }

  const chartDatasets = prnSet.map((prn, i) => ({
    label: prn,
    data: hourSet.map((h) => {
      const vals = byPrnHour[prn]?.[h] ?? [];
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }),
    color: PRN_COLORS[i % PRN_COLORS.length],
  }));

  // Elevation vs TEC scatter (as line chart grouped by elevation bin)
  const elevBins = Array.from({ length: 9 }, (_, i) => i * 10 + 5); // 5,15,25...85
  const elevDatasets = prnSet.slice(0, 6).map((prn, i) => {
    const prnObs = selectedObs.filter((o) => o.prn === prn && o.elevation_deg !== null && o.vtec !== null);
    const binned = elevBins.map((bin) => {
      const inBin = prnObs.filter((o) => Math.abs((o.elevation_deg ?? 0) - bin) <= 5);
      if (!inBin.length) return 0;
      return inBin.reduce((a, o) => a + (o.vtec ?? 0), 0) / inBin.length;
    });
    return { label: prn, data: binned, color: PRN_COLORS[i % PRN_COLORS.length] };
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>

      {/* Title */}
      <div>
        <h1 className="page-title">🛸 Satellite PRN Explorer</h1>
        <p className="page-subtitle">GPS · Galileo · BeiDou · GLONASS — per-satellite TEC and geometry analysis</p>
      </div>

      {/* Info text with highlighted keywords */}
      <div style={{ fontSize: "0.8rem" }}>
        Click a card for{" "}
        <span style={{ color: "var(--accent)", fontWeight: 600 }}>Chapter 4</span>{" "}
        explanation of{" "}
        <span style={{ color: "var(--accent)", fontWeight: 600 }}>Satellites</span>,{" "}
        <span style={{ color: "var(--accent)", fontWeight: 600 }}>VTEC</span>,{" "}
        <span style={{ color: "var(--accent)", fontWeight: 600 }}>quality</span>, and{" "}
        <span style={{ color: "var(--accent)", fontWeight: 600 }}>PRN range</span>.
      </div>

      {/* Constellation cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.8rem" }}>
        {CONSTELLATIONS.map((c) => {
          const stats = constellationStats(c.id);
          const isActive = selected === c.id;
          return (
            <div
              key={c.id}
              onClick={() => setSelected(c.id)}
              style={{
                cursor: "pointer",
                textAlign: "center",
                background: "var(--surface)",
                border: `1px solid ${isActive ? c.color : "var(--border)"}`,
                borderRadius: "10px",
                padding: "1.1rem 0.8rem",
                transition: "border-color 0.15s",
              }}
            >
              <div style={{ fontSize: "1.5rem", marginBottom: "0.3rem" }}>{c.icon}</div>
              <div style={{ fontWeight: 800, fontSize: "1rem", marginBottom: "0.25rem" }}>{c.label}</div>
              <div style={{ fontWeight: 700, fontSize: "1.25rem", marginBottom: "0.35rem" }}>
                {stats.count > 0 ? `${stats.count} Satellites` : "—"}
              </div>
              <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", lineHeight: 1.6 }}>
                {stats.meanVtec !== null ? `VTEC: ${stats.meanVtec.toFixed(1)} TECU` : "VTEC: N/A"}
                {stats.meanQual !== null ? ` · Quality: ${stats.meanQual.toFixed(0)}%` : ""}
              </div>
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                PRN {c.prnRange}
              </div>
            </div>
          );
        })}
      </div>

      {/* Tabs */}
      <div className="tabs">
        {([["vtec","VTEC by PRN"],["sky","Sky Plot"],["elev","Elevation vs TEC"],["quality","Quality Analysis"]] as [Tab,string][]).map(([id, label]) => (
          <button key={id} className={`tab${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {loading && <div className="banner banner-info">Loading PRN data…</div>}

      {/* ── VTEC by PRN ── */}
      {tab === "vtec" && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: "0.8rem" }}>VTEC Time Series by Satellite PRN</div>
            {chartDatasets.length > 0 && chartDatasets.some((d) => d.data.some((v) => v > 0)) ? (
              <LineChart
                labels={hourSet.map((h) => String(h))}
                datasets={chartDatasets}
                yLabel="VTEC (TECU)"
                height={340}
              />
            ) : (
              <div className="banner banner-info">No time-series PRN data available. Process RINEX files first.</div>
            )}
            {chartDatasets.length > 0 && (
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
                Time (h) — hour-of-day UTC. Showing up to {prnSet.length} PRNs for {selected}.
              </div>
            )}
          </div>

          {/* Table — always rendered */}
          <div className="card" style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}>
                  <th style={{ padding: "0.4rem 0.7rem", textAlign: "left", width: "48px" }}></th>
                  <th style={{ padding: "0.4rem 0.7rem", textAlign: "left" }}>constellation</th>
                  <th style={{ padding: "0.4rem 0.7rem", textAlign: "left" }}>prn</th>
                  <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>mean_vtec</th>
                  <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>max_vtec</th>
                  <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>mean_stec</th>
                  <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>mean_elev</th>
                  <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>mean_qual</th>
                  <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>obs</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.length > 0 ? filteredRows.map((r, idx) => (
                  <tr key={`${r.prn}-${r.constellation}`} style={{ borderBottom: "1px solid #1a2a3a" }}>
                    <td style={{ padding: "0.35rem 0.7rem", color: "var(--text-muted)" }}>{idx}</td>
                    <td style={{ padding: "0.35rem 0.7rem" }}>{r.constellation}</td>
                    <td style={{ padding: "0.35rem 0.7rem", fontWeight: 700, color: "var(--accent)" }}>{r.prn}</td>
                    <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.mean_vtec?.toFixed(6) ?? ""}</td>
                    <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.max_vtec?.toFixed(6) ?? ""}</td>
                    <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.mean_stec?.toFixed(6) ?? ""}</td>
                    <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.mean_elevation?.toFixed(6) ?? ""}</td>
                    <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.mean_qual?.toFixed(6) ?? ""}</td>
                    <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.samples ?? ""}</td>
                  </tr>
                )) : [0,1,2,3].map((i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #1a2a3a" }}>
                    <td style={{ padding: "0.35rem 0.7rem", color: "var(--text-muted)" }}>{i}</td>
                    {Array(8).fill(null).map((_, j) => (
                      <td key={j} style={{ padding: "0.35rem 0.7rem" }} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Sky Plot ── */}
      {tab === "sky" && !loading && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>Sky Plot — {selected}</div>
          <div className="banner banner-info">Sky plot requires azimuth data from RINEX navigation files. Process full RINEX obs+nav to enable this view.</div>
        </div>
      )}

      {/* ── Elevation vs TEC ── */}
      {tab === "elev" && !loading && (
        <div className="card">
          <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>Elevation vs VTEC — {selected}</div>
          {elevDatasets.some((d) => d.data.some((v) => v > 0)) ? (
            <>
              <LineChart
                labels={elevBins.map((b) => `${b}°`)}
                datasets={elevDatasets}
                yLabel="Mean VTEC (TECU)"
                height={300}
              />
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
                Elevation angle bins (±5°). Higher elevation = lower atmospheric path length = lower STEC.
              </div>
            </>
          ) : (
            <div className="banner banner-info">No elevation data available. Process RINEX files with navigation data.</div>
          )}
        </div>
      )}

      {/* ── Quality Analysis ── */}
      {tab === "quality" && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {filteredRows.length > 0 ? (
            <div className="card">
              <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>Signal Quality by PRN — {selected}</div>
              <LineChart
                labels={filteredRows.map((r) => r.prn)}
                datasets={[
                  { label: "Mean Elevation (°)", data: filteredRows.map((r) => r.mean_elevation ?? 0), color: "#168bd2" },
                  { label: "Mean Quality",        data: filteredRows.map((r) => r.mean_qual ?? 0),     color: "#00ff88" },
                ]}
                yLabel="Value"
                height={300}
              />
            </div>
          ) : (
            <div className="banner banner-info">No quality data for {selected}.</div>
          )}
        </div>
      )}

      {/* Footer */}
      <div style={{ textAlign: "center", fontSize: "0.72rem", color: "var(--text-muted)", borderTop: "1px solid var(--border)", paddingTop: "1rem", marginTop: "0.5rem" }}>
        © 2026 Zimbabwe National Geospatial and Space Agency (ZINGSA) — All rights reserved
      </div>

    </div>
  );
}
