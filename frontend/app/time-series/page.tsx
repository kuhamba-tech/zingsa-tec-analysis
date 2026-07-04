"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { getArchiveMeta, getTimeSeries, getDiurnal, getSeasonal, getSolarCycle, getOmniAnalysis, getCelestrakAnalysis, getGfzKpAnalysis, getWdcKyotoAnalysis, getIntermagnetAnalysis } from "@/lib/api";
import LineChart from "@/components/charts/LineChart";
import BarChart from "@/components/charts/BarChart";
import GeomagneticAnalysisPanel from "@/components/timeSeries/GeomagneticAnalysisPanel";
import CelestrakAnalysisPanel from "@/components/timeSeries/CelestrakAnalysisPanel";
import GfzKpAnalysisPanel from "@/components/timeSeries/GfzKpAnalysisPanel";
import MultiSourceComparisonPanel from "@/components/timeSeries/MultiSourceComparisonPanel";
import IntermagnetAnalysisPanel from "@/components/timeSeries/IntermagnetAnalysisPanel";
import type { ArchiveMeta, TecObservation, DiurnalPoint, SeasonalRow, SolarCycleRow, OmniAnalysisResponse, CelestrakAnalysisResponse, GfzKpAnalysisResponse, WdcKyotoAnalysisResponse, IntermagnetAnalysisResponse } from "@/lib/types";

const STATION_COLORS = ["#168bd2","#ff4444","#00ff88","#ff8c00","#a78bfa","#ffcc00","#34d399","#f472b6"];
const MONTHS = [
  { value: 1, label: "January" }, { value: 2, label: "February" }, { value: 3, label: "March" },
  { value: 4, label: "April" }, { value: 5, label: "May" }, { value: 6, label: "June" },
  { value: 7, label: "July" }, { value: 8, label: "August" }, { value: 9, label: "September" },
  { value: 10, label: "October" }, { value: 11, label: "November" }, { value: 12, label: "December" },
];

function lastDayOfMonth(year: number, month: number) {
  return new Date(year, month, 0).getDate();
}

function rangeFromMonths(startYear: number, startMonth: number, endYear: number, endMonth: number) {
  const start = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const end = `${endYear}-${String(endMonth).padStart(2, "0")}-${String(lastDayOfMonth(endYear, endMonth)).padStart(2, "0")}`;
  return { start, end };
}

function parseYm(iso: string | undefined, fallback: { y: number; m: number }) {
  if (!iso || iso.length < 7) return fallback;
  return { y: Number(iso.slice(0, 4)), m: Number(iso.slice(5, 7)) };
}

