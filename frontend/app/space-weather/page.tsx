"use client";
import { useCallback, useEffect, useState } from "react";
import { getSpaceWeather, getSolarActivity, getTimelines, refreshSpaceWeather } from "@/lib/api";
import LineChart from "@/components/charts/LineChart";
import type { SpaceWeatherCurrent, SolarActivityFull, SpaceWeatherTimelines, TimelinePoint } from "@/lib/types";

// ── Solar Cycle 25 reference ──────────────────────────────────────────────────
const SC25_START = new Date("2019-12-01").getTime();
const SC25_END_EST = new Date("2031-03-01").getTime();
function getSC25Progress(): number {
  return Math.min(100, Math.round(((Date.now() - SC25_START) / (SC25_END_EST - SC25_START)) * 100));
}

// ── Flare class scale ─────────────────────────────────────────────────────────
const FLARE_SCALE = [
  { cls: "A", color: "#22c55e", label: "A-Class",  desc: "Background" },
  { cls: "B", color: "#eab308", label: "B-Class",  desc: "Minor" },
  { cls: "C", color: "#f97316", label: "C-Class",  desc: "Moderate" },
  { cls: "M", color: "#ef4444", label: "M-Class",  desc: "Major" },
  { cls: "X", color: "#a855f7", label: "X-Class",  desc: "Extreme" },
];

function flareColor(cls: string): string {
  const letter = (cls || "A")[0].toUpperCase();
  return FLARE_SCALE.find((f) => f.cls === letter)?.color ?? "#ffffff";
}

// ── KP scale bands ────────────────────────────────────────────────────────────
const KP_BANDS = [
  { range: "0–2", label: "Quiet",          color: "#22c55e" },
  { range: "3",   label: "Unsettled",      color: "#84cc16" },
  { range: "4",   label: "Active",         color: "#eab308" },
  { range: "5",   label: "Minor Storm G1", color: "#f97316" },
  { range: "6",   label: "Moderate G2",    color: "#ef4444" },
  { range: "7",   label: "Strong G3",      color: "#dc2626" },
  { range: "8",   label: "Severe G4",      color: "#991b1b" },
  { range: "9",   label: "Extreme G5",     color: "#a855f7" },
];

// ── Severity color helper ─────────────────────────────────────────────────────
function kpSeverityColor(kp: number | null): string {
  if (kp === null) return "#334155";
  if (kp >= 7) return "#a855f7";
  if (kp >= 5) return "#ef4444";
  if (kp >= 3) return "#f97316";
  return "#22c55e";
}
function dstColor(dst: number | null): string {
  if (dst === null) return "#334155";
  const v = Math.abs(dst);
  if (v >= 200) return "#a855f7";
  if (v >= 100) return "#ef4444";
  if (v >= 50)  return "#f97316";
  if (v >= 30)  return "#eab308";
  return "#22c55e";
}
function f107Color(v: number | null): string {
  if (v === null) return "#334155";
  if (v >= 220) return "#a855f7";
  if (v >= 170) return "#ef4444";
  if (v >= 130) return "#f97316";
  if (v >= 100) return "#eab308";
  return "#22c55e";
}
function windColor(v: number | null): string {
  if (v === null) return "#334155";
  if (v >= 750) return "#a855f7";
  if (v >= 650) return "#ef4444";
  if (v >= 550) return "#f97316";
  if (v >= 450) return "#eab308";
  return "#22c55e";
}
function s4Color(v: number | null): string {
  if (v === null) return "#334155";
  if (v >= 0.7) return "#a855f7";
  if (v >= 0.5) return "#ef4444";
  if (v >= 0.3) return "#f97316";
  if (v >= 0.1) return "#eab308";
  return "#22c55e";
}
function riskColor(risk: string | null): string {
  if (!risk) return "#334155";
  if (risk === "Critical") return "#a855f7";
  if (risk === "High")     return "#ef4444";
  if (risk === "Moderate") return "#f97316";
  return "#22c55e";
}

// ── GNSS Impact ───────────────────────────────────────────────────────────────
function getGnssImpact(kp: number | null, s4: number | null, flare: string, level: string) {
  const k = kp ?? 0;
  const s = s4 ?? 0;
  const fl = (flare || "A")[0].toUpperCase();
  let rtk = "Nominal";
  let ppp = "Normal";
  let iono = "Nominal";
  let hf = "Excellent";
  const scint = s >= 0.5 ? "Severe" : s >= 0.3 ? "Moderate" : s >= 0.1 ? "Weak" : "Low";
  if (k >= 7 || fl === "X") {
    rtk = "Severely degraded"; ppp = "Major delay"; iono = "Major delay"; hf = "Blackout possible";
  } else if (k >= 5 || fl === "M") {
    rtk = "Degraded"; ppp = "Delayed"; iono = "Elevated"; hf = "Disrupted";
  } else if (k >= 3 || fl === "C") {
    rtk = "Minor impact possible"; ppp = "Slightly delayed"; iono = "Slight elevation"; hf = "Fair";
  }
  const cors = level === "Low" && k < 3
    ? "Nominal — sub-centimetre CORS accuracy achievable across Africa"
    : level === "Moderate"
    ? "Minor GNSS impact possible"
    : "Elevated ionospheric activity — monitor CORS accuracy";
  return { rtk, ppp, iono, scint, hf, cors };
}

