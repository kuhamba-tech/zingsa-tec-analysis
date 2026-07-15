"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import BarChart from "@/components/charts/BarChart";
import LineChart from "@/components/charts/LineChart";
import PrnConstellationPanel from "@/components/prnExplorer/PrnConstellationPanel";
import PrnFilters from "@/components/prnExplorer/PrnFilters";
import PrnSkyPlot from "@/components/prnExplorer/PrnSkyPlot";
import { getPrnConstellations, getPrnExplorer } from "@/lib/api";
import type {
  PrnConstellationInfo,
  PrnConstellationPayload,
  PrnExplorerResponse,
  PrnObservation,
  PrnRow,
} from "@/lib/types";

const PRN_COLORS = [
  "#168bd2", "#ff4444", "#00ff88", "#ff8c00", "#a78bfa",
  "#ffcc00", "#34d399", "#f472b6", "#60a5fa", "#f97316",
];

type Tab = "vtec" | "sky" | "elev" | "quality" | "disturbance";

function matchesConstellation(prn: string, constellation: string): boolean {
  const c = constellation.toLowerCase();
  if (c === "gps") return prn.startsWith("G");
  if (c === "galileo") return prn.startsWith("E");
  if (c === "beidou") return prn.startsWith("C");
  if (c === "glonass") return prn.startsWith("R");
  return true;
}

function formatTsLabel(iso: string, spanHours: number): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  if (spanHours <= 48) {
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit" });
}

function constellationStats(rows: PrnRow[], id: string) {
  const filtered = rows.filter((r) => r.constellation?.toLowerCase() === id.toLowerCase());
  const vtecs = filtered.map((r) => r.mean_vtec ?? 0).filter((v) => v > 0);
  const quals = filtered.map((r) => r.mean_qual ?? 0).filter((v) => v > 0);
  return {
    count: filtered.length,
    meanVtec: vtecs.length ? vtecs.reduce((a, b) => a + b, 0) / vtecs.length : null,
    meanQual: quals.length ? quals.reduce((a, b) => a + b, 0) / quals.length : null,
  };
}

