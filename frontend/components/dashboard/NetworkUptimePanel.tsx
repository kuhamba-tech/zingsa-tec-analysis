"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getStations,
  getStationStatusEvents,
  getStationUptimeAnalysis,
  getSpaceWeather,
  getTecHeatmap,
} from "@/lib/api";
import LineChart from "@/components/charts/LineChart";
import NetworkUpDownChart from "@/components/charts/NetworkUpDownChart";
import SiteAvailabilityRibbon from "@/components/charts/SiteAvailabilityRibbon";
import StationStatusBarChart from "@/components/charts/StationStatusBarChart";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import CorsMapWithLayers, { BASE_MAP_LAYERS } from "@/components/maps/CorsMapWithLayers";
import { analyzeStationUptime } from "@/lib/dashboardChartAnalysis";
import { countLiveStationStatuses } from "@/lib/liveStationStatus";
import { peekStations } from "@/lib/stationsStore";
import { mergeTecHeatmapWithStations } from "@/lib/tecHeatmapMerge";
import type {
  Station,
  StationStatusEvent,
  StationUptimeAnalysis,
  TecHeatmapResponse,
} from "@/lib/types";

export type UptimeRangeKey = "1d" | "1w" | "1m" | "1y";

const RANGES: { key: UptimeRangeKey; label: string; hours: number; yLabel: string }[] = [
  { key: "1d", label: "1 day", hours: 24, yLabel: "% online (1 day)" },
  { key: "1w", label: "1 week", hours: 168, yLabel: "% online (1 week)" },
  { key: "1m", label: "1 month", hours: 720, yLabel: "% online (1 month)" },
  { key: "1y", label: "1 year", hours: 8760, yLabel: "% online (1 year)" },
];

export function uptimeRangeIndex(key: string | null | undefined): number {
  const idx = RANGES.findIndex((r) => r.key === key);
  return idx >= 0 ? idx : 1;
}

export function uptimeRangeKey(index: number): UptimeRangeKey {
  return RANGES[index]?.key ?? "1w";
}

