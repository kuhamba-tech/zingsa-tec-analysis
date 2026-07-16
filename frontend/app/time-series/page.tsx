"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { getArchiveMeta, getTimeSeries, getDiurnal, getSeasonal, getSolarCycle, getOmniAnalysis, getCelestrakAnalysis, getGfzKpAnalysis, getWdcKyotoAnalysis, getIntermagnetAnalysis, getGuviOn2, getCosmic2Analysis, getDidbaseIonosonde } from "@/lib/api";
import LineChart from "@/components/charts/LineChart";
import BarChart from "@/components/charts/BarChart";
import GeomagneticAnalysisPanel from "@/components/timeSeries/GeomagneticAnalysisPanel";
import CelestrakAnalysisPanel from "@/components/timeSeries/CelestrakAnalysisPanel";
import GfzKpAnalysisPanel from "@/components/timeSeries/GfzKpAnalysisPanel";
import MultiSourceComparisonPanel from "@/components/timeSeries/MultiSourceComparisonPanel";
import IntermagnetAnalysisPanel from "@/components/timeSeries/IntermagnetAnalysisPanel";
import GuviOn2AnalysisPanel from "@/components/timeSeries/GuviOn2AnalysisPanel";
import Cosmic2AnalysisPanel from "@/components/timeSeries/Cosmic2AnalysisPanel";
import type { ArchiveMeta, TecObservation, DiurnalPoint, SeasonalRow, SolarCycleRow, OmniAnalysisResponse, CelestrakAnalysisResponse, GfzKpAnalysisResponse, WdcKyotoAnalysisResponse, IntermagnetAnalysisResponse, GuviOn2Response, Cosmic2AnalysisResponse, DidbaseIonosondeResponse } from "@/lib/types";

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

const GUVI_REFERENCE_DATES = ["2021-11-03", "2021-11-04", "2021-11-05"];

const IONOSONDE_STATIONS = [
  {
    name: "Hermanus",
    code: "HE13N",
    country: "South Africa",
    latitude: "34.4°S",
    longitude: "19.2°E",
    role: "SANSA coastal reference ionosonde",
    focus: "foF2, hmF2, MUF, ionogram profile context",
  },
  {
    name: "Madimbo",
    code: "MU12K",
    country: "South Africa",
    latitude: "22.4°S",
    longitude: "30.9°E",
    role: "Limpopo ionosonde nearest Zimbabwe",
    focus: "foF2, hmF2, spread-F and regional ionospheric structure",
  },
];

type Tab = "daily" | "monthly" | "seasonal" | "diurnal" | "compare" | "storms" | "celestrak" | "gfz" | "guvi" | "cosmic2" | "intermagnet";

function formatGuviDate(date: string) {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric", timeZone: "UTC" });
}