// ── Sub-components ────────────────────────────────────────────────────────────
function SWCard({
  icon, label, value, sub, unit, barColor, barPct,
}: {
  icon: string; label: string; value: string | null; sub?: string;
  unit?: string; barColor?: string; barPct?: number;
}) {
  return (
    <div className="card" style={{ textAlign: "center", padding: "1rem 0.8rem 0", position: "relative", overflow: "hidden", display: "flex", flexDirection: "column", justifyContent: "space-between", minHeight: "120px" }}>
      <div>
        <div style={{ fontSize: "1.4rem", marginBottom: "0.2rem" }}>{icon}</div>
        <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.3rem" }}>{label}</div>
        <div style={{ fontSize: "1.5rem", fontWeight: 800, lineHeight: 1.1, marginBottom: "0.2rem" }}>
          {value ?? "N/A"}{value && unit ? <span style={{ fontSize: "0.75rem", fontWeight: 400, marginLeft: "3px" }}>{unit}</span> : null}
        </div>
        {sub && <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginBottom: "0.7rem" }}>{sub}</div>}
      </div>
      <div style={{ height: "4px", background: barColor ?? "#334155", borderRadius: "0 0 2px 2px", width: `${barPct ?? 100}%`, marginTop: "auto" }} />
    </div>
  );
}

function TimelineCard({
  title, pts, color, yLabel, threshold, source, emptyMsg,
}: {
  title: string; pts: TimelinePoint[]; color: string; yLabel: string;
  threshold?: { value: number; label: string }; source: string; emptyMsg?: string;
}) {
  const labels = pts.map((p) => p.t.length >= 16 ? p.t.slice(11, 16) : p.t.slice(0, 13));
  const data = pts.map((p) => p.v ?? 0);
  return (
    <div className="card">
      <div className="metric-label" style={{ marginBottom: "0.6rem" }}>{title}</div>
      {pts.length > 0 ? (
        <>
          <LineChart labels={labels} datasets={[{ label: yLabel, data, color }]} yLabel={yLabel} height={220} threshold={threshold} />
          <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
            {source} · {pts.length} points.
          </div>
        </>
      ) : (
        <div className="banner banner-warn">{emptyMsg ?? "Live data unavailable."}</div>
      )}
    </div>
  );
}

