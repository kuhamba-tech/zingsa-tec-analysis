"use client";
import { useEffect, useState, useCallback } from "react";
import { getArchiveMeta, getTimeSeries, getDiurnal, getSeasonal, getSolarCycle, getOmniAnalysis, getCelestrakAnalysis } from "@/lib/api";
import LineChart from "@/components/charts/LineChart";
import BarChart from "@/components/charts/BarChart";
import GeomagneticAnalysisPanel from "@/components/timeSeries/GeomagneticAnalysisPanel";
import CelestrakAnalysisPanel from "@/components/timeSeries/CelestrakAnalysisPanel";
import type { ArchiveMeta, TecObservation, DiurnalPoint, SeasonalRow, SolarCycleRow, OmniAnalysisResponse, CelestrakAnalysisResponse } from "@/lib/types";

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

type Tab = "daily" | "monthly" | "seasonal" | "diurnal" | "storms" | "celestrak";

export default function TimeSeriesPage() {
  const [meta, setMeta]       = useState<ArchiveMeta | null>(null);
  const [obs, setObs]         = useState<TecObservation[]>([]);
  const [diurnal, setDiurnal] = useState<DiurnalPoint[]>([]);
  const [seasonal, setSeasonal] = useState<SeasonalRow[]>([]);
  const [solarCycle, setSolarCycle] = useState<SolarCycleRow[]>([]);
  const [tab, setTab]         = useState<Tab>("daily");
  const [loading, setLoading] = useState(true);
  const [coverageOpen, setCoverageOpen] = useState(false);
  const [omni, setOmni] = useState<OmniAnalysisResponse | null>(null);
  const [omniLoading, setOmniLoading] = useState(false);
  const [omniError, setOmniError] = useState<string | null>(null);
  const [celestrak, setCelestrak] = useState<CelestrakAnalysisResponse | null>(null);
  const [celestrakLoading, setCelestrakLoading] = useState(false);
  const [celestrakError, setCelestrakError] = useState<string | null>(null);

  // filters
  const [station, setStation] = useState("");
  const [start, setStart]     = useState("");
  const [end, setEnd]         = useState("");
  const [startYear, setStartYear] = useState(2024);
  const [startMonth, setStartMonth] = useState(4);
  const [endYear, setEndYear] = useState(2024);
  const [endMonth, setEndMonth] = useState(6);
  const [celestrakStartYear, setCelestrakStartYear] = useState(2024);
  const [celestrakStartMonth, setCelestrakStartMonth] = useState(4);
  const [celestrakEndYear, setCelestrakEndYear] = useState(2024);
  const [celestrakEndMonth, setCelestrakEndMonth] = useState(6);

  const yearOptions = Array.from({ length: 12 }, (_, i) => new Date().getFullYear() - 6 + i);

  async function loadAll(st?: string, s?: string, e?: string) {
    setLoading(true);
    try {
      const [m, o, d, sea, sc] = await Promise.all([
        getArchiveMeta(),
        getTimeSeries({ station: st || undefined, start: s || undefined, end: e || undefined, limit: 10000 }),
        getDiurnal(),
        getSeasonal(),
        getSolarCycle(),
      ]);
      setMeta(m);
      setObs(o);
      setDiurnal(d);
      setSeasonal(sea);
      setSolarCycle(sc);
    } catch { /* offline */ }
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!meta?.first_date || !meta?.last_date) return;
    const s = parseYm(meta.first_date, { y: 2024, m: 4 });
    const e = parseYm(meta.last_date, { y: 2024, m: 6 });
    setStartYear(s.y);
    setStartMonth(s.m);
    setEndYear(e.y);
    setEndMonth(e.m);
    setCelestrakStartYear(s.y);
    setCelestrakStartMonth(s.m);
    setCelestrakEndYear(e.y);
    setCelestrakEndMonth(e.m);
    const r = rangeFromMonths(s.y, s.m, e.y, e.m);
    setStart(r.start);
    setEnd(r.end);
  }, [meta?.first_date, meta?.last_date]);

  const loadOmni = useCallback(async () => {
    const r = rangeFromMonths(startYear, startMonth, endYear, endMonth);
    setStart(r.start);
    setEnd(r.end);
    setOmniLoading(true);
    setOmniError(null);
    try {
      await loadAll(station, r.start, r.end);
      const data = await getOmniAnalysis(r.start, r.end, station || undefined);
      setOmni(data);
      setTab("storms");
    } catch (err) {
      setOmni(null);
      setOmniError(err instanceof Error ? err.message : "Failed to load OMNIWeb data");
    }
    setOmniLoading(false);
  }, [station, startYear, startMonth, endYear, endMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCelestrak = useCallback(async () => {
    const r = rangeFromMonths(celestrakStartYear, celestrakStartMonth, celestrakEndYear, celestrakEndMonth);
    setCelestrakLoading(true);
    setCelestrakError(null);
    try {
      await loadAll(station, r.start, r.end);
      const data = await getCelestrakAnalysis(r.start, r.end, station || undefined);
      setCelestrak(data);
      setTab("celestrak");
    } catch (err) {
      setCelestrak(null);
      setCelestrakError(err instanceof Error ? err.message : "Failed to load CelesTrak data");
    }
    setCelestrakLoading(false);
  }, [station, celestrakStartYear, celestrakStartMonth, celestrakEndYear, celestrakEndMonth]); // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* OMNIWeb date range — NASA geomagnetic indices */}
      <div className="omni-range-card">
        <div className="omni-range-title">NASA OMNIWeb date range (SSN · Kp · F10.7 · Dst)</div>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: 0 }}>
          Pull daily space-weather indices from{" "}
          <a href="https://omniweb.gsfc.nasa.gov/form/dx1.html" target="_blank" rel="noreferrer">
            OMNIWeb
          </a>{" "}
          for the same interval as your TEC archive, then overlay geomagnetic storm days on VTEC.
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
          <button className="btn btn-primary" onClick={loadOmni} disabled={omniLoading || loading}>
            {omniLoading ? "Loading OMNI…" : "Load OMNI analysis"}
          </button>
        </div>
        {start && end && (
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Selected range: {start} → {end}
          </div>
        )}
      </div>

      {/* CelesTrak date range — SSN / Kp / F10.7 / Ap */}
      <div className="omni-range-card">
        <div className="omni-range-title">CelesTrak date range (SSN · Kp · F10.7 · Ap)</div>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: 0 }}>
          Pull daily space-weather indices from{" "}
          <a href="https://celestrak.org/SpaceData/" target="_blank" rel="noreferrer">
            CelesTrak
          </a>{" "}
          for the same interval as your TEC archive, then overlay storm days on VTEC. CelesTrak has no Dst, so
          storms are classified from Kp/Ap.
        </p>
        <div className="omni-range-grid">
          <label>
            From month
            <select value={celestrakStartMonth} onChange={(e) => setCelestrakStartMonth(Number(e.target.value))}>
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label>
            From year
            <select value={celestrakStartYear} onChange={(e) => setCelestrakStartYear(Number(e.target.value))}>
              {yearOptions.map((y) => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </label>
          <label>
            To month
            <select value={celestrakEndMonth} onChange={(e) => setCelestrakEndMonth(Number(e.target.value))}>
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label>
            To year
            <select value={celestrakEndYear} onChange={(e) => setCelestrakEndYear(Number(e.target.value))}>
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
          <button className="btn btn-primary" onClick={loadCelestrak} disabled={celestrakLoading || loading}>
            {celestrakLoading ? "Loading CelesTrak…" : "Load CelesTrak analysis"}
          </button>
        </div>
        {(() => {
          const r = rangeFromMonths(celestrakStartYear, celestrakStartMonth, celestrakEndYear, celestrakEndMonth);
          return (
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Selected range: {r.start} → {r.end}
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
                <button className="btn btn-primary" onClick={(e) => { e.stopPropagation(); loadAll(station, start, end); }} disabled={loading}>
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
        {([["daily","Daily Variation"],["monthly","Monthly Averages"],["seasonal","Seasonal / Yearly"],["diurnal","Diurnal Pattern"],["storms","Geomagnetic Storms"],["celestrak","CelesTrak Storms"]] as [Tab,string][]).map(([id, label]) => (
          <button key={id} className={`tab${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {loading && <div className="banner banner-info">Loading archive data…</div>}

      {/* ── Daily Variation ── */}
      {tab === "daily" && !loading && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
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
      {tab === "monthly" && !loading && (
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
      {tab === "seasonal" && !loading && (
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
      {tab === "diurnal" && !loading && (
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

      {/* ── Geomagnetic / OMNI analysis ── */}
      {tab === "storms" && (
        <GeomagneticAnalysisPanel
          omni={omni}
          vtecLabels={allDates}
          vtecDatasets={dailyDatasets}
          loading={omniLoading}
          error={omniError}
        />
      )}

      {/* ── CelesTrak analysis ── */}
      {tab === "celestrak" && (
        <CelestrakAnalysisPanel
          celestrak={celestrak}
          vtecLabels={allDates}
          vtecDatasets={dailyDatasets}
          loading={celestrakLoading}
          error={celestrakError}
        />
      )}

    </div>
  );
}