function rollingMean(arr: number[], window = 7): number[] {
  return arr.map((_, i) => {
    const slice = arr.slice(Math.max(0, i - window + 1), i + 1);
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

function percentile(arr: number[], p: number): number {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)] ?? 0;
}

const INTERMAGNET_OBSERVATORIES = [
  { code: "HER", label: "HER — Hermanus, South Africa" },
  { code: "HBK", label: "HBK — Hartebeesthoek, South Africa" },
  { code: "TSU", label: "TSU — Tsumeb, Namibia" },
  { code: "KMH", label: "KMH — Keetmanshoop, Namibia" },
];

type Tab = "daily" | "monthly" | "seasonal" | "diurnal" | "compare" | "storms" | "celestrak" | "gfz" | "intermagnet";

export default function TimeSeriesPage() {
  const [meta, setMeta]       = useState<ArchiveMeta | null>(null);
  const [obs, setObs]         = useState<TecObservation[]>([]);
  const [diurnal, setDiurnal] = useState<DiurnalPoint[]>([]);
  const [seasonal, setSeasonal] = useState<SeasonalRow[]>([]);
  const [solarCycle, setSolarCycle] = useState<SolarCycleRow[]>([]);
  const [tab, setTab]         = useState<Tab>("daily");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [omni, setOmni] = useState<OmniAnalysisResponse | null>(null);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [omniError, setOmniError] = useState<string | null>(null);
  const [celestrak, setCelestrak] = useState<CelestrakAnalysisResponse | null>(null);
  const [celestrakError, setCelestrakError] = useState<string | null>(null);
  const [gfz, setGfz] = useState<GfzKpAnalysisResponse | null>(null);
  const [gfzError, setGfzError] = useState<string | null>(null);
  const [kyoto, setKyoto] = useState<WdcKyotoAnalysisResponse | null>(null);
  const [kyotoError, setKyotoError] = useState<string | null>(null);
  const [intermagnet, setIntermagnet] = useState<IntermagnetAnalysisResponse | null>(null);
  const [intermagnetLoading, setIntermagnetLoading] = useState(false);
  const [intermagnetError, setIntermagnetError] = useState<string | null>(null);
  const [imagObservatory, setImagObservatory] = useState("HER");

  // filters
  const [station, setStation] = useState("");
  const [start, setStart]     = useState("");
  const [end, setEnd]         = useState("");
  const [startYear, setStartYear] = useState(2024);
  const [startMonth, setStartMonth] = useState(4);
  const [endYear, setEndYear] = useState(2024);
  const [endMonth, setEndMonth] = useState(6);
  const [imagStartYear, setImagStartYear] = useState(2024);
  const [imagStartMonth, setImagStartMonth] = useState(4);
  const [imagEndYear, setImagEndYear] = useState(2024);
  const [imagEndMonth, setImagEndMonth] = useState(6);

  const yearOptions = Array.from({ length: 12 }, (_, i) => new Date().getFullYear() - 6 + i);
  const loadGen = useRef(0);

  const loadAll = useCallback(async (st?: string, s?: string, e?: string, opts?: { initial?: boolean }) => {
    const gen = ++loadGen.current;
    if (opts?.initial !== false) {
      setLoading(true);
    }
    setLoadError(null);
    const results = await Promise.allSettled([
      getArchiveMeta(),
      getTimeSeries({ station: st || undefined, start: s || undefined, end: e || undefined, limit: 10000 }),
      getDiurnal(),
      getSeasonal(),
      getSolarCycle(),
    ]);
    if (gen !== loadGen.current) return;

    const errors: string[] = [];
    const labels = ["archive meta", "time series", "diurnal", "seasonal", "solar cycle"];
    results.forEach((result, i) => {
      if (result.status === "rejected") {
        errors.push(`${labels[i]}: ${result.reason instanceof Error ? result.reason.message : "failed"}`);
      }
    });
    const m = results[0].status === "fulfilled" ? results[0].value : null;
    const o = results[1].status === "fulfilled" ? results[1].value : null;
    const d = results[2].status === "fulfilled" ? results[2].value : null;
    const sea = results[3].status === "fulfilled" ? results[3].value : null;
    const sc = results[4].status === "fulfilled" ? results[4].value : null;
    if (m) setMeta(m);
    if (Array.isArray(o)) setObs(o);
    if (Array.isArray(d)) setDiurnal(d);
    if (Array.isArray(sea)) setSeasonal(sea);
    if (Array.isArray(sc)) setSolarCycle(sc);
    if (errors.length) {
      setLoadError(errors.join(" · "));
    }
    setLoading(false);
  }, []);
  useEffect(() => {
    void loadAll(undefined, undefined, undefined, { initial: true });
  }, [loadAll]);

  useEffect(() => {
    if (!meta?.first_date || !meta?.last_date) return;
    const s = parseYm(meta.first_date, { y: 2024, m: 4 });
    const e = parseYm(meta.last_date, { y: 2024, m: 6 });
    setStartYear(s.y);
    setStartMonth(s.m);
    setEndYear(e.y);
    setEndMonth(e.m);
    setImagStartYear(s.y);
    setImagStartMonth(s.m);
    setImagEndYear(e.y);
    setImagEndMonth(e.m);
    const r = rangeFromMonths(s.y, s.m, e.y, e.m);
    setStart(r.start);
    setEnd(r.end);
  }, [meta?.first_date, meta?.last_date]);

  const loadAllSources = useCallback(async () => {
    const r = rangeFromMonths(startYear, startMonth, endYear, endMonth);
    setStart(r.start);
    setEnd(r.end);
    setSourcesLoading(true);
    setOmniError(null);
    setCelestrakError(null);
    setGfzError(null);
    setKyotoError(null);
    try {
      void loadAll(station, r.start, r.end, { initial: false });
      const [omniR, celR, gfzR, kyotoR] = await Promise.allSettled([
        getOmniAnalysis(r.start, r.end, station || undefined),
        getCelestrakAnalysis(r.start, r.end, station || undefined),
        getGfzKpAnalysis(r.start, r.end, station || undefined),
        getWdcKyotoAnalysis(r.start, r.end, station || undefined),
      ]);
      if (omniR.status === "fulfilled") {
        setOmni(omniR.value);
      } else {
        setOmni(null);
        setOmniError(omniR.reason instanceof Error ? omniR.reason.message : "Failed to load OMNIWeb data");
      }
      if (celR.status === "fulfilled") {
        setCelestrak(celR.value);
      } else {
        setCelestrak(null);
        setCelestrakError(celR.reason instanceof Error ? celR.reason.message : "Failed to load CelesTrak data");
      }
      if (gfzR.status === "fulfilled") {
        setGfz(gfzR.value);
      } else {
        setGfz(null);
        setGfzError(gfzR.reason instanceof Error ? gfzR.reason.message : "Failed to load GFZ Kp data");
      }
      if (kyotoR.status === "fulfilled") {
        setKyoto(kyotoR.value);
      } else {
        setKyoto(null);
        setKyotoError(kyotoR.reason instanceof Error ? kyotoR.reason.message : "Failed to load WDC Kyoto data");
      }
      setTab("compare");
    } finally {
      setSourcesLoading(false);
    }
  }, [station, startYear, startMonth, endYear, endMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadIntermagnet = useCallback(async () => {
    const r = rangeFromMonths(imagStartYear, imagStartMonth, imagEndYear, imagEndMonth);
    setIntermagnetLoading(true);
    setIntermagnetError(null);
    setTab("intermagnet");
    setOmniError(null);
    setCelestrakError(null);
    setKyotoError(null);
    try {
      void loadAll(station, r.start, r.end, { initial: false });
      const [imagR, omniR, celR, kyotoR] = await Promise.allSettled([
        getIntermagnetAnalysis(r.start, r.end, imagObservatory, station || undefined),
        getOmniAnalysis(r.start, r.end, station || undefined),
        getCelestrakAnalysis(r.start, r.end, station || undefined),
        getWdcKyotoAnalysis(r.start, r.end, station || undefined),
      ]);
      if (imagR.status === "fulfilled") {
        setIntermagnet(imagR.value);
      } else {
        setIntermagnet(null);
        throw imagR.reason;
      }
      if (omniR.status === "fulfilled") setOmni(omniR.value);
      else setOmniError(omniR.reason instanceof Error ? omniR.reason.message : "NASA OMNIWeb failed");
      if (celR.status === "fulfilled") setCelestrak(celR.value);
      else setCelestrakError(celR.reason instanceof Error ? celR.reason.message : "CelesTrak failed");
      if (kyotoR.status === "fulfilled") setKyoto(kyotoR.value);
      else setKyotoError(kyotoR.reason instanceof Error ? kyotoR.reason.message : "WDC Kyoto failed");
    } catch (err) {
      setIntermagnet(null);
      setIntermagnetError(err instanceof Error ? err.message : "Failed to load INTERMAGNET data");
    }
    setIntermagnetLoading(false);
  }, [station, imagObservatory, imagStartYear, imagStartMonth, imagEndYear, imagEndMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Build daily mean per station ──────────────────────────────────────────
  const dailyByStation: Record<string, Record<string, number[]>> = {};
  for (const o of obs) {
    const day = o.timestamp.slice(0, 10);
    const st  = o.station || "unknown";
    if (!dailyByStation[st]) dailyByStation[st] = {};
    if (!dailyByStation[st][day]) dailyByStation[st][day] = [];
    if (o.vtec !== null) dailyByStation[st][day].push(o.vtec);
  }

  const allDates = [...new Set(obs.map((o) => o.timestamp.slice(0, 10)))].sort();
  const stations = Object.keys(dailyByStation).sort();

  const dailyDatasets = stations.map((st, i) => {
    const raw = allDates.map((d) => {
      const vals = dailyByStation[st]?.[d] ?? [];
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    });
    const filled = raw.map((v) => v ?? 0);
    const rolled = rollingMean(filled, 7);
    return {
      label: st,
      data: rolled,
      color: STATION_COLORS[i % STATION_COLORS.length],
    };
  });

  const allVtec = obs.map((o) => o.vtec ?? 0).filter((v) => v > 0);
  const pct95   = allVtec.length ? percentile(allVtec, 95) : 0;

  // ── Monthly means per station ─────────────────────────────────────────────
  const monthlyByStation: Record<string, Record<string, number[]>> = {};
  for (const o of obs) {
    const month = o.timestamp.slice(0, 7);
    const st    = o.station || "unknown";
    if (!monthlyByStation[st]) monthlyByStation[st] = {};
    if (!monthlyByStation[st][month]) monthlyByStation[st][month] = [];
    if (o.vtec !== null) monthlyByStation[st][month].push(o.vtec);
  }
  const allMonths = [...new Set(obs.map((o) => o.timestamp.slice(0, 7)))].sort();
  const monthlyDatasets = stations.map((st, i) => ({
    label: st,
    data: allMonths.map((m) => {
      const vals = monthlyByStation[st]?.[m] ?? [];
      return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    }),
    color: STATION_COLORS[i % STATION_COLORS.length],
  }));

  const metaAvailYears = meta?.first_date && meta?.last_date
    ? [...new Set([meta.first_date.slice(0, 4), meta.last_date.slice(0, 4)])].join(", ")
    : "—";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>

      {/* Title */}
      <div>
        <h1 className="page-title">📊 TEC Time Series Viewer</h1>
        <p className="page-subtitle">Daily, monthly, and seasonal TEC variation across the Zimbabwe CORS network</p>
      </div>

      {/* Archive info banner */}
      {meta?.available && (
        <div className="banner banner-info" style={{ fontSize: "0.85rem" }}>
          Historical processed CMN archive: {meta.observations > 0 ? meta.observations.toLocaleString() : meta.total_rows.toLocaleString()} source observations
          represented by {meta.total_rows.toLocaleString()} chart records
          {meta.stations.length > 0 && ` | ${meta.stations.length} station(s)`}
          {meta.first_date && ` | available year(s): ${metaAvailYears}`}.
        </div>
      )}
      {meta && !meta.available && (
        <div className="banner banner-warn">TEC archive not found. Upload files via Processing to generate data.</div>
      )}

      {/* Coverage note */}
      {meta?.available && meta.first_date && meta.last_date && (
        <div style={{ fontSize: "0.82rem", fontWeight: 600 }}>
          Historical data, not live telemetry.&nbsp;
          Coverage: {meta.first_date} to {meta.last_date}.&nbsp;
          Derived from {meta.source_files} real processed CMN files.
        </div>
      )}

      {/* Multi-source geomagnetic indices — NASA · CelesTrak · GFZ */}
      <div className="omni-range-card">
        <div className="omni-range-title">
          Geomagnetic indices — NASA OMNIWeb · CelesTrak · GFZ Potsdam (DE) · WDC Kyoto (JP)
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: 0 }}>
          Load daily space-weather indices from all four providers in one request, then compare Kp, Dst, F10.7,
          SSN, and Ap on shared charts. GFZ is the official Kp derivation centre; WDC Kyoto hosts the Japanese
          Dst index and definitive Kp distribution.
        </p>
        <div className="omni-range-grid">
          <label>
            From month
            <select value={startMonth} onChange={(e) => setStartMonth(Number(e.target.value))}>
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label>
            From year
            <select value={startYear} onChange={(e) => setStartYear(Number(e.target.value))}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <label>
            To month
            <select value={endMonth} onChange={(e) => setEndMonth(Number(e.target.value))}>
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label>
            To year
            <select value={endYear} onChange={(e) => setEndYear(Number(e.target.value))}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <label>
            Station (VTEC correlation)
            <select value={station} onChange={(e) => setStation(e.target.value)}
              style={{ minWidth: "140px" }}>
              <option value="">All stations (network mean)</option>
              {(meta?.stations ?? []).map((s) => (
                <option key={s} value={s}>{s.toUpperCase()}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" onClick={loadAllSources} disabled={sourcesLoading || (loading && obs.length === 0)}>
            {sourcesLoading ? "Loading all sources…" : "Load all sources"}
          </button>
        </div>
        {start && end && (
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Selected range: {start} → {end}
          </div>
        )}
      </div>

      {/* INTERMAGNET date range — ground magnetometer H / dB/dt */}
      <div className="omni-range-card">
        <div className="omni-range-title">INTERMAGNET date range (H field · dB/dt · modelled GIC)</div>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: 0 }}>
          Pull 1-minute ground-magnetometer data from{" "}
          <a href="https://imag-data.bgs.ac.uk/GIN_V1/GINForms2" target="_blank" rel="noreferrer">
            INTERMAGNET (BGS GIN)
          </a>{" "}
          observatories nearest Zimbabwe, then overlay locally-measured geomagnetic storm days on VTEC. Storms
          are detected from dH/dt and daily H range — the same physics that drives GICs.
        </p>
        <div className="omni-range-grid">
          <label>
            From month
            <select value={imagStartMonth} onChange={(e) => setImagStartMonth(Number(e.target.value))}>
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label>
            From year
            <select value={imagStartYear} onChange={(e) => setImagStartYear(Number(e.target.value))}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <label>
            To month
            <select value={imagEndMonth} onChange={(e) => setImagEndMonth(Number(e.target.value))}>
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label>
            To year
            <select value={imagEndYear} onChange={(e) => setImagEndYear(Number(e.target.value))}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <label>
            Observatory
            <select value={imagObservatory} onChange={(e) => setImagObservatory(e.target.value)}
              style={{ minWidth: "180px" }}>
              {INTERMAGNET_OBSERVATORIES.map((o) => (
                <option key={o.code} value={o.code}>{o.label}</option>
              ))}
            </select>
          </label>
          <label>
            Station (VTEC correlation)
            <select value={station} onChange={(e) => setStation(e.target.value)}
              style={{ minWidth: "140px" }}>
              <option value="">All stations (network mean)</option>
              {(meta?.stations ?? []).map((s) => (
                <option key={s} value={s}>{s.toUpperCase()}</option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" onClick={loadIntermagnet} disabled={intermagnetLoading || loading}>
            {intermagnetLoading ? "Loading INTERMAGNET…" : "Load INTERMAGNET analysis"}
          </button>
        </div>
        {(() => {
          const r = rangeFromMonths(imagStartYear, imagStartMonth, imagEndYear, imagEndMonth);
          return (
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Selected range: {r.start} → {r.end} · minute data is aggregated to daily statistics (fetch may take
              ~30–60 s per month)
            </div>
          );
        })()}
      </div>

      {/* Expandable coverage detail */}
      {meta?.available && (
        <div className="card" style={{ padding: "0.6rem 1rem", cursor: "pointer" }} onClick={() => setCoverageOpen((v) => !v)}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.85rem", fontWeight: 600 }}>
            <span style={{ color: "var(--accent)", fontSize: "0.75rem" }}>{coverageOpen ? "▾" : "▸"}</span>
            View station and date coverage
          </div>
          {coverageOpen && (
            <div style={{ marginTop: "0.8rem", display: "flex", flexDirection: "column", gap: "0.8rem" }}>
              {/* Filters */}
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem", alignItems: "flex-end" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <label className="metric-label">Station</label>
                  <select value={station} onChange={(e) => setStation(e.target.value)}
                    style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.4rem 0.7rem", color: "var(--text)", minWidth: "120px" }}>
                    <option value="">All stations</option>
                    {meta.stations.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                  </select>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <label className="metric-label">Start</label>
                  <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
                    style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.4rem 0.7rem", color: "var(--text)" }} />
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
                  <label className="metric-label">End</label>
                  <input type="date" value={end} onChange={(e) => setEnd(e.target.value)}
                    style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.4rem 0.7rem", color: "var(--text)" }} />
                </div>
                <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); loadAll(station, start, end, { initial: false }); }} disabled={loading && obs.length === 0}>
                  {loading ? "Loading…" : "Apply"}
                </button>
              </div>
              {/* Station list */}
              {meta.stations.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                  {meta.stations.map((s, i) => (
                    <span key={s} style={{ background: STATION_COLORS[i % STATION_COLORS.length] + "22", border: `1px solid ${STATION_COLORS[i % STATION_COLORS.length]}`, borderRadius: "4px", padding: "0.2rem 0.55rem", fontSize: "0.75rem", fontWeight: 700 }}>
                      {s.toUpperCase()}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tabs */}
      <div className="tabs">
        {([["daily","Daily Variation"],["monthly","Monthly Averages"],["seasonal","Seasonal / Yearly"],["diurnal","Diurnal Pattern"],["compare","Source Comparison"],["storms","NASA OMNI"],["celestrak","CelesTrak"],["gfz","GFZ Kp"],["intermagnet","INTERMAGNET"]] as [Tab,string][]).map(([id, label]) => (
          <button key={id} className={`tab${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {loadError && (
        <div className="banner banner-warn" style={{ fontSize: "0.85rem" }}>
          Some chart data could not be loaded ({loadError}). Ensure the backend is running on port 8000.
        </div>
      )}

      {tab === "daily" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {loading && obs.length === 0 && (
            <div className="banner banner-info">Loading archive data…</div>
          )}
          {dailyDatasets.length > 0 ? (
            <div className="card">
              <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>Daily VTEC — 7-day rolling mean</div>
              <LineChart
                labels={allDates}
                datasets={dailyDatasets}
                yLabel="VTEC (TECU)"
                height={340}
                threshold={pct95 > 0 ? { value: pct95, label: `95th pct: ${pct95.toFixed(1)} TECU` } : undefined}
                highlightDates={omni?.storms.map((s) => s.date).filter((d) => allDates.includes(d))}
              />
            </div>
          ) : (
            <div className="banner banner-info">No daily data available. Upload CMN/RINEX files via Processing.</div>
          )}
        </div>
      )}

      {/* ── Monthly Averages ── */}
      {tab === "monthly" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {monthlyDatasets.length > 0 ? (
            <div className="card">
              <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>Monthly Mean VTEC per Station</div>
              <LineChart
                labels={allMonths}
                datasets={monthlyDatasets}
                yLabel="Mean VTEC (TECU)"
                height={300}
              />
            </div>
          ) : (
            <div className="banner banner-info">No monthly data available.</div>
          )}
        </div>
      )}

      {/* ── Seasonal / Yearly ── */}
      {tab === "seasonal" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {seasonal.length > 0 && (
            <div className="card">
              <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>Seasonal Mean VTEC</div>
              <BarChart
                labels={seasonal.map((r) => r.season)}
                values={seasonal.map((r) => r.mean)}
                errors={seasonal.map((r) => r.std)}
                yLabel="Mean VTEC (TECU)"
                height={280}
              />
            </div>
          )}
          {solarCycle.length > 0 && (
            <div className="card">
              <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>Annual Mean VTEC (Solar Cycle)</div>
              <LineChart
                labels={solarCycle.map((r) => String(r.year))}
                datasets={[
                  { label: "Mean VTEC", data: solarCycle.map((r) => r.mean_vtec), color: "#168bd2" },
                  { label: "Max VTEC",  data: solarCycle.map((r) => r.max_vtec),  color: "#ff4444" },
                  { label: "Min VTEC",  data: solarCycle.map((r) => r.min_vtec),  color: "#00ff88" },
                ]}
                yLabel="VTEC (TECU)"
                height={280}
              />
            </div>
          )}
          {!seasonal.length && !solarCycle.length && (
            <div className="banner banner-info">No seasonal data available.</div>
          )}
        </div>
      )}

      {/* ── Diurnal Pattern ── */}
      {tab === "diurnal" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
          {diurnal.length > 0 ? (
            <div className="card">
              <div style={{ fontWeight: 700, marginBottom: "0.6rem" }}>24-hour Diurnal VTEC Pattern</div>
              <LineChart
                labels={diurnal.map((d) => `${d.hour}:00`)}
                datasets={[
                  { label: "Mean VTEC", data: diurnal.map((d) => d.mean_vtec), color: "#168bd2", fill: true },
                ]}
                yLabel="Mean VTEC (TECU)"
                height={300}
              />
              <div style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
                Local time approximation (UTC+2). Peak typically 12:00–16:00 LT over Zimbabwe.
              </div>
            </div>
          ) : (
            <div className="banner banner-info">No diurnal data available.</div>
          )}
        </div>
      )}

      {/* ── Multi-source comparison ── */}
      {tab === "compare" && (
        <MultiSourceComparisonPanel
          omni={omni}
          celestrak={celestrak}
          gfz={gfz}
          kyoto={kyoto}
          vtecLabels={allDates}
          vtecDatasets={dailyDatasets}
          loading={sourcesLoading}
          errors={{ omni: omniError, celestrak: celestrakError, gfz: gfzError, kyoto: kyotoError }}
        />
      )}

      {/* ── Geomagnetic / OMNI analysis ── */}
      {tab === "storms" && (
        <GeomagneticAnalysisPanel
          omni={omni}
          vtecLabels={allDates}
          vtecDatasets={dailyDatasets}
          loading={sourcesLoading}
          error={omniError}
        />
      )}

      {/* ── CelesTrak analysis ── */}
      {tab === "celestrak" && (
        <CelestrakAnalysisPanel
          celestrak={celestrak}
          vtecLabels={allDates}
          vtecDatasets={dailyDatasets}
          loading={sourcesLoading}
          error={celestrakError}
        />
      )}

      {/* ── GFZ Kp analysis ── */}
      {tab === "gfz" && (
        <GfzKpAnalysisPanel
          gfz={gfz}
          vtecLabels={allDates}
          vtecDatasets={dailyDatasets}
          loading={sourcesLoading}
          error={gfzError}
        />
      )}

      {/* ── INTERMAGNET analysis ── */}
      {tab === "intermagnet" && (
        <IntermagnetAnalysisPanel
          intermagnet={intermagnet}
          omni={omni}
          celestrak={celestrak}
          kyoto={kyoto}
          vtecLabels={allDates}
          vtecDatasets={dailyDatasets}
          loading={intermagnetLoading}
          error={intermagnetError}
          indicesLoading={intermagnetLoading}
        />
      )}

    </div>
  );
}
