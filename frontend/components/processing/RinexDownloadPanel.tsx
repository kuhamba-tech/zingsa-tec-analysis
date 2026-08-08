"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  downloadRinexArchive,
  getRinexArchiveAvailability,
  getRinexArchiveStatus,
  getStations,
} from "@/lib/api";
import type { Station } from "@/lib/types";

type StationRow = {
  code: string;
  name: string;
  mountpoint: string;
  days_available: number;
  days_requested: number;
  obs_files: number;
  availability_pct: number;
};

type AvailabilityPayload = {
  ok: boolean;
  message: string | null;
  archive_configured: boolean;
  url_configured: boolean;
  brdc_nav_available: boolean;
  station_rows?: StationRow[];
  coverage_pct?: number;
  period_days?: number;
  files?: unknown[];
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export default function RinexDownloadPanel() {
  const [stations, setStations] = useState<Station[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [start, setStart] = useState(todayIso());
  const [end, setEnd] = useState(todayIso());
  const [projectName, setProjectName] = useState("");
  const [includeNav, setIncludeNav] = useState(true);
  const [includeBrdc, setIncludeBrdc] = useState(true);
  const [obsRate, setObsRate] = useState("original");
  const [mergeFiles, setMergeFiles] = useState(false);
  const [query, setQuery] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [archiveReady, setArchiveReady] = useState(false);
  const [availability, setAvailability] = useState<AvailabilityPayload | null>(null);
  const [checking, setChecking] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getStations()
      .then((rows) => setStations(rows))
      .catch(() => setStations([]));
    getRinexArchiveStatus()
      .then((s) => {
        setArchiveReady(Boolean(s.archive_exists || s.url_template_configured));
        setStatusMsg(s.message ?? null);
      })
      .catch(() => {
        setArchiveReady(false);
        setStatusMsg("Could not reach RINEX archive status endpoint.");
      });
  }, []);

  const filteredStations = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return stations;
    return stations.filter(
      (s) =>
        s.code.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.mountpoint ?? "").toLowerCase().includes(q),
    );
  }, [stations, query]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = (code: string) => {
    setSelected((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  };

  const selectAllVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const s of filteredStations) next.add(s.code);
      return [...next];
    });
  };

  const clearSelection = () => setSelected([]);

  const checkAvailability = useCallback(async () => {
    if (selected.length === 0) {
      setError("Select at least one CORS station.");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      const data = await getRinexArchiveAvailability({
        stations: selected,
        start,
        end,
        includeNav,
      });
      setAvailability(data);
    } catch (e) {
      setAvailability(null);
      setError(e instanceof Error ? e.message : "Availability check failed");
    } finally {
      setChecking(false);
    }
  }, [selected, start, end, includeNav]);

  useEffect(() => {
    if (selected.length === 0) {
      setAvailability(null);
      return;
    }
    const t = window.setTimeout(() => {
      void checkAvailability();
    }, 350);
    return () => window.clearTimeout(t);
  }, [checkAvailability, selected.length]);

  const onDownload = async () => {
    if (selected.length === 0) {
      setError("Select at least one CORS station.");
      return;
    }
    setDownloading(true);
    setError(null);
    try {
      const blob = await downloadRinexArchive({
        stations: selected,
        start,
        end,
        include_nav: includeNav,
        include_brdc_nav: includeBrdc,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const label = projectName.trim().replace(/[^\w.-]+/g, "_") || `zgiis_rinex_${start}_${end}`;
      a.download = `${label}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloading(false);
    }
  };

  const coveragePct = availability?.coverage_pct ?? null;
  const stationRows = availability?.station_rows ?? [];
  const rowByCode = useMemo(() => {
    const m = new Map<string, StationRow>();
    for (const r of stationRows) m.set(r.code, r);
    return m;
  }, [stationRows]);

  return (
    <div className="rinex-pp">
      <header className="rinex-pp-hero">
        <div>
          <h2 className="rinex-pp-title">RINEX Data</h2>
          <p className="rinex-pp-lead">
            Download CORS observation files for office post-processing / PPK. Output is RINEX
            (archive native rate). Optionally include station nav and IGS BRDC broadcast ephemeris.
          </p>
        </div>
        <div className="rinex-pp-gauge" aria-label="Period data coverage">
          <div className="rinex-pp-gauge-ring">
            <strong>{coveragePct != null ? `${coveragePct.toFixed(0)}%` : "—"}</strong>
          </div>
          <span>Period: {availability?.period_days ?? "—"} day(s)</span>
        </div>
      </header>

      {!archiveReady && statusMsg && (
        <div className="banner banner-info" style={{ fontSize: "0.8rem" }}>
          {statusMsg} You can still request a package once the archive path is configured on the
          server (<code>RINEX_ARCHIVE_ROOT</code>).
        </div>
      )}

      <div className="rinex-pp-toolbar">
        <label className="rinex-pp-field">
          <span>Start</span>
          <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label className="rinex-pp-field">
          <span>End</span>
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <div className="rinex-pp-presets">
          <button type="button" onClick={() => { setStart(todayIso()); setEnd(todayIso()); }}>
            Today
          </button>
          <button type="button" onClick={() => { setStart(daysAgoIso(6)); setEnd(todayIso()); }}>
            7 days
          </button>
          <button type="button" onClick={() => { setStart(daysAgoIso(29)); setEnd(todayIso()); }}>
            30 days
          </button>
        </div>
        <label className="rinex-pp-field rinex-pp-project">
          <span>Project name</span>
          <input
            type="text"
            value={projectName}
            placeholder="Optional zip name"
            onChange={(e) => setProjectName(e.target.value)}
          />
        </label>
        <div className="rinex-pp-selected">
          Selected: <strong>{selected.length || "None"}</strong>
        </div>
        <button
          type="button"
          className="rinex-pp-submit"
          onClick={onDownload}
          disabled={downloading || selected.length === 0}
        >
          {downloading ? "Preparing…" : "Submit / Download ZIP"}
        </button>
      </div>

      <div className="rinex-pp-options">
        <label>
          <input type="checkbox" checked={mergeFiles} onChange={(e) => setMergeFiles(e.target.checked)} />
          Merge files <em>(packaged per day/station; merge in your PP software)</em>
        </label>
        <label>
          Observation rate
          <select value={obsRate} onChange={(e) => setObsRate(e.target.value)}>
            <option value="original">Original (archive)</option>
            <option value="1">1 sec (request native if archived)</option>
            <option value="15">15 sec</option>
            <option value="30">30 sec</option>
          </select>
        </label>
        <label>
          <input type="checkbox" checked={includeNav} onChange={(e) => setIncludeNav(e.target.checked)} />
          Include station navigation files
        </label>
        <label>
          <input type="checkbox" checked={includeBrdc} onChange={(e) => setIncludeBrdc(e.target.checked)} />
          Include BRDC nav (IGS/BKG)
        </label>
      </div>

      <div className="rinex-pp-body">
        <aside className="rinex-pp-list-pane">
          <div className="rinex-pp-list-head">
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search sites…"
              aria-label="Search sites"
            />
            <div className="rinex-pp-list-actions">
              <button type="button" onClick={selectAllVisible}>
                Select all
              </button>
              <button type="button" onClick={clearSelection}>
                Clear
              </button>
              <button type="button" onClick={() => void checkAvailability()} disabled={checking || selected.length === 0}>
                {checking ? "Checking…" : "Refresh"}
              </button>
            </div>
          </div>

          <ul className="rinex-pp-station-list">
            {filteredStations.map((s) => {
              const row = rowByCode.get(s.code.toLowerCase().replace(/_$/, ""));
              const pct = row?.availability_pct;
              const files = row?.obs_files ?? 0;
              const on = selectedSet.has(s.code);
              const live = (s.status || "").toLowerCase() === "online";
              return (
                <li key={s.code} className={on ? "is-selected" : undefined}>
                  <label className="rinex-pp-station-row">
                    <input type="checkbox" checked={on} onChange={() => toggle(s.code)} />
                    <span className={`rinex-pp-dot ${live ? "is-online" : "is-offline"}`} />
                    <span className="rinex-pp-station-meta">
                      <strong>
                        {(s.mountpoint || s.code).toUpperCase()}
                        <span> / {s.name}</span>
                      </strong>
                      <em>
                        {(s.constellations || []).slice(0, 4).join(" · ") || "GNSS"}
                        {s.site_server ? ` · ${s.site_server}` : ""}
                      </em>
                    </span>
                    <span
                      className={`rinex-pp-avail ${pct != null && pct > 0 ? "is-ok" : "is-empty"}`}
                      title={row ? `${row.days_available}/${row.days_requested} days` : "Check period"}
                    >
                      {row
                        ? `${files} file${files === 1 ? "" : "s"} (${(pct ?? 0).toFixed(0)}%)`
                        : selectedSet.has(s.code)
                          ? "…"
                          : "—"}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </aside>

        <div className="rinex-pp-map-pane">
          <div className="rinex-pp-map-grid">
            {stations.map((s) => {
              const on = selectedSet.has(s.code);
              const row = rowByCode.get(s.code.toLowerCase().replace(/_$/, ""));
              const hasData = (row?.obs_files ?? 0) > 0;
              const live = (s.status || "").toLowerCase() === "online";
              // Rough Zimbabwe plate: lon 25–33 → x, lat -22.4–-15.6 → y
              const x = ((s.lon - 25.1) / (33.1 - 25.1)) * 100;
              const y = ((-15.55 - s.lat) / (-15.55 - -22.4)) * 100;
              return (
                <button
                  key={s.code}
                  type="button"
                  className={`rinex-pp-map-pin ${on ? "is-selected" : ""} ${hasData ? "has-data" : ""} ${live ? "is-live" : ""}`}
                  style={{ left: `${Math.min(96, Math.max(4, x))}%`, top: `${Math.min(96, Math.max(4, y))}%` }}
                  title={`${s.code.toUpperCase()} — ${s.name}`}
                  onClick={() => toggle(s.code)}
                >
                  <span>{s.code.slice(0, 4).toUpperCase()}</span>
                </button>
              );
            })}
          </div>
          <p className="rinex-pp-map-caption">
            Click markers to select. Green ring = data in period · Dot = NTRIP online status.
          </p>
        </div>
      </div>

      {error && (
        <div className="banner banner-warn" style={{ fontSize: "0.8rem" }}>
          {error}
        </div>
      )}
    </div>
  );
}