function GuviOn2MapPreview({
  date,
  guvi,
}: {
  date: string;
  guvi: GuviOn2Response | null;
}) {
  const overpass = guvi?.series.find((row) => row.date === date) ?? guvi?.series[0] ?? null;
  const times = ["09:51", "09:52", "09:55", "09:56", "09:57", "09:58", "09:59"];
  const uts = ["18:57", "15:44", "12:30", "09:17", "06:03", "02:48", "23:36"];

  return (
    <div
      style={{
        background: "#ffffff",
        color: "#111827",
        border: "1px solid #334155",
        borderRadius: "6px",
        padding: "0.85rem",
        maxWidth: "820px",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "1rem", marginBottom: "0.35rem" }}>
        <div style={{ fontSize: "1.05rem", fontWeight: 800 }}>(a)</div>
        <div style={{ flex: 1, textAlign: "center", fontSize: "1.1rem", fontWeight: 800 }}>
          GUVI O/N2&nbsp;&nbsp;{formatGuviDate(date)}
        </div>
        <div style={{ fontSize: "0.85rem", fontWeight: 800 }}>O/N2</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 46px", gap: "0.65rem", alignItems: "stretch" }}>
        <div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", fontSize: "0.78rem", fontWeight: 700, margin: "0 0 0.2rem" }}>
            <span>180 deg</span><span style={{ textAlign: "center" }}>-90 deg</span><span style={{ textAlign: "center" }}>0 deg</span><span style={{ textAlign: "center" }}>+90 deg</span><span style={{ textAlign: "right" }}>180 deg</span>
          </div>
          <div
            style={{
              position: "relative",
              height: "260px",
              border: "2px solid #111827",
              overflow: "hidden",
              background:
                "linear-gradient(180deg, #ffffff 0%, #ffffff 16%, #41f041 17%, #2bf16b 30%, #22d6bb 45%, #0ea5e9 62%, #1547ff 82%, #39006e 100%)",
            }}
          >
            {[16, 33, 50, 67, 84].map((top) => (
              <div key={`lat-${top}`} style={{ position: "absolute", left: 0, right: 0, top: `${top}%`, borderTop: "2px dotted rgba(0,0,0,0.7)" }} />
            ))}
            {[16.66, 33.33, 50, 66.66, 83.33].map((left) => (
              <div key={`lon-${left}`} style={{ position: "absolute", top: 0, bottom: 0, left: `${left}%`, borderLeft: "2px dotted rgba(0,0,0,0.7)" }} />
            ))}
            <svg viewBox="0 0 720 320" preserveAspectRatio="none" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
              <g fill="none" stroke="#050505" strokeWidth="1.3" opacity="0.9">
                <path d="M55 70 C95 45 140 54 177 72 C209 89 245 74 277 84 C321 99 361 78 401 90 C445 103 488 92 530 104 C574 116 620 95 682 112" />
                <path d="M75 104 C125 91 154 118 187 120 C218 123 259 98 299 120 C330 138 353 135 384 128 C421 119 456 132 489 150 C535 175 580 145 654 166" />
                <path d="M88 162 C135 150 164 184 210 178 C258 171 280 143 322 157 C362 170 383 195 426 181 C466 168 504 187 545 204 C590 224 628 203 680 218" />
                <path d="M115 236 C160 218 219 222 268 232 C325 244 392 218 445 232 C501 248 571 238 660 255" />
                <path d="M118 262 C190 282 315 277 405 268 C510 258 609 270 697 281" />
              </g>
              <g fill="none" stroke="#ffffff" strokeWidth="2" strokeDasharray="8 5" opacity="0.95">
                <path d="M14 68 C112 45 167 97 232 113 C292 128 354 110 416 90 C498 64 574 76 705 56" />
                <path d="M11 146 C109 122 190 134 277 160 C364 187 449 185 541 166 C614 151 660 154 708 168" />
                <path d="M16 225 C112 214 195 231 278 249 C360 267 443 249 530 231 C606 216 658 225 708 244" />
              </g>
              <ellipse cx="210" cy="189" rx="58" ry="18" fill="rgba(255,255,255,0.86)" />
              <text x="362" y="155" fontSize="18" fill="#ffffff" stroke="#114" strokeWidth="0.5">O/N2</text>
              <text x="330" y="185" fontSize="15" fill="#ffffff">Africa</text>
            </svg>
            <div style={{ position: "absolute", left: "4px", top: "4px", bottom: "4px", display: "flex", flexDirection: "column", justifyContent: "space-between", fontSize: "0.78rem", fontWeight: 700 }}>
              {["+90 deg", "+60 deg", "+30 deg", "0 deg", "-30 deg", "-60 deg", "-90 deg"].map((v) => <span key={v}>{v}</span>)}
            </div>
            <div style={{ position: "absolute", right: "4px", top: "4px", bottom: "4px", display: "flex", flexDirection: "column", justifyContent: "space-between", fontSize: "0.78rem", fontWeight: 700 }}>
              {["+90 deg", "+60 deg", "+30 deg", "0 deg", "-30 deg", "-60 deg", "-90 deg"].map((v) => <span key={v}>{v}</span>)}
            </div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: "0.4rem", fontSize: "0.7rem", fontWeight: 700, marginTop: "0.35rem", textAlign: "center" }}>
            {times.map((time, i) => (
              <div key={`${time}-${uts[i]}`}>
                <div>{time}</div>
                <div>{uts[i]}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", fontSize: "0.7rem", fontWeight: 800, marginTop: "0.1rem" }}>
            <span>LT</span><span>UT</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.3rem", alignItems: "stretch" }}>
          <div
            style={{
              width: "18px",
              border: "1px solid #111827",
              background: "linear-gradient(180deg, #ff1d00 0%, #fff300 18%, #39ff14 38%, #00d5ff 58%, #143cff 78%, #3b006d 100%)",
            }}
          />
          <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", fontSize: "0.76rem", fontWeight: 700 }}>
            {["1.4", "1.2", "1.0", "0.8", "0.6", "0.4", "0.2", "0.0"].map((v) => <span key={v}>{v}</span>)}
          </div>
        </div>
      </div>
      <div style={{ marginTop: "0.65rem", fontSize: "0.72rem", color: "#334155", fontWeight: 700 }}>
        Date: {date} {overpass ? `- Africa overpass ${overpass.overpass_ut} UT - ${overpass.status.replaceAll("_", " ")}` : "- no reference overpass in selected range"}
      </div>
    </div>
  );
}

function IonosondeDidbasePanel({
  startMonth,
  endYear,
  day,
  station,
  stationOptions,
  yearOptions,
  onStartMonth,
  onEndYear,
  onDay,
  onStation,
}: {
  startMonth: number;
  endYear: number;
  day: number;
  station: string;
  stationOptions: string[];
  yearOptions: number[];
  onStartMonth: (value: number) => void;
  onEndYear: (value: number) => void;
  onDay: (value: number) => void;
  onStation: (value: string) => void;
}) {
  const selected = IONOSONDE_STATIONS.find((row) => row.code === station) ?? IONOSONDE_STATIONS[0];
  const days = Array.from({ length: lastDayOfMonth(endYear, startMonth) }, (_, i) => i + 1);
  const selectedDate = `${MONTHS.find((m) => m.value === startMonth)?.label ?? "April"} ${String(day).padStart(2, "0")}, ${endYear}`;
  const selectedIsoDate = `${endYear}-${String(startMonth).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  const [result, setResult] = useState<DidbaseIonosondeResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLoad = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await getDidbaseIonosonde(station, endYear);
      setResult(r);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "Failed to reach DIDBase/IonoWeb");
    } finally {
      setLoading(false);
    }
  }, [station, endYear]);

  return (
    <div className="omni-range-card">
      <div className="omni-range-title">Ground Segment - Ionosonde Data - GIRO DIDBase (South Africa)</div>
      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: 0 }}>
        Pull South African Digisonde context from DIDBase station codes nearest the Zimbabwe region. Only Hermanus and
        Madimbo are included here; Madimbo is the nearest South African ionosonde to Zimbabwe.
      </p>
      <div className="omni-range-grid">
        <label>
          Month
          <select value={startMonth} onChange={(e) => {
            const month = Number(e.target.value);
            onStartMonth(month);
            const maxDay = lastDayOfMonth(endYear, month);
            if (day > maxDay) onDay(maxDay);
          }}>
            {MONTHS.map((m) => (
              <option key={m.value} value={m.value}>{m.label}</option>
            ))}
          </select>
        </label>
        <label>
          Date
          <select value={day} onChange={(e) => onDay(Number(e.target.value))}>
            {days.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          Year
          <select value={endYear} onChange={(e) => {
            const year = Number(e.target.value);
            onEndYear(year);
            const maxDay = lastDayOfMonth(year, startMonth);
            if (day > maxDay) onDay(maxDay);
          }}>
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </label>
        <label>
          Ionosonde
          <select value={station} onChange={(e) => onStation(e.target.value)}
            style={{ minWidth: "180px" }}>
            {IONOSONDE_STATIONS.map((row) => (
              <option key={row.code} value={row.code}>{row.code} - {row.name}, South Africa</option>
            ))}
          </select>
        </label>
        <label>
          Station (VTEC correlation)
          <select style={{ minWidth: "140px" }}>
            <option value="">All stations (network mean)</option>
            {stationOptions.map((s) => (
              <option key={s} value={s}>{s.toUpperCase()}</option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary" type="button" onClick={handleLoad} disabled={loading}>
          {loading ? "Loading…" : "Load ionosonde"}
        </button>
      </div>
      <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
        Selected date: {selectedDate} ({selectedIsoDate}) · {selected.code} {selected.name} ({selected.latitude}, {selected.longitude}) · {selected.focus}
      </div>
      {error && (
        <div className="on2-inline-note" style={{ marginTop: "0.8rem", color: "var(--negative, #ff6b6b)" }}>
          {error}
        </div>
      )}
      {result && !error && (
        <div className="on2-inline-note" style={{ marginTop: "0.8rem" }}>
          {result.status === "didbase_metadata" || result.status === "didbase_years_only" ? (
            <>
              DIDBase confirms {result.code} {result.name}
              {result.lat != null && result.lon != null ? ` (${result.lat.toFixed(2)}, ${result.lon.toFixed(2)})` : ""}.{" "}
              {result.availability_years.length > 0 ? (
                <>
                  Ionogram data available for {result.availability_years[0]}–{result.latest_available_year}.{" "}
                  {result.year_has_data === false && (
                    <strong>No ionogram data on record for {result.requested_year}.</strong>
                  )}
                  {result.year_has_data === true && (
                    <strong>{result.requested_year} has ionogram data on record.</strong>
                  )}
                </>
              ) : (
                "No public ionogram-availability years returned."
              )}
            </>
          ) : (
            `DIDBase public endpoint unreachable — showing fallback station coordinates only.${result.error ? ` (${result.error})` : ""}`
          )}
          <br />
          {result.note}
        </div>
      )}
      <div className="on2-inline-note" style={{ marginTop: "0.8rem" }}>
        Source: <a href="https://giro.uml.edu/didbase/" target="_blank" rel="noreferrer">GIRO DIDBase</a>. Use DIDBase
        station codes HE13N and MU12K for ionogram images; numerical ionosonde parameters require DIDBase/SAOExplorer
        access.
      </div>
    </div>
  );
}

export default function TimeSeriesPage() {
  const [meta, setMeta]       = useState<ArchiveMeta | null>(null);
  const [obs, setObs]         = useState<TecObservation[]>([]);
  const [diurnal, setDiurnal] = useState<DiurnalPoint[]>([]);
  const [seasonal, setSeasonal] = useState<SeasonalRow[]>([]);
  const [solarCycle, setSolarCycle] = useState<SolarCycleRow[]>([]);
  const [tab, setTab]         = useState<Tab>("daily");
  const urlInit = useRef(false);
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
  const [guvi, setGuvi] = useState<GuviOn2Response | null>(null);
  const [guviLoading, setGuviLoading] = useState(false);
  const [guviError, setGuviError] = useState<string | null>(null);
  const [cosmic2, setCosmic2] = useState<Cosmic2AnalysisResponse | null>(null);
  const [cosmic2Loading, setCosmic2Loading] = useState(false);
  const [cosmic2Error, setCosmic2Error] = useState<string | null>(null);

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
  const [ionosondeDay, setIonosondeDay] = useState(1);
  const [ionosondeCode, setIonosondeCode] = useState("MU12K");
  const [guviDate, setGuviDate] = useState("2021-11-03");

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

  useEffect(() => {
    if (urlInit.current) return;
    const params = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
    const startParam = params.get("start");
    const endParam = params.get("end");
    const stationParam = params.get("station");
    const tabParam = params.get("tab");
    if (!startParam && !endParam && !stationParam && !tabParam) return;
    urlInit.current = true;
    if (stationParam) setStation(stationParam);
    if (tabParam === "storms" || tabParam === "daily" || tabParam === "monthly" || tabParam === "seasonal"
      || tabParam === "diurnal" || tabParam === "compare" || tabParam === "celestrak"
      || tabParam === "gfz" || tabParam === "guvi" || tabParam === "cosmic2" || tabParam === "intermagnet") {
      setTab(tabParam);
    }
    if (startParam) {
      const s = parseYm(startParam, { y: 2024, m: 4 });
      setStartYear(s.y);
      setStartMonth(s.m);
      setStart(startParam);
    }
    if (endParam) {
      const e = parseYm(endParam, { y: 2024, m: 6 });
      setEndYear(e.y);
      setEndMonth(e.m);
      setEnd(endParam);
    }
    if (startParam || endParam) {
      void loadAll(stationParam || undefined, startParam || undefined, endParam || undefined, { initial: true });
    }
  }, [loadAll]);

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

  const loadGuviOn2 = useCallback(async () => {
    const r = { start: guviDate, end: guviDate };
    setStart(r.start);
    setEnd(r.end);
    setGuviLoading(true);
    setGuviError(null);
    setTab("guvi");
    try {
      void loadAll(station, r.start, r.end, { initial: false });
      const payload = await getGuviOn2(r.start, r.end);
      setGuvi(payload);
    } catch (err) {
      setGuvi(null);
      setGuviError(err instanceof Error ? err.message : "Failed to load TIMED/GUVI O/N2 context");
    } finally {
      setGuviLoading(false);
    }
  }, [station, guviDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCosmic2 = useCallback(async () => {
    const r = rangeFromMonths(startYear, startMonth, endYear, endMonth);
    setStart(r.start);
    setEnd(r.end);
    setCosmic2Loading(true);
    setCosmic2Error(null);
    setTab("cosmic2");
    try {
      void loadAll(station, r.start, r.end, { initial: false });
      const payload = await getCosmic2Analysis(r.start, r.end);
      setCosmic2(payload);
    } catch (err) {
      setCosmic2(null);
      setCosmic2Error(err instanceof Error ? err.message : "Failed to load COSMIC-2 context");
    } finally {
      setCosmic2Loading(false);
    }
  }, [station, startYear, startMonth, endYear, endMonth]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const guviYear = Number(guviDate.slice(0, 4));
  const guviMonth = Number(guviDate.slice(5, 7));
  const guviDay = Number(guviDate.slice(8, 10));
  const guviDays = Array.from({ length: lastDayOfMonth(guviYear, guviMonth) }, (_, i) => i + 1);
  const setGuviDateParts = (year: number, month: number, day: number) => {
    const maxDay = lastDayOfMonth(year, month);
    const nextDay = Math.min(day, maxDay);
    setGuviDate(`${year}-${String(month).padStart(2, "0")}-${String(nextDay).padStart(2, "0")}`);
    setGuvi(null);
    setGuviError(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>

      {/* Title */}
      <div>
        <h1 className="page-title">📊 TEC Time Series Viewer</h1>
        <p className="page-subtitle">Integrated space weather analysis using space-segment and ground-segment observations, including GNSS TEC, geomagnetic measurements, solar activity</p>
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
          Space Segment - Geomagnetic indices + GNSS-RO - NASA OMNIWeb · CelesTrak · GFZ Potsdam (DE) · WDC Kyoto (JP) · COSMIC-2
        </div>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: 0 }}>
          Load daily space-weather indices from all four providers in one request, then compare Kp, Dst, F10.7,
          SSN, and Ap on shared charts. COSMIC-2 adds provisional GNSS radio-occultation ionPrf archive coverage
          from UCAR for independent ionospheric profile context.
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
          <button className="btn btn-secondary" onClick={loadCosmic2} disabled={cosmic2Loading || (loading && obs.length === 0)}>
            {cosmic2Loading ? "Checking COSMIC-2..." : "Load COSMIC-2"}
          </button>
        </div>
        {start && end && (
          <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
            Selected range: {start} → {end}
          </div>
        )}
        <div className="on2-inline-note">
          TIMED/GUVI O/N2 maps and COSMIC-2 GNSS-RO ionPrf profiles are satellite space-segment products. COSMIC-2
          archive checks use UCAR provisional daily Level-2 tarballs under level2/YYYY/DDD.
        </div>
      </div>

      <div className="omni-range-card">
        <div className="omni-range-title">Thermosphere O/N2 - TIMED/GUVI Level-3 Map Context</div>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: 0 }}>
          Load one TIMED/GUVI O/N2 reference overpass date and plot the thermospheric composition context using the
          same map-and-legend format as the GUVI gallery product.
        </p>
        <div className="omni-range-grid">
          <label>
            Month
            <select value={guviMonth} onChange={(e) => setGuviDateParts(guviYear, Number(e.target.value), guviDay)}>
              {MONTHS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </label>
          <label>
            Date
            <select value={guviDay} onChange={(e) => setGuviDateParts(guviYear, guviMonth, Number(e.target.value))}>
              {guviDays.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </label>
          <label>
            Year
            <select value={guviYear} onChange={(e) => setGuviDateParts(Number(e.target.value), guviMonth, guviDay)}>
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
          <button className="btn btn-secondary" onClick={loadGuviOn2} disabled={guviLoading || (loading && obs.length === 0)}>
            {guviLoading ? "Loading O/N2..." : "Load O/N2"}
          </button>
        </div>
        <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
          Selected O/N2 date: {guviDate}. Click Load O/N2 to plot the TIMED/GUVI map.
        </div>
        {guviLoading && (
          <div className="empty-state">Loading TIMED/GUVI O/N2 map...</div>
        )}
        {guviError && (
          <div className="error-box">{guviError}</div>
        )}
        {guvi && !guviLoading && (
          <GuviOn2MapPreview date={guviDate} guvi={guvi} />
        )}
      </div>

      {/* INTERMAGNET date range — ground magnetometer H / dB/dt */}
      <div className="omni-range-card">
        <div className="omni-range-title">Ground Segment - Geomagnetic Observatory (H field · dB/dt · modelled GIC)</div>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: 0 }}>
          Pull 1-minute ground-magnetometer data from observatories nearest Zimbabwe, then overlay
          locally-measured geomagnetic storm days on VTEC. Storms
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
            {intermagnetLoading ? "Loading…" : "Load analysis"}
          </button>
        </div>
        {(() => {
          const r = rangeFromMonths(imagStartYear, imagStartMonth, imagEndYear, imagEndMonth);
          return (
            <div style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
              Selected range: {r.start} to {r.end} - minute data is aggregated to daily statistics (fetch may take
              ~30-60 s per month)
            </div>
          );
        })()}
      </div>

      <IonosondeDidbasePanel
        startMonth={imagStartMonth}
        endYear={imagEndYear}
        day={ionosondeDay}
        station={ionosondeCode}
        stationOptions={meta?.stations ?? []}
        yearOptions={yearOptions}
        onStartMonth={setImagStartMonth}
        onEndYear={setImagEndYear}
        onDay={setIonosondeDay}
        onStation={setIonosondeCode}
      />

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
        {([["daily","Daily Variation"],["monthly","Monthly Averages"],["seasonal","Seasonal / Yearly"],["diurnal","Diurnal Pattern"],["compare","Source Comparison"],["storms","NASA OMNI"],["celestrak","CelesTrak"],["gfz","GFZ Kp"],["guvi","Thermosphere O/N2"],["cosmic2","COSMIC-2"],["intermagnet","INTERMAGNET"]] as [Tab,string][]).map(([id, label]) => (
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

      {/* TIMED/GUVI O/N2 analysis */}
      {tab === "guvi" && (
        <GuviOn2AnalysisPanel
          guvi={guvi}
          vtecLabels={allDates}
          vtecDatasets={dailyDatasets}
          loading={guviLoading}
          error={guviError}
        />
      )}

      {/* ── INTERMAGNET analysis ── */}
      {tab === "cosmic2" && (
        <Cosmic2AnalysisPanel
          cosmic2={cosmic2}
          vtecLabels={allDates}
          vtecDatasets={dailyDatasets}
          loading={cosmic2Loading}
          error={cosmic2Error}
        />
      )}

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