function downloadCsv(filename: string, rows: string[][]) {
  const body = rows
    .map((row) =>
      row
        .map((cell) => {
          const s = String(cell ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(","),
    )
    .join("\n");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function formatPeriodLabel(hours: number): string {
  return RANGES.find((r) => r.hours === hours)?.label ?? `${hours}h`;
}

function stationKey(code: string): string {
  return code.toLowerCase().replace(/_+$/, "");
}

function formatDurationMin(minutes: number): string {
  if (minutes < 60) return `${minutes.toFixed(0)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function eventTone(eventType: string, status: string): string {
  if (eventType === "site_down" || (eventType === "status_change" && status === "offline")) {
    return "#ff4444";
  }
  if (eventType === "site_up" || (eventType === "status_change" && status === "online")) {
    return "#00ff88";
  }
  if (eventType === "connection_lost") return "#ff8c00";
  return "var(--text)";
}

export default function NetworkUptimePanel({
  initialRangeKey = "1w",
  onRangeKeyChange,
  title = "Network Uptime Analysis",
}: {
  /** 1d / 1w / 1m / 1y — used by Reports → Station Uptime deep links. */
  initialRangeKey?: UptimeRangeKey | string;
  onRangeKeyChange?: (key: UptimeRangeKey) => void;
  title?: string;
}) {
  const [rangeIdx, setRangeIdx] = useState(() => uptimeRangeIndex(initialRangeKey)); // default 1 week
  const [station, setStation] = useState(""); // "" = whole network
  const [mapStations, setMapStations] = useState<Station[]>(() => peekStations());
  const [stationsLoading, setStationsLoading] = useState(true);
  const [ntripProbedAt, setNtripProbedAt] = useState<string | null>(null);
  const [tecHeatmap, setTecHeatmap] = useState<TecHeatmapResponse | null>(null);
  const [riskLevel, setRiskLevel] = useState("N/A");
  const [analysis, setAnalysis] = useState<StationUptimeAnalysis | null>(null);
  const [events, setEvents] = useState<StationStatusEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setRangeIdx(uptimeRangeIndex(initialRangeKey));
  }, [initialRangeKey]);

  const selectRange = (index: number) => {
    setRangeIdx(index);
    onRangeKeyChange?.(uptimeRangeKey(index));
  };

  const range = RANGES[rangeIdx] ?? RANGES[1];
  const liveCounts = useMemo(() => countLiveStationStatuses(mapStations), [mapStations]);
  const displayHeatmap = useMemo(
    () => mergeTecHeatmapWithStations(tecHeatmap, mapStations),
    [tecHeatmap, mapStations],
  );

  const loadStations = useCallback(async () => {
    setStationsLoading(true);
    try {
      const [catalog, heatmap, sw] = await Promise.all([
        getStations(false),
        getTecHeatmap(6).catch(() => null),
        getSpaceWeather().catch(() => null),
      ]);
      setMapStations(catalog);
      if (heatmap) setTecHeatmap(heatmap);
      if (sw?.gnss_risk) setRiskLevel(sw.gnss_risk);
      const probed = catalog.find((s) => s.ntrip_probed_at)?.ntrip_probed_at ?? null;
      setNtripProbedAt(probed);
    } catch {
      /* keep last-good markers */
    } finally {
      setStationsLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const stationArg = station || undefined;
    try {
      const [analysisPayload, eventsPayload] = await Promise.all([
        getStationUptimeAnalysis(range.hours, stationArg),
        getStationStatusEvents(range.hours, stationArg),
      ]);
      setAnalysis(analysisPayload);
      setEvents(eventsPayload.slice(-20).reverse());
    } catch (err) {
      setAnalysis(null);
      setEvents([]);
      setError(err instanceof Error ? err.message : "Failed to load uptime archive");
    } finally {
      setLoading(false);
    }
  }, [range.hours, station]);

  useEffect(() => {
    void loadStations();
  }, [loadStations]);

  useEffect(() => {
    void load();
  }, [load]);

  const stationOptions = useMemo(() => {
    if (mapStations.length > 0) {
      return [...mapStations]
        .map((s) => ({
          station_code: stationKey(s.code),
          station_name: s.name,
        }))
        .sort((a, b) => a.station_code.localeCompare(b.station_code));
    }
    const rows = analysis?.stations ?? [];
    return [...rows].sort((a, b) => a.station_code.localeCompare(b.station_code));
  }, [analysis?.stations, mapStations]);

  const timelineLabels = useMemo(
    () => (analysis?.timeline ?? []).map((p) => p.time.slice(0, 16).replace("T", " ")),
    [analysis?.timeline],
  );
  const timelineValues = useMemo(
    () => (analysis?.timeline ?? []).map((p) => p.online_pct),
    [analysis?.timeline],
  );

  const scopeLabel = station
    ? (analysis?.station_name
        ? `${analysis.station_code?.toUpperCase()} — ${analysis.station_name}`
        : station.toUpperCase())
    : "Whole network";

  const handleMapStationSelect = (selected: Station | null) => {
    if (!selected) {
      setStation("");
      return;
    }
    setStation(stationKey(selected.code));
  };

  const handleExportTimeline = () => {
    if (!analysis?.timeline.length) return;
    const header = [
      "time_utc",
      "online_pct",
      "online_count",
      "offline_count",
      "unknown_count",
      "samples",
      "scope",
      "hours",
      "bucket_minutes",
    ];
    const scope = station || "network";
    const rows = analysis.timeline.map((p) => [
      p.time,
      String(p.online_pct),
      String(p.online_count),
      String(p.offline_count),
      String(p.unknown_count),
      String(p.samples),
      scope,
      String(analysis.hours),
      String(analysis.bucket_minutes),
    ]);
    downloadCsv(
      `cors-uptime-timeline-${scope}-${formatPeriodLabel(analysis.hours).replace(/\s+/g, "")}.csv`,
      [header, ...rows],
    );
  };

  const handleExportStations = () => {
    if (!analysis?.stations.length) return;
    const header = [
      "station_code",
      "station_name",
      "samples",
      "online_pct",
      "offline_pct",
      "unknown_pct",
      "hours",
    ];
    const rows = analysis.stations.map((r) => [
      r.station_code,
      r.station_name,
      String(r.samples),
      String(r.online_pct),
      String(r.offline_pct),
      String(r.unknown_pct),
      String(analysis.hours),
    ]);
    downloadCsv(
      `cors-uptime-stations-${formatPeriodLabel(analysis.hours).replace(/\s+/g, "")}.csv`,
      [header, ...rows],
    );
  };

  const hasAnyData =
    (analysis?.samples ?? 0) > 0 ||
    (analysis?.timeline.length ?? 0) > 0 ||
    (analysis?.stations.some((r) => r.samples > 0) ?? false);

  return (
    <div className="card card-accent">
      <div className="operations-chart-title">
        {title}
        {analysis ? ` · ${formatPeriodLabel(analysis.hours)}` : ""}
      </div>
      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.85rem" }}>
        Site up/down events are archived automatically (NTRIP ingest or Spider Site Status).
        Green = online, red = offline. Use the charts below to assess performance, outages, and
        network-wide availability over 1 day to 1 year.
      </p>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "0.55rem",
          alignItems: "center",
          marginBottom: "0.9rem",
        }}
      >
        <label style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Station</label>
        <select
          className="form-select"
          value={station}
          onChange={(e) => setStation(e.target.value)}
          style={{ minWidth: "14rem" }}
        >
          <option value="">Whole network</option>
          {stationOptions.map((row) => (
            <option key={row.station_code} value={row.station_code}>
              {row.station_code.toUpperCase()} — {row.station_name}
            </option>
          ))}
        </select>
        {RANGES.map((r, i) => (
          <button
            key={r.key}
            type="button"
            className={`home-map-layer-btn${rangeIdx === i ? " is-active" : ""}`}
            onClick={() => selectRange(i)}
          >
            {r.label}
          </button>
        ))}
        <button type="button" className="home-map-layer-btn" onClick={() => void load()} disabled={loading}>
          Refresh
        </button>
        <button
          type="button"
          className="home-map-layer-btn"
          onClick={handleExportTimeline}
          disabled={!analysis?.timeline.length}
        >
          Export timeline CSV
        </button>
        <button
          type="button"
          className="home-map-layer-btn"
          onClick={handleExportStations}
          disabled={!analysis?.stations.length}
        >
          Export stations CSV
        </button>
      </div>

      <div className="home-cors-map-section" style={{ marginBottom: "1rem" }}>
        <CorsMapWithLayers
          stations={mapStations}
          height={480}
          riskLevel={riskLevel}
          liveCounts={liveCounts}
          ntripProbedAt={ntripProbedAt}
          stationsLoading={stationsLoading}
          heatmap={displayHeatmap}
          highlightCode={station || null}
          onStationSelect={handleMapStationSelect}
          layers={BASE_MAP_LAYERS}
        />
      </div>

      {loading && (
        <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Loading uptime archive…</p>
      )}
      {error && <div className="banner banner-warn">{error}</div>}

      {!loading && !error && !hasAnyData && (
        <div className="banner banner-info">
          No status snapshots in the selected window yet. Uptime charts stay empty until the live
          NTRIP collector archives real station polls.
        </div>
      )}

      {analysis && hasAnyData && (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(9.5rem, 1fr))",
              gap: "0.65rem",
              marginBottom: "1rem",
            }}
          >
            <MetricCard label="Scope" value={scopeLabel} />
            <MetricCard
              label={station ? "Station uptime" : "Network mean uptime"}
              value={`${analysis.online_pct.toFixed(1)}%`}
            />
            {station && (
              <MetricCard
                label="Network mean (all sites)"
                value={`${analysis.network_online_pct.toFixed(1)}%`}
              />
            )}
            <MetricCard label="Offline share" value={`${analysis.offline_pct.toFixed(1)}%`} />
            <MetricCard label="Unknown share" value={`${analysis.unknown_pct.toFixed(1)}%`} />
            <MetricCard label="Samples" value={String(analysis.samples)} />
            <MetricCard label="Offline transitions" value={String(analysis.outage_events)} />
            <MetricCard label="Bucket" value={`${analysis.bucket_minutes} min`} />
          </div>

          {timelineLabels.length > 0 && (
            <div style={{ marginBottom: "1.25rem" }}>
              <div className="operations-chart-title" style={{ marginBottom: "0.5rem" }}>
                At-a-glance availability
              </div>
              <SiteAvailabilityRibbon
                points={analysis.timeline}
                label={station ? `${scopeLabel} uptime` : "Network uptime"}
              />
            </div>
          )}

          {timelineLabels.length > 0 && (
            <div style={{ marginBottom: "1.25rem" }}>
              <div className="operations-chart-title" style={{ marginBottom: "0.5rem" }}>
                {station ? "Site up vs down (samples per bucket)" : "Sites up vs down (count per bucket)"}
              </div>
              <NetworkUpDownChart points={analysis.timeline} singleStation={Boolean(station)} />
              <p className="operations-source" style={{ marginTop: "0.45rem" }}>
                Stacked bars show how many sites (or samples) were online vs offline in each archive
                bucket — easier to spot outages than a percentage line alone.
              </p>
            </div>
          )}

          {timelineLabels.length > 0 && (
            <div style={{ marginBottom: "1.25rem" }}>
              <div className="operations-chart-title" style={{ marginBottom: "0.5rem" }}>
                {station ? "Station uptime over time" : "Network uptime over time"}
              </div>
              <LineChart
                labels={timelineLabels}
                datasets={[
                  {
                    label: station ? "Station online %" : "Network online %",
                    data: timelineValues,
                    color: "#00ff88",
                    fill: true,
                  },
                ]}
                yLabel={range.yLabel}
                height={260}
              />
              <p className="operations-source">
                Source: archived station_status_snapshots · bucket {analysis.bucket_minutes} min ·{" "}
                {analysis.timeline.length} points · {scopeLabel}
              </p>
            </div>
          )}

          {analysis.stations.length > 0 && (
            <>
              <div className="operations-chart-title" style={{ marginBottom: "0.5rem" }}>
                Per-station uptime ({formatPeriodLabel(analysis.hours)})
              </div>
              <StationStatusBarChart
                rows={analysis.stations}
                height={440}
                yLabel={`% of samples (${formatPeriodLabel(analysis.hours)})`}
              />
              <ChartAnalysisBox
                block={analyzeStationUptime(analysis.stations, formatPeriodLabel(analysis.hours))}
              />
            </>
          )}

          {(analysis.outage_intervals?.length ?? 0) > 0 && (
            <>
              <div className="operations-chart-title" style={{ marginTop: "0.5rem", marginBottom: "0.5rem" }}>
                Outage durations ({formatPeriodLabel(analysis.hours)})
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem", marginBottom: "1rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Station</th>
                    <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Went down (UTC)</th>
                    <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Recovered (UTC)</th>
                    <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {analysis.outage_intervals!.slice(0, 15).map((row) => (
                    <tr key={`${row.station_code}-${row.started_at}`} style={{ borderBottom: "1px solid rgba(36,77,115,0.35)" }}>
                      <td style={{ padding: "0.35rem 0.5rem" }}>{row.station_code.toUpperCase()}</td>
                      <td style={{ padding: "0.35rem 0.5rem", whiteSpace: "nowrap" }}>
                        {row.started_at.replace("T", " ").slice(0, 19)}
                      </td>
                      <td style={{ padding: "0.35rem 0.5rem", whiteSpace: "nowrap", color: row.ongoing ? "#ff8c00" : undefined }}>
                        {row.ongoing ? "Still offline" : row.ended_at?.replace("T", " ").slice(0, 19) ?? "—"}
                      </td>
                      <td style={{ padding: "0.35rem 0.5rem", fontWeight: 600 }}>
                        {formatDurationMin(row.duration_min)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {events.length > 0 && (
            <>
              <div className="operations-chart-title" style={{ marginTop: "1.25rem" }}>
                Recent status events ({formatPeriodLabel(analysis.hours)}
                {station ? ` · ${station.toUpperCase()}` : ""})
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Time (UTC)</th>
                    <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Station</th>
                    <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Event</th>
                    <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev, i) => (
                    <tr
                      key={`${ev.time}-${ev.station_code ?? "net"}-${i}`}
                      style={{ borderBottom: "1px solid rgba(36,77,115,0.35)" }}
                    >
                      <td style={{ padding: "0.35rem 0.5rem", whiteSpace: "nowrap" }}>
                        {ev.time.replace("T", " ").slice(0, 19)}
                      </td>
                      <td style={{ padding: "0.35rem 0.5rem" }}>
                        {ev.station_code?.toUpperCase() ?? "—"}
                      </td>
                      <td style={{ padding: "0.35rem 0.5rem", color: eventTone(ev.event_type, ev.status), fontWeight: 600 }}>
                        {ev.event_type.replace(/_/g, " ")}
                      </td>
                      <td style={{ padding: "0.35rem 0.5rem" }}>
                        {ev.message ?? `${ev.previous_status ?? "?"} → ${ev.status}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: "0.55rem 0.7rem",
        background: "rgba(8, 28, 48, 0.45)",
      }}
    >
      <div style={{ fontSize: "0.68rem", color: "var(--text-muted)", textTransform: "uppercase" }}>
        {label}
      </div>
      <div style={{ fontSize: "0.95rem", fontWeight: 700, marginTop: "0.2rem", color: "var(--text)" }}>
        {value}
      </div>
    </div>
  );
}