function DataTable({ headers, rows, emptyMsg }: { headers: string[]; rows: string[][]; emptyMsg?: string }) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
        <thead>
          <tr style={{ borderBottom: "1px solid var(--border)" }}>
            {headers.map((h) => (
              <th key={h} style={{ padding: "0.4rem 0.6rem", textAlign: "left", color: "var(--text-muted)", fontWeight: 700, fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length > 0 ? rows.map((row, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #1a2a3a" }}>
              {row.map((cell, j) => (
                <td key={j} style={{ padding: "0.35rem 0.6rem", verticalAlign: "top" }}>{cell}</td>
              ))}
            </tr>
          )) : (
            <tr>
              <td colSpan={headers.length} style={{ padding: "0.8rem 0.6rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                {emptyMsg ?? "No data."}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function SpaceWeatherPage() {
  const [sw, setSw]         = useState<SpaceWeatherCurrent | null>(null);
  const [sa, setSa]         = useState<SolarActivityFull | null>(null);
  const [tl, setTl]         = useState<SpaceWeatherTimelines | null>(null);
  const [tab, setTab]       = useState(0);
  const [xrayRange, setXrayRange] = useState<"6H" | "24H">("24H");
  const [refreshing, setRefreshing] = useState(false);
  const [nowCat, setNowCat] = useState("");

  useEffect(() => {
    const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const fmt = () => {
      const cat = new Date(Date.now() + 2 * 3600 * 1000);
      const d   = cat.getUTCDate();
      const mon = MONTHS[cat.getUTCMonth()];
      const yr  = cat.getUTCFullYear();
      const hh  = String(cat.getUTCHours()).padStart(2, "0");
      const mm  = String(cat.getUTCMinutes()).padStart(2, "0");
      setNowCat(`${d} ${mon} ${yr}, ${hh}:${mm} CAT (UTC+2)`);
    };
    fmt();
    const id = setInterval(fmt, 30000);
    return () => clearInterval(id);
  }, []);

  const fetchAll = useCallback(() => {
    Promise.all([getSpaceWeather(), getSolarActivity(), getTimelines()])
      .then(([s, a, t]) => { setSw(s); setSa(a); setTl(t); })
      .catch(() => {});
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try { await refreshSpaceWeather(); } catch { /* ignore */ }
    fetchAll();
    setRefreshing(false);
  };

  // ── Derived values ────────────────────────────────────────────────────────
  const kp    = sw?.kp ?? null;
  const dst   = sw?.dst ?? null;
  const f107  = sw?.f107 ?? null;
  const wind  = sw?.plasma_speed ?? sa?.solar_wind?.speed ?? null;
  const s4    = sw?.s4 ?? null;
  const risk  = sw?.gnss_risk ?? null;

  const flareClass   = sa?.flare_class ?? "N/A";
  const actLabel     = sa?.activity_label ?? "Low";
  const actColor     = sa?.activity_color ?? "#22c55e";
  const apiRoutes    = Array.isArray(sa?.api_routes) ? sa.api_routes : [];
  const alerts       = Array.isArray(sa?.alerts) ? sa.alerts : [];
  const donkiFlares  = Array.isArray(sa?.donki_flares) ? sa.donki_flares : [];
  const donkiCmes    = Array.isArray(sa?.donki_cmes) ? sa.donki_cmes : [];
  const donkiStorms  = Array.isArray(sa?.donki_storms) ? sa.donki_storms : [];
  const alertCount   = alerts.length;

  const conditionLabel   = kp !== null && kp >= 5 ? "Storm Active" : kp !== null && kp >= 3 ? "Disturbed" : "Quiet";
  const conditionVariant = kp !== null && kp >= 5 ? "alert" : kp !== null && kp >= 3 ? "warn" : "info";

  // ── X-Ray series for charts ───────────────────────────────────────────────
  const xrayRaw = sa?.xray_series ?? [];
  // multiply by 1e7 for readability (so "0" becomes 0.00 not "5e-8")
  const xrayScaled = xrayRaw.map((v) => parseFloat((v * 1e7).toFixed(3)));
  const xraySlice = xrayRange === "6H" ? xrayScaled.slice(-9) : xrayScaled;
  const xrayLabelCount = xraySlice.length;
  const xrayLabels = Array.from({ length: xrayLabelCount }, (_, i) => {
    const minsAgo = (xrayLabelCount - 1 - i) * (xrayRange === "6H" ? 40 : 40);
    return minsAgo === 0 ? "now" : `-${Math.round(minsAgo / 60)}h`;
  });

  // ── GNSS Impact ───────────────────────────────────────────────────────────
  const impact = getGnssImpact(kp, s4, flareClass, actLabel);

  // ── Solar Cycle 25 ────────────────────────────────────────────────────────
  const sc25Progress = getSC25Progress();

  // ── Pre-processed table rows ──────────────────────────────────────────────
  const activeRegionRows = (Array.isArray(sa?.active_regions) ? sa.active_regions : []).map((r) => [
    String(r.id ?? "—"), String(r.cls ?? "—"), String(r.mag ?? "—"), String(r.spots ?? "0"),
  ]);
  const cmeTableRows = (Array.isArray(sa?.cme_rows) ? sa.cme_rows : []).map((r) => [
    String(r.date ?? "—"), String(r.speed ?? "—"), String(r.width ?? "—"),
    String(r.halo ?? "—"), String(r.impact ?? "—"),
  ]);
  const radioBurstRows = (Array.isArray(sa?.radio_burst_rows) ? sa.radio_burst_rows : []).map((r) => [
    String(r.time ?? "—"), String(r.type ?? "—"), String(r.freq ?? "—"),
    String(r.intensity ?? "—"), String(r.loc ?? "—"),
  ]);

  const dateRange = sa?.donki_date_start && sa?.donki_date_end
    ? `${sa.donki_date_start} – ${sa.donki_date_end}`
    : "";

  // ── Alert text ────────────────────────────────────────────────────────────
  const latestAlert = alerts[0] as Record<string, string> | undefined;
  const alertMsg    = latestAlert?.message ?? latestAlert?.product_id ?? null;
  const alertTime   = latestAlert?.issue_datetime ?? null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>

      {/* ── Title ── */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">☀️ Space Weather Monitoring</h1>
          <p className="page-subtitle">Real-time solar and geomagnetic indices — NOAA SWPC data feed</p>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.3rem" }}>
            Click a card for an explanation of what the value means.
          </p>
        </div>
        <button className="btn" onClick={handleRefresh} disabled={refreshing} style={{ flexShrink: 0, marginTop: "0.3rem" }}>
          {refreshing ? "Refreshing…" : "⟳ Refresh"}
        </button>
      </div>

      {/* ── Status bar ── */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.7rem", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", flexWrap: "wrap" }}>
        <span className="dot dot-ok" />
        <span>Live Space Weather</span>
        <span style={{ color: "var(--border)" }}>·</span>
        <span>Zimbabwe CORS Network</span>
        <span style={{ color: "var(--border)" }}>·</span>
        <span className="dot dot-ok" />
        <span>Live</span>
        {sw?.updated_utc && (
          <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, marginLeft: "auto", color: "var(--text-muted)", fontSize: "0.72rem" }}>
            Updated {sw.updated_utc.slice(0, 16).replace("T", " ")} UTC
          </span>
        )}
      </div>

      {/* ── 8 Metric Cards ── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.8rem" }}>
        <SWCard icon="🌍" label="Kp Index"        value={kp?.toFixed(1) ?? null}                                               sub="Planetary activity"        unit=""    barColor={kpSeverityColor(kp)}  barPct={kp !== null ? Math.min(100, (kp / 9) * 100) : 0} />
        <SWCard icon="🧲" label="Geomagnetic"      value={sw?.kp_condition ?? null}                                             sub="Current state"             unit=""    barColor={sw?.kp_color ?? undefined} barPct={kp !== null ? Math.min(100, (kp / 9) * 100) : 0} />
        <SWCard icon="🌡️" label="Dst Index"        value={dst !== null ? `${dst} nT` : null}                                   sub="Storm index"               unit=""    barColor={dstColor(dst)}  barPct={dst !== null ? Math.min(100, (Math.abs(dst) / 400) * 100) : 0} />
        <SWCard icon="☀️" label="Solar Flux"       value={f107?.toFixed(1) ?? null}                                             sub="Solar flux units"          unit="sfu" barColor={f107Color(f107)} barPct={f107 !== null ? Math.min(100, ((f107 - 65) / 235) * 100) : 0} />
        <SWCard icon="💨" label="Solar Wind"       value={wind?.toFixed(0) ?? null}                                             sub="Solar wind speed"          unit="km/s" barColor={windColor(wind)} barPct={wind !== null ? Math.min(100, ((wind - 250) / 650) * 100) : 0} />
        <SWCard icon="〰️" label="Scintillation S4" value={s4?.toFixed(2) ?? null}                                               sub="Observed archive"          unit=""    barColor={s4Color(s4)}    barPct={s4 !== null ? Math.min(100, s4 * 100) : 0} />
        <SWCard icon="🛰️" label="GNSS Risk"        value={risk ?? null}                                                          sub="Navigation impact"         unit=""    barColor={sw?.gnss_risk_color ?? riskColor(risk)} barPct={risk === "Critical" ? 100 : risk === "High" ? 75 : risk === "Moderate" ? 50 : 20} />
        <SWCard icon="📡" label="Stations Online"  value={sw?.stations_total ? `${sw.stations_online ?? 0}/${sw.stations_total}` : "N/A"} sub="Live telemetry" unit="" barColor="#334155" barPct={sw?.stations_total ? ((sw.stations_online ?? 0) / sw.stations_total) * 100 : 0} />
      </div>

      {/* ── Solar Activity Monitor section ── */}
      <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
        {/* Section header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "10px", padding: "0.7rem 1.1rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1rem" }}>⚡</span>
            <span style={{ fontWeight: 800, fontSize: "0.85rem", letterSpacing: "0.1em", textTransform: "uppercase" }}>Solar Activity Monitor</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.72rem", color: "var(--text-muted)" }}>
            <span className="dot dot-ok" style={{ width: "7px", height: "7px" }} />
            <span>Live Data · NOAA SWPC · {nowCat}</span>
          </div>
        </div>

        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", fontSize: "0.72rem", color: "var(--text-muted)", paddingLeft: "0.2rem" }}>
          <span style={{ fontWeight: 600, color: "var(--text)" }}>Real-time solar conditions for GNSS, satellites and CORS networks</span>
          <span>·</span>
          {apiRoutes.length > 0 && (
            <span style={{ fontStyle: "italic" }}>API: {apiRoutes.join(" | ")}</span>
          )}
          {sa?.donki_note && (
            <span>· {sa.donki_note}</span>
          )}
        </div>

        {/* Row 1: Solar Summary | Flare card | X-Ray chart */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.8rem" }}>

          {/* Solar Activity Summary */}
          <div className="card" style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: "0.7rem" }}>
            {/* Sun SVG */}
            <div style={{ position: "relative", width: "70px", height: "70px", marginTop: "0.2rem" }}>
              <svg viewBox="0 0 70 70" style={{ width: "70px", height: "70px" }}>
                {/* Rays */}
                {Array.from({ length: 8 }, (_, i) => {
                  const angle = (i * 45 * Math.PI) / 180;
                  const x1 = 35 + 26 * Math.cos(angle);
                  const y1 = 35 + 26 * Math.sin(angle);
                  const x2 = 35 + 32 * Math.cos(angle);
                  const y2 = 35 + 32 * Math.sin(angle);
                  return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#ffcc00" strokeWidth="2.5" strokeLinecap="round" />;
                })}
                <circle cx="35" cy="35" r="20" fill="#ffcc00" opacity="0.95" />
              </svg>
            </div>
            <div style={{ width: "100%" }}>
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginBottom: "0.25rem" }}>Solar Activity</div>
              <div style={{ fontWeight: 800, fontSize: "1.1rem", color: actColor }}>{actLabel}</div>
            </div>
            <div style={{ width: "100%", borderTop: "1px solid var(--border)", paddingTop: "0.6rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem" }}>
                <span style={{ color: "var(--text-muted)" }}>Current Flare</span>
                <span style={{ fontWeight: 700, color: flareColor(flareClass) }}>{flareClass}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.78rem" }}>
                <span style={{ color: "var(--text-muted)" }}>SWPC Alerts</span>
                <span style={{ fontWeight: 700 }}>{alertCount > 0 ? alertCount : "None"}</span>
              </div>
            </div>
          </div>

          {/* Solar Flare (GOES X-Ray) */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Solar Flare (GOES X-Ray)</div>
            <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>Current class:</div>
            <div style={{ fontSize: "2.4rem", fontWeight: 900, lineHeight: 1, color: flareColor(flareClass), marginBottom: "0.3rem" }}>
              {flareClass}
            </div>
            {sa?.flux !== null && sa?.flux !== undefined && (
              <div style={{ fontSize: "0.7rem", color: "var(--text-muted)" }}>
                Flux: {sa.flux.toExponential(2)} W/m²
              </div>
            )}
            {/* Flare class scale */}
            <div style={{ marginTop: "auto", borderTop: "1px solid var(--border)", paddingTop: "0.6rem" }}>
              <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                {FLARE_SCALE.map((f) => (
                  <div key={f.cls} style={{ flex: 1, minWidth: "40px", textAlign: "center" }}>
                    <div style={{ width: "100%", height: "3px", background: f.color, borderRadius: "2px", marginBottom: "3px" }} />
                    <div style={{ fontSize: "0.6rem", fontWeight: 700, color: f.color }}>{f.label.split("-")[0]}-</div>
                    <div style={{ fontSize: "0.58rem", color: "var(--text-muted)" }}>{f.desc}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* GOES X-Ray Flux chart */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>GOES X-Ray Flux — Last Day</div>
            {xraySlice.length > 0 ? (
              <>
                <LineChart
                  labels={xrayLabels}
                  datasets={[{ label: "X-Ray Flux (×10⁻⁷ W/m²)", data: xraySlice, color: "#f97316" }]}
                  yLabel="Flux ×10⁻⁷"
                  height={150}
                />
                <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>
                  0.1–0.8 nm band · Source: NOAA SWPC GOES primary
                </div>
              </>
            ) : (
              <div className="banner banner-info" style={{ fontSize: "0.75rem" }}>X-ray flux data unavailable.</div>
            )}
          </div>
        </div>

        {/* Row 2: Solar Wind | Alerts | Flares count */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.8rem" }}>

          {/* Solar Wind */}
          <div className="card">
            <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.8rem" }}>Solar Wind</div>
            {[
              { icon: "🌀", label: "Speed",       val: sa?.solar_wind?.speed,       unit: "km/s",   fmt: (v: number) => v.toFixed(0) },
              { icon: "🔵", label: "Density",     val: sa?.solar_wind?.density,     unit: "p/cm³",  fmt: (v: number) => v.toFixed(1) },
              { icon: "🌡️", label: "Proton Temp.", val: sa?.solar_wind?.temperature, unit: "K",      fmt: (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
              { icon: "↕️", label: "IMF Bz",      val: sa?.solar_wind?.bz,          unit: "nT",     fmt: (v: number) => v.toFixed(1) },
              { icon: "🔵", label: "IMF Bt",      val: sa?.solar_wind?.bt,          unit: "nT",     fmt: (v: number) => v.toFixed(1) },
            ].map(({ icon, label, val, unit, fmt }) => {
              const display = val !== null && val !== undefined && val !== 0 ? fmt(val as number) : null;
              return (
                <div key={label} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.3rem 0", borderBottom: "1px solid #1a2a3a", fontSize: "0.8rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>{icon} {label}</span>
                  <span style={{ fontWeight: 700 }}>
                    {display ? `${display} ${unit}` : "N/A"}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Alerts / Watches / Warnings */}
          <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.2rem" }}>
              <span className="dot dot-ok" style={{ width: "7px", height: "7px", flexShrink: 0 }} />
              <span style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>
                Alerts / Watches / Warnings
              </span>
            </div>
            {alertMsg ? (
              <>
                {alertTime && (
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>{alertTime.slice(0, 16).replace("T", " ")} UTC</div>
                )}
                <div style={{ fontSize: "0.75rem", lineHeight: 1.5, overflowY: "auto", maxHeight: "140px", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {alertMsg.length > 400 ? alertMsg.slice(0, 400) + "…" : alertMsg}
                </div>
                {alertCount > 1 && (
                  <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>+{alertCount - 1} more alert(s)</div>
                )}
                <div style={{ fontSize: "0.62rem", color: "var(--text-muted)", marginTop: "auto" }}>Source: NOAA SWPC alerts.json</div>
              </>
            ) : (
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", fontStyle: "italic" }}>
                {sa?.mode === "unavailable" ? "NOAA alerts feed unavailable." : "No current NOAA SWPC alerts."}
              </div>
            )}
          </div>

          {/* Solar Flares count */}
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.6rem" }}>Solar Flares</div>
            <div style={{ fontSize: "3rem", fontWeight: 900, lineHeight: 1, marginBottom: "0.4rem" }}>{sa ? donkiFlares.length : "N/A"}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {donkiFlares.length === 0
                ? `No flare events in the selected 7-day window.`
                : `Flare event(s) detected.`}
            </div>
            {dateRange && <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>FLR: {dateRange}</div>}
            {sa?.donki_status === "unavailable" && (
              <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.3rem", fontStyle: "italic" }}>{sa.donki_note}</div>
            )}
          </div>
        </div>

        {/* Row 3: CME | Geomagnetic Storms | GNSS Impact */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.8rem" }}>

          {/* CME count */}
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.6rem" }}>Coronal Mass Ejections</div>
            <div style={{ fontSize: "3rem", fontWeight: 900, lineHeight: 1, marginBottom: "0.4rem" }}>{sa ? donkiCmes.length : "N/A"}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {donkiCmes.length === 0 ? "No CME events in the selected 7-day window." : "CME event(s) detected."}
            </div>
            {dateRange && <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>CME event history · {dateRange}</div>}
          </div>

          {/* Geomagnetic Storms count */}
          <div className="card" style={{ textAlign: "center" }}>
            <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.6rem" }}>Geomagnetic Storms</div>
            <div style={{ fontSize: "3rem", fontWeight: 900, lineHeight: 1, marginBottom: "0.4rem" }}>{sa ? donkiStorms.length : "N/A"}</div>
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              {donkiStorms.length === 0 ? "No geomagnetic storm events in the selected 7-day window." : "Storm event(s) detected."}
            </div>
            {dateRange && <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>GST event history · {dateRange}</div>}
          </div>

          {/* Impact on GNSS & CORS Networks (compact) */}
          <div className="card">
            <div style={{ fontSize: "0.62rem", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: "0.7rem" }}>Impact on GNSS &amp; CORS Networks</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.5rem" }}>
              {[
                { label: "GNSS / CORS",  val: impact.rtk },
                { label: "HF Radio",     val: impact.hf },
                { label: "Satellites",   val: "Routine ops" },
                { label: "Power Grids",  val: kp !== null && kp >= 7 ? "GIC risk" : "Minimal GIC" },
              ].map(({ label, val }) => (
                <div key={label} style={{ background: "#0a1929", borderRadius: "6px", padding: "0.4rem 0.6rem" }}>
                  <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", marginBottom: "2px" }}>{label}</div>
                  <div style={{ fontSize: "0.72rem", fontWeight: 600 }}>{val}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Condition banner ── */}
      <div className={`banner banner-${conditionVariant}`}>
        <strong>Current condition: {conditionLabel}</strong>
        {risk && risk !== "Low" && (
          <div style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>
            GNSS risk is {risk} — ionospheric conditions may affect positioning accuracy over Zimbabwe.
          </div>
        )}
        {(!sw?.stations_online || sw.stations_online === 0) && (
          <div style={{ marginTop: "0.25rem", fontSize: "0.8rem" }}>
            Production CORS API reports zero live telemetry; archive/catalog statuses are not presented as live station availability.
          </div>
        )}
      </div>

      {/* ── Tabs ── */}
      <div className="tabs">
        {["Live Metric Timelines", "Solar Activity", "Kp Scale"].map((t, i) => (
          <button key={t} className={`tab${tab === i ? " active" : ""}`} onClick={() => setTab(i)}>{t}</button>
        ))}
      </div>

      {/* ── Tab 0: Timelines ── */}
      {tab === 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          <p style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>Real-time NOAA feeds and derived indices — last 6 hours (UTC)</p>

          <TimelineCard title="Live NOAA Kp Timeline"
            pts={tl?.kp ?? []} color="#168bd2" yLabel="Kp Index"
            threshold={{ value: 5, label: "Storm threshold (5)" }}
            source="NOAA SWPC Planetary K-index 1-minute feed"
            emptyMsg="Live NOAA Kp feed unavailable." />

          <TimelineCard title="Live NOAA Dst Timeline"
            pts={tl?.dst ?? []} color="#a78bfa" yLabel="Dst (nT)"
            threshold={{ value: -50, label: "Storm threshold (−50 nT)" }}
            source="NOAA SWPC Kyoto Dst index (hourly)"
            emptyMsg="Live NOAA Dst feed unavailable." />

          <TimelineCard title="Live NOAA F10.7 Solar Flux Timeline"
            pts={tl?.f107 ?? []} color="#ffcc00" yLabel="F10.7 (sfu)"
            threshold={{ value: 150, label: "High activity (150 sfu)" }}
            source="NOAA SWPC F10.7 cm flux feed"
            emptyMsg="Live NOAA F10.7 feed unavailable." />

          <TimelineCard title="Live NOAA Solar Wind Timeline"
            pts={tl?.solar_wind ?? []} color="#00cc88" yLabel="Speed (km/s)"
            threshold={{ value: 500, label: "Fast stream (500 km/s)" }}
            source="NOAA SWPC solar-wind plasma 1-day feed"
            emptyMsg="Live solar wind feed unavailable." />

          <TimelineCard title="Live Scintillation S4 Timeline"
            pts={tl?.s4 ?? []} color="#ff8c00" yLabel="S4 Index"
            threshold={{ value: 0.5, label: "Severe scintillation (0.5)" }}
            source="ZINGSA CORS ionosphere archive"
            emptyMsg="No observed S4 archive value is available for the timeline." />

          <TimelineCard title="GNSS Risk Level Timeline"
            pts={tl?.gnss_risk ?? []} color="#168bd2" yLabel="Risk level"
            threshold={{ value: 2, label: "High risk (2)" }}
            source="Derived from NOAA Kp — ZINGSA GNSS risk thresholds"
            emptyMsg="GNSS risk timeline unavailable." />

          {(tl?.stations_online ?? []).length > 0 ? (
            <TimelineCard title="Live CORS Stations Online Timeline"
              pts={tl!.stations_online} color="#00ff88" yLabel="Stations online"
              source="ZINGSA CORS station-health — current live count"
              emptyMsg="Live CORS telemetry unavailable." />
          ) : (
            <div className="card">
              <div className="metric-label" style={{ marginBottom: "0.6rem" }}>Live CORS Stations Online Timeline</div>
              <div className="banner banner-info">Live CORS telemetry is unavailable — no station count timeline.</div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab 1: Solar Activity (detailed) ── */}
      {tab === 1 && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

          {/* NOAA SWPC status bar */}
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.8rem", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "8px", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase" }}>
            <span className="dot dot-ok" style={{ width: "7px", height: "7px" }} />
            <span>NOAA SWPC Live</span>
            {sa?.donki_note && (
              <>
                <span style={{ color: "var(--border)" }}>·</span>
                <span style={{ fontWeight: 400, textTransform: "none", color: "var(--text-muted)" }}>{sa.donki_note}</span>
              </>
            )}
          </div>

          {/* GOES X-Ray Flux chart */}
          <div className="card">
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.7rem", flexWrap: "wrap", gap: "0.5rem" }}>
              <div className="metric-label">SOLAR X-RAY FLUX (GOES-16) · 0.1–0.8 nm</div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                {(["6H", "24H"] as const).map((r) => (
                  <button key={r} onClick={() => setXrayRange(r)}
                    style={{ padding: "0.2rem 0.7rem", fontSize: "0.72rem", fontWeight: 700, borderRadius: "5px", border: `1px solid ${xrayRange === r ? "var(--accent)" : "var(--border)"}`, background: xrayRange === r ? "var(--accent)" : "var(--surface)", color: "#fff", cursor: "pointer" }}>
                    {r}
                  </button>
                ))}
              </div>
            </div>
            {xraySlice.length > 0 ? (
              <>
                <LineChart
                  labels={xrayLabels}
                  datasets={[{ label: "0.1–0.8 nm X-Ray Flux (×10⁻⁷ W/m²)", data: xraySlice, color: "#60a5fa" }]}
                  yLabel="Flux ×10⁻⁷ W/m²"
                  height={240}
                />
                {/* Flare class reference lines */}
                <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", marginTop: "0.6rem", fontSize: "0.65rem" }}>
                  {FLARE_SCALE.map((f) => (
                    <span key={f.cls} style={{ display: "flex", alignItems: "center", gap: "3px" }}>
                      <span style={{ display: "inline-block", width: "10px", height: "3px", background: f.color, borderRadius: "2px" }} />
                      {f.label}
                    </span>
                  ))}
                </div>
              </>
            ) : (
              <div className="banner banner-info">GOES X-ray flux data unavailable — NOAA SWPC feed offline or rate-limited.</div>
            )}
          </div>

          {/* Active Regions + CME table side by side */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.8rem" }}>
            <div className="card">
              <div style={{ display: "flex", gap: "0.7rem", alignItems: "center", marginBottom: "0.7rem" }}>
                {/* Mini sun icon */}
                <svg viewBox="0 0 32 32" width="28" height="28" style={{ flexShrink: 0 }}>
                  {Array.from({ length: 8 }, (_, i) => {
                    const a = (i * 45 * Math.PI) / 180;
                    return <line key={i} x1={16 + 11 * Math.cos(a)} y1={16 + 11 * Math.sin(a)} x2={16 + 14 * Math.cos(a)} y2={16 + 14 * Math.sin(a)} stroke="#f97316" strokeWidth="1.5" strokeLinecap="round" />;
                  })}
                  <circle cx="16" cy="16" r="8" fill="#f97316" />
                </svg>
                <div className="metric-label">Active Regions</div>
              </div>
              <DataTable
                headers={["REGION", "CLASS", "MAG.TYPE", "SPOTS"]}
                rows={activeRegionRows}
                emptyMsg={sa?.donki_status === "unavailable" ? "NASA DONKI unavailable." : "No DONKI flare regions in the last 7 days."}
              />
              {sa?.donki_date_start && (
                <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>NASA DONKI Flares · {dateRange}</div>
              )}
            </div>

            <div className="card">
              <div className="metric-label" style={{ marginBottom: "0.7rem" }}>Coronal Mass Ejections (CME)</div>
              <DataTable
                headers={["DATE (UTC)", "SPEED (KM/S)", "WIDTH", "HALO", "IMPACT"]}
                rows={cmeTableRows}
                emptyMsg={sa?.donki_status === "unavailable" ? "NASA DONKI unavailable." : "No DONKI CME events in the last 7 days."}
              />
              {sa?.donki_date_start && (
                <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>NASA DONKI CME · {dateRange}</div>
              )}
            </div>
          </div>

          {/* Solar Radio Bursts */}
          <div className="card">
            <div className="metric-label" style={{ marginBottom: "0.7rem" }}>Solar Radio Bursts (Last 24H)</div>
            <DataTable
              headers={["TIME (UTC)", "TYPE", "FREQUENCY", "INTENSITY", "LOCATION"]}
              rows={radioBurstRows}
              emptyMsg={sa?.donki_status === "unavailable" ? "NASA DONKI unavailable." : "No flare-derived radio burst proxies in the last 7 days."}
            />
            <div style={{ fontSize: "0.65rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>NOAA GOES X-ray · Proxy from DONKI FLR events</div>
          </div>

          {/* Solar Cycle Progress */}
          <div className="card">
            <div className="metric-label" style={{ marginBottom: "0.8rem" }}>Solar Cycle Progress</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", alignItems: "center" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>Solar Cycle</span>
                  <span style={{ fontWeight: 800 }}>25</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.8rem" }}>
                  <span style={{ color: "var(--text-muted)" }}>Cycle Progress</span>
                  <span style={{ fontWeight: 800, color: "#f97316" }}>{sc25Progress}%</span>
                </div>
                {/* Progress bar */}
                <div style={{ height: "10px", background: "#1a2a3a", borderRadius: "5px", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${sc25Progress}%`, background: "linear-gradient(90deg, #22c55e, #eab308, #f97316)", borderRadius: "5px", transition: "width 0.5s" }} />
                </div>
                <div style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>Estimated Peak: 2024–2026 (Cycle 25 maximum window)</div>
              </div>
              <div style={{ fontSize: "0.72rem", color: "var(--text-muted)", lineHeight: 1.7 }}>
                <div>Start: December 2019</div>
                <div>Predicted end: ~2031</div>
                <div style={{ marginTop: "0.4rem", fontStyle: "italic" }}>Reference cycle window; no synthetic observation values are displayed.</div>
              </div>
            </div>
          </div>

          {/* Impact on GNSS & CORS Networks (detailed row) */}
          <div className="card">
            <div className="metric-label" style={{ marginBottom: "0.8rem" }}>Impact on GNSS &amp; CORS Networks</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.6rem", marginBottom: "0.5rem" }}>
              {[
                { label: "RTK Accuracy",        val: impact.rtk },
                { label: "PPP Convergence",     val: impact.ppp },
                { label: "Ionospheric Delay",   val: impact.iono },
                { label: "Signal Scintillation",val: impact.scint },
                { label: "HF Communication",    val: impact.hf },
              ].map(({ label, val }) => (
                <div key={label} style={{ background: "#0a1929", borderRadius: "7px", padding: "0.5rem 0.7rem" }}>
                  <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", marginBottom: "3px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
                  <div style={{ fontSize: "0.78rem", fontWeight: 600 }}>{val}</div>
                </div>
              ))}
            </div>
            {/* Africa CORS spanning full row */}
            <div style={{ background: "#0a1929", borderRadius: "7px", padding: "0.5rem 0.7rem" }}>
              <div style={{ fontSize: "0.6rem", color: "var(--text-muted)", marginBottom: "3px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>Africa CORS (ZINGSA API)</div>
              <div style={{ fontSize: "0.78rem", fontWeight: 600 }}>{impact.cors}</div>
            </div>
          </div>

          {/* Solar Activity Levels legend */}
          <div className="card">
            <div className="metric-label" style={{ marginBottom: "0.7rem" }}>Solar Activity Levels</div>
            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
              {[
                { label: "Low",      color: "#22c55e", desc: "Minimal impact" },
                { label: "Moderate", color: "#eab308", desc: "Minor impact" },
                { label: "High",     color: "#f97316", desc: "Strong impact" },
                { label: "Severe",   color: "#ef4444", desc: "Major impact" },
                { label: "Extreme",  color: "#a855f7", desc: "Extreme impact" },
              ].map(({ label, color, desc }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.5rem", background: "#0a1929", borderRadius: "8px", padding: "0.45rem 0.8rem", flex: "1 1 100px" }}>
                  <span style={{ display: "inline-block", width: "10px", height: "10px", borderRadius: "50%", background: color, flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: "0.75rem", fontWeight: 700, color }}>{label}</div>
                    <div style={{ fontSize: "0.65rem", color: "var(--text-muted)" }}>{desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>
      )}

      {/* ── Tab 2: Kp Scale ── */}
      {tab === 2 && (
        <div className="card">
          <div className="metric-label" style={{ marginBottom: "0.8rem" }}>Kp Geomagnetic Scale Reference</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            {KP_BANDS.map(({ range, label, color }) => (
              <div key={range} style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
                <div style={{ width: "60px", height: "24px", background: color, borderRadius: "4px", flexShrink: 0 }} />
                <span style={{ fontWeight: 700, width: "40px", flexShrink: 0 }}>{range}</span>
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}