export default function PrnExplorerPage() {
  const [theory, setTheory] = useState<PrnConstellationPayload | null>(null);
  const [data, setData] = useState<PrnExplorerResponse | null>(null);
  const [selected, setSelected] = useState("GPS");
  const [tab, setTab] = useState<Tab>("vtec");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [station, setStation] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [elevMin, setElevMin] = useState(20);
  const [selectedPrns, setSelectedPrns] = useState<string[]>([]);
  const [qualThreshold, setQualThreshold] = useState(70);

  const constellations = theory?.constellations ?? [];

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, string | number> = {
        constellation: selected,
        elev_min: elevMin,
        hours: 168,
        limit: 8000,
      };
      if (station) params.station = station;
      if (start) params.start = start;
      if (end) params.end = end;
      if (selectedPrns.length) params.prns = selectedPrns.join(",");

      const payload = await getPrnExplorer(params);
      setData(payload);
    } catch (e) {
      setError(String(e));
      setData(null);
    }
    setLoading(false);
  }, [selected, station, start, end, elevMin, selectedPrns]);

  useEffect(() => {
    getPrnConstellations().then(setTheory).catch(() => null);
  }, []);

  useEffect(() => {
    load();
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps — constellation change auto-reloads

  const summary = useMemo(
    () => (data?.summary ?? []).filter((r) => matchesConstellation(r.prn, selected)),
    [data?.summary, selected],
  );

  const observations = useMemo(() => {
    let rows = (data?.observations ?? []).filter((o) => matchesConstellation(o.prn, selected));
    if (selectedPrns.length) rows = rows.filter((o) => selectedPrns.includes(o.prn));
    return rows;
  }, [data?.observations, selected, selectedPrns]);

  const activePrns = useMemo(() => {
    const fromObs = [...new Set(observations.map((o) => o.prn))].sort();
    if (fromObs.length) return fromObs;
    return summary.map((r) => r.prn).sort();
  }, [observations, summary]);

  const chartPrns = useMemo(() => {
    const base = selectedPrns.length ? selectedPrns.filter((p) => activePrns.includes(p)) : activePrns;
    return base.slice(0, 9);
  }, [activePrns, selectedPrns]);

  const timeChart = useMemo(() => {
    const pts = observations.filter((o) => o.vtec != null && chartPrns.includes(o.prn));
    if (!pts.length) return null;

    const times = [...new Set(pts.map((o) => o.timestamp))].sort();
    const t0 = new Date(times[0]).getTime();
    const t1 = new Date(times[times.length - 1]).getTime();
    const spanHours = Math.max(1, (t1 - t0) / 3_600_000);

    const labels = times.map((t) => formatTsLabel(t, spanHours));
    const datasets = chartPrns.map((prn, i) => {
      const byTime = new Map(pts.filter((p) => p.prn === prn).map((p) => [p.timestamp, p.vtec]));
      return {
        label: prn,
        data: times.map((t) => byTime.get(t) ?? null),
        color: PRN_COLORS[i % PRN_COLORS.length],
      };
    });
    return { labels, datasets, spanHours };
  }, [observations, chartPrns]);

  const elevBins = useMemo(() => Array.from({ length: 9 }, (_, i) => i * 10 + 5), []);
  const elevDatasets = useMemo(() => {
    return chartPrns.slice(0, 6).map((prn, i) => {
      const prnObs = observations.filter((o) => o.prn === prn && o.elevation_deg != null && o.vtec != null);
      const binned = elevBins.map((bin) => {
        const inBin = prnObs.filter((o) => Math.abs((o.elevation_deg ?? 0) - bin) <= 5);
        if (!inBin.length) return null;
        return inBin.reduce((a, o) => a + (o.vtec ?? 0), 0) / inBin.length;
      });
      return { label: prn, data: binned, color: PRN_COLORS[i % PRN_COLORS.length] };
    });
  }, [observations, chartPrns, elevBins]);

  const stecElevDatasets = useMemo(() => {
    return chartPrns.slice(0, 4).map((prn, i) => {
      const prnObs = observations.filter((o) => o.prn === prn && o.elevation_deg != null && o.stec != null);
      const binned = elevBins.map((bin) => {
        const inBin = prnObs.filter((o) => Math.abs((o.elevation_deg ?? 0) - bin) <= 5);
        if (!inBin.length) return null;
        return inBin.reduce((a, o) => a + (o.stec ?? 0), 0) / inBin.length;
      });
      return { label: `${prn} STEC`, data: binned, color: PRN_COLORS[i % PRN_COLORS.length], dashed: true };
    });
  }, [observations, chartPrns, elevBins]);

  const qualRows = useMemo(
    () => [...summary].sort((a, b) => (a.mean_qual ?? 0) - (b.mean_qual ?? 0)),
    [summary],
  );
  const lowQual = qualRows.filter((r) => (r.mean_qual ?? 100) < qualThreshold);

  const disturbanceRows = useMemo(
    () => [...summary].sort((a, b) => (b.max_roti ?? 0) - (a.max_roti ?? 0)),
    [summary],
  );

  const rotiChart = useMemo(() => {
    const pts = observations.filter((o) => o.roti_tecu_per_min != null && chartPrns.includes(o.prn));
    if (!pts.length) return null;
    const times = [...new Set(pts.map((o) => o.timestamp))].sort();
    const t0 = new Date(times[0]).getTime();
    const t1 = new Date(times[times.length - 1]).getTime();
    const spanHours = Math.max(1, (t1 - t0) / 3_600_000);
    const labels = times.map((t) => formatTsLabel(t, spanHours));
    const datasets = chartPrns.map((prn, i) => {
      const byTime = new Map(pts.filter((p) => p.prn === prn).map((p) => [p.timestamp, p.roti_tecu_per_min]));
      return {
        label: prn,
        data: times.map((t) => byTime.get(t) ?? null),
        color: PRN_COLORS[i % PRN_COLORS.length],
      };
    });
    return { labels, datasets };
  }, [observations, chartPrns]);

  const selectedInfo = constellations.find((c) => c.id === selected) ?? null;
  const cardStats = constellationStats(data?.summary ?? [], selected);
  const meta = data?.meta;
  const hasData = summary.length > 0 || observations.length > 0;

  const sourceLabel =
    meta?.source === "live" ? "Live NTRIP pipeline"
    : meta?.source === "cmn" ? "Processed CMN files"
    : meta?.source === "archive" ? "TEC archive"
    : "No per-PRN source";

  return (
    <div className="page-stack">
      <div>
        <h1 className="page-title">🛸 Satellite PRN Explorer</h1>
        <p className="page-subtitle">
          GPS · Galileo · BeiDou · GLONASS — per-satellite TEC and geometry analysis
        </p>
      </div>

      <div style={{ fontSize: "0.8rem" }}>
        Click a constellation card for{" "}
        <span style={{ color: "var(--accent)", fontWeight: 600 }}>Chapter 4</span>{" "}
        explanation of satellites, VTEC, quality, and PRN range.
      </div>

      <div className="constellation-grid">
        {constellations.map((c: PrnConstellationInfo) => {
          const stats = constellationStats(data?.summary ?? [], c.id);
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
                {stats.meanVtec != null ? `VTEC: ${stats.meanVtec.toFixed(1)} TECU` : "VTEC: N/A"}
                {stats.meanQual != null ? ` · Quality: ${stats.meanQual.toFixed(0)}%` : ""}
              </div>
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>PRN {c.prn_range}</div>
            </div>
          );
        })}
      </div>

      <PrnConstellationPanel info={selectedInfo} stats={cardStats} />

      <PrnFilters
        stations={meta?.stations ?? []}
        prns={activePrns}
        station={station}
        start={start}
        end={end}
        elevMin={elevMin}
        selectedPrns={selectedPrns}
        onStation={setStation}
        onStart={setStart}
        onEnd={setEnd}
        onElevMin={setElevMin}
        onSelectedPrns={setSelectedPrns}
        onRefresh={load}
        loading={loading}
      />

      {meta && (
        <div className="banner banner-info" style={{ fontSize: "0.78rem" }}>
          Data source: <strong>{sourceLabel}</strong>
          {meta.record_count ? ` · ${meta.record_count.toLocaleString()} observations` : ""}
          {meta.time_start && meta.time_end ? ` · ${meta.time_start.slice(0, 16)} → ${meta.time_end.slice(0, 16)} UTC` : ""}
          {theory?.quality_note && tab === "quality" ? ` · ${theory.quality_note}` : ""}
        </div>
      )}

      {error && <div className="banner banner-alert">{error}</div>}
      {loading && <div className="banner banner-info">Loading PRN data…</div>}
      {!loading && !hasData && (
        <div className="banner banner-info">
          {meta?.message ?? "No per-satellite PRN data for these filters. Run the live NTRIP pipeline, process RINEX/CMN in Processing, or set ZGIIS_CMN_SOURCE to a folder of .Cmn files."}
        </div>
      )}

      <div className="tabs">
        {([["vtec", "VTEC by PRN"], ["sky", "Sky Plot"], ["elev", "Elevation vs TEC"], ["quality", "Quality Analysis"], ["disturbance", "GNSS Disturbance"]] as [Tab, string][]).map(([id, label]) => (
          <button key={id} className={`tab${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {tab === "vtec" && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: "0.8rem" }}>VTEC Time Series by Satellite PRN</div>
            {timeChart ? (
              <>
                <LineChart labels={timeChart.labels} datasets={timeChart.datasets} yLabel="VTEC (TECU)" height={340} toggleableLegend />
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
                  Real timestamps (UTC). Showing up to {chartPrns.length} PRN{chartPrns.length === 1 ? "" : "s"} for {selected}.
                </div>
              </>
            ) : (
              <div className="banner banner-info">No time-series PRN data for {selected}. Adjust filters or load per-PRN CMN/live data.</div>
            )}
          </div>

          <div className="card" style={{ overflowX: "auto" }}>
            {summary.length > 0 ? (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", color: "var(--text-muted)" }}>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "left" }}>#</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "left" }}>constellation</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "left" }}>prn</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>mean_vtec</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>max_vtec</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>mean_stec</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>mean_elev</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>mean_qual</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>max_roti</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>slips</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>integrity</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>ppp_min</th>
                    <th style={{ padding: "0.4rem 0.7rem", textAlign: "right" }}>obs</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((r, idx) => (
                    <tr key={`${r.prn}-${r.constellation}`} style={{ borderBottom: "1px solid #1a2a3a" }}>
                      <td style={{ padding: "0.35rem 0.7rem", color: "var(--text-muted)" }}>{idx + 1}</td>
                      <td style={{ padding: "0.35rem 0.7rem" }}>{r.constellation}</td>
                      <td style={{ padding: "0.35rem 0.7rem", fontWeight: 700, color: "var(--accent)" }}>{r.prn}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.mean_vtec?.toFixed(3) ?? "—"}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.max_vtec?.toFixed(3) ?? "—"}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.mean_stec?.toFixed(3) ?? "—"}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.mean_elevation?.toFixed(1) ?? "—"}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.mean_qual?.toFixed(0) ?? "—"}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.max_roti?.toFixed(2) ?? "—"}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.cycle_slip_count ?? "—"}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.integrity_score?.toFixed(0) ?? "—"}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.ppp_convergence_min?.toFixed(0) ?? "—"}</td>
                      <td style={{ padding: "0.35rem 0.7rem", textAlign: "right" }}>{r.samples ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="banner banner-info">No PRN summary rows for {selected}.</div>
            )}
          </div>
        </div>
      )}

      {tab === "sky" && !loading && (
        <div className="card">
          <PrnSkyPlot
            observations={observations}
            prns={chartPrns}
            title={`Sky Plot — ${selected}`}
          />
        </div>
      )}

      {tab === "elev" && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>Vertical TEC vs Elevation — {selected}</div>
            {elevDatasets.some((d) => d.data.some((v) => v != null && v > 0)) ? (
              <>
                <LineChart labels={elevBins.map((b) => `${b}°`)} datasets={elevDatasets} yLabel="Mean VTEC (TECU)" height={300} />
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
                  Elevation bins (±5°). After thin-shell mapping (Eq. 4.17), VTEC should flatten at high elevation.
                  See{" "}
                  <Link href="/vtec-theory" style={{ color: "var(--accent)" }}>Calculating VTEC</Link>
                  {" "}and{" "}
                  <Link href="/understanding-tec" style={{ color: "var(--accent)" }}>Understanding TEC</Link>.
                </div>
              </>
            ) : (
              <div className="banner banner-info">No elevation data for {selected}. Process RINEX/CMN with navigation or use the live pipeline.</div>
            )}
          </div>
          {stecElevDatasets.some((d) => d.data.some((v) => v != null && v > 0)) && (
            <div className="card">
              <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>Slant TEC vs Elevation</div>
              <LineChart labels={elevBins.map((b) => `${b}°`)} datasets={stecElevDatasets} yLabel="Mean STEC (TECU)" height={260} />
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
                Lower elevation → longer slant path → higher STEC (mapping function hyperbola).
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "quality" && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {qualRows.length > 0 ? (
            <>
              <div className="card">
                <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>Arc Quality by PRN — {selected}</div>
                <BarChart
                  labels={qualRows.map((r) => r.prn)}
                  values={qualRows.map((r) => r.mean_qual ?? 0)}
                  yLabel="Arc quality (%)"
                  color="#00ff88"
                  height={Math.max(280, qualRows.length * 22)}
                />
              </div>
              <div className="card">
                <label style={{ fontSize: "0.82rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                  Low-quality threshold: {qualThreshold}%
                  <input type="range" min={50} max={90} step={5} value={qualThreshold} onChange={(e) => setQualThreshold(Number(e.target.value))} />
                </label>
                {lowQual.length > 0 ? (
                  <div className="banner banner-warn" style={{ marginTop: "0.65rem" }}>
                    ⚠ {lowQual.length} satellite{lowQual.length === 1 ? "" : "s"} below {qualThreshold}% quality:{" "}
                    {lowQual.map((r) => r.prn).join(", ")}
                  </div>
                ) : (
                  <div className="banner banner-ok" style={{ marginTop: "0.65rem" }}>
                    ✓ All {selected} satellites above {qualThreshold}% quality threshold.
                  </div>
                )}
              </div>
              <div className="card">
                <LineChart
                  labels={qualRows.map((r) => r.prn)}
                  datasets={[
                    { label: "Mean elevation (°)", data: qualRows.map((r) => r.mean_elevation ?? 0), color: "#168bd2" },
                    { label: "Mean quality (%)", data: qualRows.map((r) => r.mean_qual ?? 0), color: "#00ff88" },
                  ]}
                  yLabel="Value"
                  height={280}
                />
              </div>
            </>
          ) : (
            <div className="banner banner-info">No quality metrics for {selected}. Quality is derived from CNR (live) or S4 (CMN) when available.</div>
          )}
        </div>
      )}

      {tab === "disturbance" && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div className="card">
            <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>ROTI Time Series â€” {selected}</div>
            {rotiChart ? (
              <>
                <LineChart labels={rotiChart.labels} datasets={rotiChart.datasets} yLabel="ROTI (TECU/min)" height={320} toggleableLegend />
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
                  ROTI levels: quiet &lt;0.2, mild 0.2-0.5, moderate 0.5-1.0, strong &gt;1.0 TECU/min.
                </div>
              </>
            ) : (
              <div className="banner banner-info">ROTI needs at least two matched TEC observations per PRN inside a 5-minute window.</div>
            )}
          </div>

          {disturbanceRows.length > 0 ? (
            <>
              <div className="card">
                <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>GNSS Integrity by PRN</div>
                <BarChart
                  labels={disturbanceRows.map((r) => r.prn)}
                  values={disturbanceRows.map((r) => r.integrity_score ?? 0)}
                  yLabel="Integrity score (%)"
                  color="#168bd2"
                  height={Math.max(280, disturbanceRows.length * 22)}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "1rem" }}>
                <div className="card">
                  <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>Inferred Cycle Slips</div>
                  <BarChart
                    labels={disturbanceRows.map((r) => r.prn)}
                    values={disturbanceRows.map((r) => r.cycle_slip_count ?? 0)}
                    yLabel="Events"
                    color="#ff8c00"
                    height={260}
                  />
                </div>
                <div className="card">
                  <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>PPP Convergence Estimate</div>
                  <BarChart
                    labels={disturbanceRows.map((r) => r.prn)}
                    values={disturbanceRows.map((r) => r.ppp_convergence_min ?? 0)}
                    yLabel="Minutes"
                    color="#a78bfa"
                    height={260}
                  />
                </div>
              </div>

              <div className="card">
                <LineChart
                  labels={disturbanceRows.map((r) => r.prn)}
                  datasets={[
                    { label: "Max ROTI", data: disturbanceRows.map((r) => r.max_roti ?? 0), color: "#ff4444" },
                    { label: "S4 / scintillation", data: disturbanceRows.map((r) => (r.max_s4 ?? 0) * 10), color: "#ffcc00" },
                    { label: "Position error (cm)", data: disturbanceRows.map((r) => r.position_error_cm ?? 0), color: "#00ff88" },
                  ]}
                  yLabel="Disturbance metrics"
                  height={280}
                />
              </div>
            </>
          ) : (
            <div className="banner banner-info">No disturbance metrics for {selected}. Load per-PRN live, CMN, or archive observations.</div>
          )}
        </div>
      )}

      <div style={{ textAlign: "center", fontSize: "0.72rem", color: "var(--text-muted)", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
        © 2026 Zimbabwe National Geospatial and Space Agency (ZINGSA) — All rights reserved
      </div>
    </div>
  );
}
