"use client";
import { useState, useRef, useEffect } from "react";
import dynamic from "next/dynamic";
import {
  uploadCmn, uploadRinex, getSessionSummary, getSessionHourly, getSessionTecPlot, getSessionBias,
  getStations, downloadSessionRaw,
} from "@/lib/api";
import LineChart from "@/components/charts/LineChart";
import type { TecSummaryRow, TecHourlyRow, TecPlotSeries, BiasRow, Station } from "@/lib/types";
import type { MapLayer } from "@/components/maps/CorsMapWithLayers";

function formatDayLabel(dateStr: string) {
  const d = new Date(dateStr.slice(0, 10));
  if (isNaN(d.getTime())) return dateStr.slice(0, 10);
  return d.toLocaleDateString("en-US", { month: "short", day: "2-digit" });
}

function formatMonthLabel(monthStr: string) {
  const d = new Date(`${monthStr.slice(0, 7)}-01`);
  if (isNaN(d.getTime())) return monthStr;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function formatHourLabel(hour: number) {
  const hh = Math.floor(hour);
  const mm = Math.round((hour - hh) * 60);
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function summaryDateLabel(dateStr: string, mode: "daily" | "monthly" | "yearly") {
  if (mode === "monthly") return formatMonthLabel(dateStr);
  if (mode === "yearly") return dateStr;
  return formatDayLabel(dateStr);
}

function downloadCsv(filename: string, headers: string[], rows: (string | number | boolean | null | undefined)[][]) {
  const csv = [headers.join(","), ...rows.map((r) => r.map((v) => (v === null || v === undefined ? "" : String(v))).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

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
  const [hourlyRows, setHourlyRows] = useState<TecHourlyRow[]>([]);
  const [mode, setMode]         = useState<Mode>("daily");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [tecPlot, setTecPlot] = useState<TecPlotSeries | null>(null);
  const [loading, setLoading]   = useState(false);
  const [tab, setTab]           = useState<"cmn" | "rinex">("cmn");
  const [mapLayer, setMapLayer] = useState<MapLayer>("Hybrid");
  const [cmnName, setCmnName]   = useState("No file selected");
  const [obsFiles, setObsFiles] = useState<File[]>([]);
  const [navFiles, setNavFiles] = useState<File[]>([]);
  const [unmatchedNames, setUnmatchedNames] = useState<string[]>([]);
  const [browseObs, setBrowseObs] = useState(true);
  const [browseN, setBrowseN] = useState(true);
  const [browseG, setBrowseG] = useState(true);
  const [folderLabel, setFolderLabel] = useState("No folder selected");
  const [processingMode, setProcessingMode] = useState<"day" | "month" | "year" | "directory">("directory");
  const todayIso = new Date().toISOString().slice(0, 10);
  const [targetDay, setTargetDay] = useState(todayIso);
  const [targetMonth, setTargetMonth] = useState(todayIso.slice(0, 7));
  const [targetYear, setTargetYear] = useState(new Date().getFullYear());
  const rinexRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const cmnRef = useRef<HTMLInputElement>(null);

  // Sidebar settings — parity with pages/2_Processing.py
  const [stationsList, setStationsList] = useState<Station[]>([]);
  const [allStations, setAllStations] = useState(true);
  const [selectedStations, setSelectedStations] = useState<string[]>([]);
  const [elevMin, setElevMin] = useState(25);
  const [ippHeight, setIppHeight] = useState(350);
  const [dcbFolder, setDcbFolder] = useState("");
  const [kpCsv, setKpCsv] = useState("");
  const [outCmn, setOutCmn] = useState(true);
  const [outStd, setOutStd] = useState(true);
  const [outBias, setOutBias] = useState(true);
  const [outImg, setOutImg] = useState(true);
  const [outPrn, setOutPrn] = useState(true);
  const [outUnbias, setOutUnbias] = useState(true);
  const [biasRows, setBiasRows] = useState<BiasRow[]>([]);
  const [tecPlotRaw, setTecPlotRaw] = useState<TecPlotSeries | null>(null);

  useEffect(() => {
    getStations().then(setStationsList).catch(() => setStationsList([]));
  }, []);

  const imgLabel = {
    day: "TEC Image (24 hrs)",
    month: "TEC Image (Monthly)",
    year: "TEC Image (Yearly)",
    directory: "TEC Image (All data)",
  }[processingMode];

  function classifyRinexFile(name: string): "obs" | "nav-n" | "nav-g" | null {
    const lower = name.toLowerCase();
    if (/\.(rnx|obs)$/.test(lower) || /\d{2}o$/.test(lower)) return "obs";
    if (/\.(nav|gnav|hnav)$/.test(lower) || /\d{2}n$/.test(lower)) return "nav-n";
    if (/\.g$/.test(lower) || /\d{2}g$/.test(lower)) return "nav-g";
    return null;
  }

  // Mirrors pages/2_Processing.py::parse_rinex_obs_date — station code + day-of-year + 2-digit year.
  function parseRinexObsDate(name: string): Date | null {
    const m = /[a-z0-9_]{4}(\d{3})0\.(\d{2})o$/i.exec(name);
    if (!m) return null;
    const doy = parseInt(m[1], 10);
    const year = 2000 + parseInt(m[2], 10);
    const d = new Date(Date.UTC(year, 0, 1));
    d.setUTCDate(d.getUTCDate() + doy - 1);
    return d;
  }

  function keepByProcessingMode(date: Date | null): boolean {
    if (!date) return processingMode === "directory";
    const iso = date.toISOString();
    if (processingMode === "day") return iso.slice(0, 10) === targetDay;
    if (processingMode === "month") return iso.slice(0, 7) === targetMonth;
    if (processingMode === "year") return date.getUTCFullYear() === targetYear;
    return true;
  }

  function buildRinexAccept(): string {
    const parts: string[] = [];
    if (browseObs) parts.push(".rnx", ".obs", ".o", ".24o", ".25o", ".26o");
    if (browseN) parts.push(".nav", ".n", ".24n", ".25n", ".26n");
    if (browseG) parts.push(".g", ".24g", ".25g", ".26g");
    return parts.join(",");
  }

  function classifyAndSetRinexFiles(files: File[], applyDateFilter: boolean) {
    const obs: File[] = [];
    const nav: File[] = [];
    const unmatched: string[] = [];
    for (const f of files) {
      const kind = classifyRinexFile(f.name);
      if (kind === "obs") {
        if (!browseObs) continue;
        if (applyDateFilter && !keepByProcessingMode(parseRinexObsDate(f.name))) continue;
        obs.push(f);
      } else if (kind === "nav-n") {
        if (browseN) nav.push(f);
      } else if (kind === "nav-g") {
        if (browseG) nav.push(f);
      } else {
        unmatched.push(f.name);
      }
    }
    setObsFiles(obs);
    setNavFiles(nav);
    setUnmatchedNames(unmatched);
  }

  function handleFolderBrowse(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.currentTarget.files ?? []);
    if (files.length === 0) return;
    const relPath = (files[0] as File & { webkitRelativePath?: string }).webkitRelativePath;
    setFolderLabel(relPath ? relPath.split("/")[0] : `${files.length} file(s)`);
    classifyAndSetRinexFiles(files, true);
  }

  function handleFilesBrowse(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.currentTarget.files ?? []);
    if (files.length === 0) return;
    setFolderLabel(files.length === 1 ? files[0].name : `${files.length} files selected`);
    classifyAndSetRinexFiles(files, false);
  }

  async function loadSummary(id: string, m: Mode) {
    const data = await getSessionSummary(id, m);
    setRows(data);
  }

  async function loadHourly(id: string) {
    if (processingMode !== "day") return setHourlyRows([]);
    try { setHourlyRows(await getSessionHourly(id)); } catch { setHourlyRows([]); }
  }

  function buildOptions() {
    return {
      elevationMin: elevMin,
      ippHeight,
      dcbFolder,
      stations: allStations ? [] : selectedStations,
      kpCsv,
    };
  }

  async function loadBias(id: string) {
    try { setBiasRows(await getSessionBias(id)); } catch { setBiasRows([]); }
  }

  async function handleProcess() {
    setBiasRows([]); setTecPlotRaw(null); setHourlyRows([]);
    if (tab === "cmn") {
      const file = cmnRef.current?.files?.[0];
      if (!file) return setStatus("Select a .Cmn file first.");
      setLoading(true); setStatus("Processing…");
      try {
        const sess = await uploadCmn(file, buildOptions());
        setSessionId(sess.session_id);
        setTecPlot(null);
        setStatus(`Done — ${sess.rows.toLocaleString()} observations`);
        await loadSummary(sess.session_id, mode);
        await loadHourly(sess.session_id);
        if (outBias) await loadBias(sess.session_id);
      } catch (e) { setStatus(`Error: ${e}`); }
    } else {
      if (!obsFiles.length) return setStatus("Select at least one observation file.");
      if (!navFiles.length) {
        setStatus("Warning: no navigation file selected — select the matching .24n file together with the .24o file.");
      }
      setLoading(true); setStatus("Processing RINEX…");
      try {
        const sess = await uploadRinex(obsFiles, navFiles, buildOptions());
        setSessionId(sess.session_id);
        setStatus(`Done — ${sess.rows.toLocaleString()} observations`);
        await loadSummary(sess.session_id, mode);
        await loadHourly(sess.session_id);
        if (outImg || outPrn) {
          const plot = await getSessionTecPlot(sess.session_id);
          setTecPlot(plot);
        }
        if (outUnbias) {
          const raw = await getSessionTecPlot(sess.session_id, true);
          setTecPlotRaw(raw);
        }
        if (outBias) await loadBias(sess.session_id);
      } catch (e) { setTecPlot(null); setStatus(`Error: ${e}`); }
    }
    setLoading(false);
  }

  async function handleDownloadCmn() {
    if (!sessionId) return;
    const blob = await downloadSessionRaw(sessionId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${sessionId}_TEC_all_PRNs.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  function handleDownloadStd() {
    if (!sessionId) return;
    downloadCsv(`${sessionId}_STD_Mean_TEC.csv`,
      ["date", "mean_vtec", "max_vtec", "min_vtec", "samples", "storm_flag", "kp_index"],
      rows.map((r) => [r.date, r.mean_vtec, r.max_vtec, r.min_vtec, r.samples, r.storm_flag ?? "", r.kp_index ?? ""]));
  }

  function handleDownloadBias() {
    if (!sessionId) return;
    downloadCsv(`${sessionId}_Bias.csv`,
      ["station", "mean_stec", "mean_vtec", "dcb_folder"],
      biasRows.map((r) => [r.station, r.mean_stec, r.mean_vtec, r.dcb_folder]));
  }

  async function changeMode(m: Mode) {
    setMode(m);
    if (sessionId) { setLoading(true); await loadSummary(sessionId, m); setLoading(false); }
  }

  const useHourly = processingMode === "day" && hourlyRows.length > 0;
  const summaryLabels = rows.map((r) => summaryDateLabel(r.date, mode));
  const hourlyLabels = hourlyRows.map((r) => formatHourLabel(r.ut_hour));
  const vtecLabels = useHourly ? hourlyLabels : summaryLabels;
  const meanVtecValues = useHourly ? hourlyRows.map((r) => r.mean_vtec ?? 0) : rows.map((r) => r.mean_vtec ?? 0);
  const maxVtecValues = useHourly ? hourlyRows.map((r) => r.max_vtec ?? 0) : rows.map((r) => r.max_vtec ?? 0);
  const minVtecValues = useHourly ? hourlyRows.map((r) => r.min_vtec ?? 0) : rows.map((r) => r.min_vtec ?? 0);
  const daytimeVtecValues = rows.map((r) => r.daytime_mean_vtec ?? r.mean_vtec ?? 0);

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
            <div className="file-picker-row">
              <button type="button" className="file-picker-button" onClick={() => cmnRef.current?.click()}>
                <span className="file-picker-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M4 6.5h5l2 2h9v9.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z" />
                    <path d="M12 12v5m-2-2 2 2 2-2" />
                  </svg>
                </span>
                Select file
              </button>
              <span className="file-picker-name">{cmnName}</span>
              <input
                ref={cmnRef}
                type="file"
                accept=".Cmn,.cmn,.csv"
                className="file-picker-input"
                onChange={(e) => setCmnName(e.currentTarget.files?.[0]?.name ?? "No file selected")}
              />
            </div>
            {cmnName !== "No file selected" && (
              <div className="card" style={{ padding: "0.6rem 0.9rem", fontSize: "0.78rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                <div><strong>Type:</strong> CMN</div>
                <div><strong>Total file(s) found#</strong> 1</div>
              </div>
            )}
          </div>
        )}

        {tab === "rinex" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
            <label style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
              RINEX files — select the observation (.o) and matching navigation (.n) file together
            </label>

            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
              <button type="button" className="file-picker-button" style={{ flex: "1 1 180px", justifyContent: "center" }}
                onClick={() => folderRef.current?.click()}>
                <span className="file-picker-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
                  </svg>
                </span>
                Browse folder…
              </button>
              <button type="button" className="file-picker-button" style={{ flex: "1 1 180px", justifyContent: "center" }}
                onClick={() => rinexRef.current?.click()}>
                <span className="file-picker-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24">
                    <path d="M4 6.5h5l2 2h9v9.5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8.5a2 2 0 0 1 2-2Z" />
                    <path d="M12 12v5m-2-2 2 2 2-2" />
                  </svg>
                </span>
                Browse files…
              </button>
              <input
                ref={folderRef}
                type="file"
                multiple
                className="file-picker-input"
                onChange={handleFolderBrowse}
                {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              />
              <input
                ref={rinexRef}
                type="file"
                multiple
                accept={buildRinexAccept()}
                className="file-picker-input"
                onChange={handleFilesBrowse}
              />
            </div>

            <div>
              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: "0 0 0.35rem" }}>
                Browse file types (G/N/O triplets — e.g. karo1140.24o / .24n / .24g)
              </p>
              <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap", fontSize: "0.8rem" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                  <input type="checkbox" checked={browseObs} onChange={(e) => setBrowseObs(e.target.checked)} />
                  Obs (.o)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                  <input type="checkbox" checked={browseN} onChange={(e) => setBrowseN(e.target.checked)} />
                  GPS nav (.n)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                  <input type="checkbox" checked={browseG} onChange={(e) => setBrowseG(e.target.checked)} />
                  GLONASS nav (.g)
                </label>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
              <label className="metric-label">Folder path</label>
              <input
                value={folderLabel}
                readOnly
                title="Browsers don't expose full filesystem paths — this shows the name of the folder/files you picked."
                style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.4rem 0.7rem", color: "var(--text)" }}
              />
            </div>

            <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: 0 }}>
              {obsFiles.length === 0 && navFiles.length === 0
                ? "No files selected"
                : `RINEX · Selected: ${obsFiles.length} obs · ${navFiles.length} nav (.n/.g) — ${obsFiles.length ? obsFiles.map((f) => f.name).join(", ") : "none"}`}
            </p>
            {(obsFiles.length > 0 || navFiles.length > 0) && (
              <div className="card" style={{ padding: "0.6rem 0.9rem", fontSize: "0.78rem", display: "flex", flexDirection: "column", gap: "0.15rem" }}>
                <div><strong>Type:</strong> Rinex</div>
                <div><strong>Total file(s) found#</strong> {obsFiles.length + navFiles.length}</div>
                <div style={{ color: "var(--text-muted)" }}>{obsFiles.length} observation · {navFiles.length} navigation</div>
              </div>
            )}
            <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", margin: 0 }}>
              Ctrl/Cmd-click to pick both files in one dialog (e.g. karo1210.24o + karo1210.24n) — files are sorted into observation/navigation automatically by extension. Use Browse folder… to scan a whole directory at once.
            </p>
            {obsFiles.length > 0 && navFiles.length === 0 && (
              <div className="banner banner-alert">
                No matching navigation file detected — select the .24n file alongside the .24o file, or elevations can&apos;t be computed and processing will return zero rows.
              </div>
            )}
            {unmatchedNames.length > 0 && (
              <div className="banner banner-alert">
                Unrecognized file(s) ignored: {unmatchedNames.join(", ")}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Settings panel — parity with pages/2_Processing.py sidebar */}
      <div className="card" style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", borderBottom: "1px solid var(--border)", paddingBottom: "0.8rem" }}>
          <label className="metric-label">Processing mode</label>
          <div style={{ display: "flex", gap: "1.2rem", flexWrap: "wrap", fontSize: "0.8rem" }}>
            {([
              ["day", "This Day only"],
              ["month", "This Month"],
              ["year", "This Year"],
              ["directory", "Directory"],
            ] as const).map(([value, label]) => (
              <label key={value} style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer" }}>
                <input
                  type="radio"
                  name="processing-mode"
                  checked={processingMode === value}
                  onChange={() => setProcessingMode(value)}
                />
                {label}
              </label>
            ))}
          </div>
          {processingMode === "day" && (
            <input type="date" value={targetDay} onChange={(e) => setTargetDay(e.target.value)}
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.4rem 0.7rem", color: "var(--text)", width: "fit-content" }} />
          )}
          {processingMode === "month" && (
            <input type="month" value={targetMonth} onChange={(e) => setTargetMonth(e.target.value)}
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.4rem 0.7rem", color: "var(--text)", width: "fit-content" }} />
          )}
          {processingMode === "year" && (
            <input type="number" value={targetYear} onChange={(e) => setTargetYear(parseInt(e.target.value, 10) || targetYear)}
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.4rem 0.7rem", color: "var(--text)", width: "110px" }} />
          )}
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", fontSize: "0.85rem", fontWeight: 600 }}>
          <input type="checkbox" checked={allStations} onChange={(e) => setAllStations(e.target.checked)} />
          All stations
        </label>

        {!allStations && (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
            <label className="metric-label">Zimbabwe CORS stations</label>
            <select
              multiple
              value={selectedStations}
              onChange={(e) => setSelectedStations(Array.from(e.currentTarget.selectedOptions).map((o) => o.value))}
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.4rem 0.7rem", color: "var(--text)", minHeight: "110px" }}
            >
              {stationsList.map((s) => (
                <option key={s.code} value={s.code}>{s.code} - {s.name}</option>
              ))}
            </select>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.7rem" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label className="metric-label">Min elevation (°)</label>
            <input type="number" min={0} max={90} step={1} value={elevMin}
              onChange={(e) => setElevMin(parseFloat(e.target.value) || 0)}
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.4rem 0.7rem", color: "var(--text)" }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
            <label className="metric-label">IPP height (km)</label>
            <input type="number" min={250} max={600} step={1} value={ippHeight}
              onChange={(e) => setIppHeight(parseFloat(e.target.value) || 0)}
              style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.4rem 0.7rem", color: "var(--text)" }} />
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <label className="metric-label" title="Folder containing CODE DCB files (P1C1YYMM.DCB, P1P2YYMM.DCB). Leave blank to use the server default.">
            DCB folder (P1C1/P1P2 files)
          </label>
          <input value={dcbFolder} onChange={(e) => setDcbFolder(e.target.value)}
            placeholder="Leave blank for server default"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.4rem 0.7rem", color: "var(--text)" }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.25rem" }}>
          <label className="metric-label">KP index CSV (optional path)</label>
          <input value={kpCsv} onChange={(e) => setKpCsv(e.target.value)}
            placeholder="Optional server-side path to a Kp CSV"
            style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: "6px", padding: "0.4rem 0.7rem", color: "var(--text)" }} />
        </div>

        <div style={{ borderTop: "1px solid var(--border)", paddingTop: "0.6rem" }}>
          <div style={{ fontWeight: 700, fontSize: "0.85rem", marginBottom: "0.5rem" }}>Output files</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            {([
              ["CMN file (TEC-all PRNs)", outCmn, setOutCmn],
              ["STD file (Mean TEC)", outStd, setOutStd],
              ["Bias file (DCBs used)", outBias, setOutBias],
              [imgLabel, outImg, setOutImg],
              ["TEC PRN Images", outPrn, setOutPrn],
              ["(Un)/Bias TEC image", outUnbias, setOutUnbias],
            ] as [string, boolean, (v: boolean) => void][]).map(([label, val, setVal]) => (
              <label key={label} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                <input type="checkbox" checked={val} onChange={(e) => setVal(e.target.checked)} />
                <span style={{
                  background: val ? "#006622" : "#1a2a3a", borderRadius: "4px", padding: "3px 8px",
                  fontSize: "0.8rem", color: "#fff", fontWeight: 600,
                }}>{label}</span>
              </label>
            ))}
          </div>
        </div>
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
        <div style={{ display: "flex", gap: "0.6rem", overflowX: "auto" }}>
          {PIPELINE_STAGES.map(({ icon, label, color }, i) => (
            <div key={label} className="card" style={{ flex: "1 1 0", minWidth: "120px", textAlign: "center", cursor: "default", borderLeft: `3px solid ${color}`, padding: "0.8rem" }}>
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
          <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
            {(["daily", "monthly", "yearly"] as Mode[]).map((m) => (
              <button key={m} className={`tab${mode === m ? " active" : ""}`}
                onClick={() => changeMode(m)}
                style={{ borderBottom: "none", border: "1px solid var(--border)", borderRadius: "6px" }}>
                {m.charAt(0).toUpperCase() + m.slice(1)}
              </button>
            ))}
            <div style={{ flex: 1 }} />
            {outCmn && (
              <button className="btn" onClick={handleDownloadCmn} style={{ fontSize: "0.78rem", padding: "0.35rem 0.8rem" }}>
                ⬇ CMN file
              </button>
            )}
            {outStd && (
              <button className="btn" onClick={handleDownloadStd} style={{ fontSize: "0.78rem", padding: "0.35rem 0.8rem" }}>
                ⬇ STD file
              </button>
            )}
            {outBias && biasRows.length > 0 && (
              <button className="btn" onClick={handleDownloadBias} style={{ fontSize: "0.78rem", padding: "0.35rem 0.8rem" }}>
                ⬇ Bias file
              </button>
            )}
          </div>
          {outImg && tecPlot && tecPlot.mean.length > 0 && (
            <div className="card">
              <div className="metric-label" style={{ marginBottom: "0.6rem" }}>
                {imgLabel} (GOP-style, bias removed) — {tecPlot.datasets.length} PRN arcs
              </div>
              <LineChart
                labels={tecPlot.mean.map((p) => (p.x ?? 0).toFixed(1))}
                datasets={[
                  {
                    label: "Mean VTEC",
                    data: tecPlot.mean.map((p) => p.y ?? 0),
                    color: "#00cc66",
                    fill: true,
                  },
                ]}
                yLabel={tecPlot.ylabel}
                height={300}
              />
              <p style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.5rem" }}>
                Gopi Ch.4 pipeline: TECG/TECP (Eqs 4.10–4.12), leveling (4.14–4.15), DCB (4.16), mapping + VTEC (4.17).
                Upload matching .24n navigation with every .24o file.
              </p>
            </div>
          )}
          {outUnbias && tecPlot && tecPlotRaw && tecPlot.mean.length > 0 && (
            <div className="card">
              <div className="metric-label" style={{ marginBottom: "0.6rem" }}>(Un)/Bias TEC image — raw vs DCB-corrected VTEC</div>
              <LineChart
                labels={tecPlot.mean.map((p) => (p.x ?? 0).toFixed(1))}
                datasets={[
                  { label: "Bias-corrected VTEC", data: tecPlot.mean.map((p) => p.y ?? 0), color: "#00cc66", fill: false },
                  { label: "Raw VTEC", data: tecPlotRaw.mean.map((p) => p.y ?? 0), color: "#ff8c00", fill: false },
                ]}
                yLabel={tecPlot.ylabel}
                height={300}
              />
            </div>
          )}
          {outPrn && tecPlot && tecPlot.datasets.length > 0 && (
            <div className="card">
              <div className="metric-label" style={{ marginBottom: "0.6rem" }}>TEC PRN Images — {tecPlot.datasets.length} PRN arcs</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "0.8rem" }}>
                {tecPlot.datasets.map((ds) => (
                  <div key={ds.label}>
                    <div style={{ fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.3rem" }}>{ds.label}</div>
                    <LineChart
                      labels={ds.points.map((p) => (p.x ?? 0).toFixed(1))}
                      datasets={[{ label: ds.label, data: ds.points.map((p) => p.y ?? 0), color: "#168bd2", fill: false }]}
                      yLabel={tecPlot.ylabel}
                      height={160}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="card">
            <div className="metric-label" style={{ marginBottom: "0.6rem" }}>VTEC Six AM to Six PM Mean Value — {mode}</div>
            <LineChart labels={summaryLabels} datasets={[{ label: "6AM–6PM Mean VTEC (TECU)", data: daytimeVtecValues, color: "#00cc88", fill: true }]} height={280} />
          </div>
          <div className="card">
            <div className="metric-label" style={{ marginBottom: "0.6rem" }}>
              Maximum VTEC — {useHourly ? "hourly" : mode}
            </div>
            <LineChart labels={vtecLabels} datasets={[{ label: "Max VTEC (TECU)", data: maxVtecValues, color: "#ff8c00", fill: true }]} height={280} />
          </div>
          <div className="card">
            <div className="metric-label" style={{ marginBottom: "0.6rem" }}>
              Mean VTEC — {useHourly ? "hourly" : mode}
            </div>
            <LineChart labels={vtecLabels} datasets={[{ label: "Mean VTEC (TECU)", data: meanVtecValues, color: "#168bd2", fill: true }]} height={280} />
          </div>
          <div className="card">
            <div className="metric-label" style={{ marginBottom: "0.6rem" }}>
              Minimum VTEC — {useHourly ? "hourly" : mode}
            </div>
            <LineChart labels={vtecLabels} datasets={[{ label: "Min VTEC (TECU)", data: minVtecValues, color: "#a78bfa", fill: true }]} height={280} />
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
                    <td style={{ padding: "0.35rem 0.6rem" }}>{summaryDateLabel(r.date, mode)}</td>
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
