"use client";
import { useEffect, useMemo, useState } from "react";
import { getLiveVtec, getStationUptimeAnalysis } from "@/lib/api";
import type { LiveObservation, Station, StationUptimeAnalysis, TecHeatmapResponse } from "@/lib/types";
import { siteStatusColor, stationDetailRows } from "@/lib/stationDetails";
import { getLiveStationStatus } from "@/lib/liveStationStatus";
import { icaoTecColor, icaoTecDistanceLabel, icaoTecLabel } from "@/lib/icaoTecAdvisory";
import LineChart from "@/components/charts/LineChart";

interface Props {
  station: Station;
  heatmap?: TecHeatmapResponse | null;
  onClose: () => void;
}

function stationKey(code: string | null | undefined): string {
  return (code ?? "").toLowerCase().replace(/_+$/, "");
}

function heatmapStationFor(station: Station, heatmap?: TecHeatmapResponse | null) {
  const code = stationKey(station.code);
  return heatmap?.stations.find((s) => stationKey(s.code) === code) ?? null;
}

function isInterpolatedSource(source: string | null | undefined): boolean {
  return /estimate|interpolated|surface/i.test(source ?? "");
}

function heatmapVtec(station: Station, heatmap?: TecHeatmapResponse | null): number | null {
  const fromHeatmap = heatmapStationFor(station, heatmap)?.vtec;
  if (typeof fromHeatmap === "number" && Number.isFinite(fromHeatmap) && fromHeatmap >= 0) {
    return fromHeatmap;
  }
  const liveStatus = getLiveStationStatus(station);
  if (liveStatus === "offline" || liveStatus === "unavailable") return null;
  return typeof station.current_tec === "number" && Number.isFinite(station.current_tec) && station.current_tec > 0
    ? station.current_tec
    : null;
}

function formatArchiveTime(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const cat = new Intl.DateTimeFormat("en-ZW", {
    timeZone: "Africa/Harare",
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
  const utc = date.toISOString().replace("T", " ").replace(".000Z", " UTC");
  return `${cat} CAT · ${utc}`;
}

function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes)) return "—";
  const totalMinutes = Math.max(0, Math.round(minutes));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const mins = totalMinutes % 60;
  return [days ? `${days}d` : "", hours ? `${hours}h` : "", `${mins}m`].filter(Boolean).join(" ");
}

function binLiveVtec(rows: LiveObservation[], minutes = 2): { labels: string[]; values: number[] } {
  const buckets = new Map<number, number[]>();
  const stepMs = minutes * 60_000;
  for (const row of rows) {
    const v = row.vtec_tecu;
    if (v == null || !Number.isFinite(v) || v <= 0 || v >= 200) continue;
    const t = Date.parse(row.time);
    if (!Number.isFinite(t)) continue;
    const key = Math.floor(t / stepMs) * stepMs;
    const list = buckets.get(key) ?? [];
    list.push(v);
    buckets.set(key, list);
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b);
  const labels: string[] = [];
  const values: number[] = [];
  for (const key of keys) {
    const list = buckets.get(key) ?? [];
    if (!list.length) continue;
    const sorted = [...list].sort((a, b) => a - b);
    const mid = sorted[Math.floor(sorted.length / 2)] ?? sorted[0];
    labels.push(
      new Date(key).toLocaleTimeString("en-GB", {
        timeZone: "UTC",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
    );
    values.push(Math.round(mid * 100) / 100);
  }
  return { labels, values };
}

export default function SiteDetailsPanel({ station, heatmap = null, onClose }: Props) {
  const [uptime, setUptime] = useState<StationUptimeAnalysis | null>(null);
  const [uptimeLoading, setUptimeLoading] = useState(true);
  const [uptimeError, setUptimeError] = useState<string | null>(null);
  const [vtecLabels, setVtecLabels] = useState<string[]>([]);
  const [vtecValues, setVtecValues] = useState<number[]>([]);
  const [vtecLoading, setVtecLoading] = useState(true);
  const rows = stationDetailRows(station);
  const vtec = heatmapVtec(station, heatmap);
  const heatmapStation = heatmapStationFor(station, heatmap);
  const tecSource = isInterpolatedSource(heatmapStation?.source)
    ? "Interpolated TEC estimate"
    : heatmapStation?.source
      ? heatmapStation.source
      : null;
  const statusColor = siteStatusColor(
    rows.find((r) => r.label === "Site Status")?.value ?? station.status,
  );
  const liveStatus = getLiveStationStatus(station);
  const outageSummary = useMemo(() => {
    const intervals = uptime?.outage_intervals ?? [];
    const ongoing = intervals.find((item) => item.ongoing) ?? null;
    const lastCompleted = intervals.find((item) => !item.ongoing && item.ended_at) ?? null;
    const totalDowntime = intervals.reduce((sum, item) => sum + item.duration_min, 0);
    const wentDownAt = ongoing?.started_at ?? lastCompleted?.started_at ?? null;
    return { ongoing, lastCompleted, totalDowntime, wentDownAt };
  }, [uptime]);

  const downtimeRows = useMemo(() => {
    if (uptimeLoading) {
      return [{ label: "Went down", value: "Loading…" }];
    }
    if (uptimeError) {
      return [{ label: "Went down", value: "Archive unavailable" }];
    }
    if (!uptime) return [];

    const rows: { label: string; value: string; highlight?: boolean }[] = [];
    if (outageSummary.ongoing) {
      rows.push({
        label: "Went down",
        value: formatArchiveTime(outageSummary.ongoing.started_at),
        highlight: true,
      });
      rows.push({
        label: "Down for",
        value: formatDuration(outageSummary.ongoing.duration_min),
        highlight: true,
      });
    } else if (liveStatus === "offline") {
      rows.push({
        label: "Went down",
        value: outageSummary.wentDownAt
          ? formatArchiveTime(outageSummary.wentDownAt)
          : "Offline · awaiting a recorded transition time",
        highlight: true,
      });
    } else {
      rows.push({
        label: "Last went down",
        value: formatArchiveTime(outageSummary.lastCompleted?.started_at ?? outageSummary.wentDownAt),
      });
      rows.push({
        label: "Last restored",
        value: formatArchiveTime(outageSummary.lastCompleted?.ended_at),
      });
    }
    return rows;
  }, [uptime, uptimeLoading, uptimeError, outageSummary, liveStatus]);

  const detailRows = useMemo(() => {
    const base = stationDetailRows(station);
    const statusIdx = base.findIndex((r) => r.label === "Site Status");
    if (statusIdx < 0 || downtimeRows.length === 0) return base;
    return [...base.slice(0, statusIdx + 1), ...downtimeRows, ...base.slice(statusIdx + 1)];
  }, [station, downtimeRows]);

  useEffect(() => {
    let cancelled = false;
    setUptime(null);
    setUptimeLoading(true);
    setUptimeError(null);
    getStationUptimeAnalysis(8760, stationKey(station.code))
      .then((payload) => {
        if (!cancelled) setUptime(payload);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setUptimeError(error instanceof Error ? error.message : "Downtime archive unavailable");
        }
      })
      .finally(() => {
        if (!cancelled) setUptimeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [station.code, station.status, station.last_update]);

  useEffect(() => {
    let cancelled = false;
    setVtecLoading(true);
    setVtecLabels([]);
    setVtecValues([]);
    getLiveVtec(6, stationKey(station.code))
      .then((rows) => {
        if (cancelled) return;
        const binned = binLiveVtec(rows, 2);
        setVtecLabels(binned.labels);
        setVtecValues(binned.values);
      })
      .catch(() => {
        if (!cancelled) {
          setVtecLabels([]);
          setVtecValues([]);
        }
      })
      .finally(() => {
        if (!cancelled) setVtecLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [station.code]);

  return (
    <aside
      className="site-details-panel"
      style={{
        width: "min(320px, 42%)",
        flexShrink: 0,
        background: "linear-gradient(180deg, #0c1628 0%, #0a1018 100%)",
        borderLeft: "1px solid #244d73",
        display: "flex",
        flexDirection: "column",
        fontSize: "0.78rem",
        color: "#ffffff",
        maxHeight: "100%",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0.55rem 0.75rem",
          borderBottom: "1px solid #244d73",
          background: "rgba(22, 139, 210, 0.12)",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: "0.85rem" }}>Details</span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          style={{
            background: "transparent",
            border: "none",
            color: "#ffffff",
            cursor: "pointer",
            fontSize: "1.1rem",
            lineHeight: 1,
            padding: "0 0.2rem",
          }}
        >
          ×
        </button>
      </div>

      <div style={{ padding: "0.65rem 0.75rem", overflowY: "auto", flex: 1 }}>
        <div style={{ fontWeight: 700, marginBottom: "0.15rem", fontSize: "0.9rem" }}>
          {station.name}
        </div>
        <div style={{ color: "#ffffff", fontSize: "0.68rem", marginBottom: "0.65rem" }}>
          {station.code.toUpperCase()} · {station.mountpoint ?? station.marker_name ?? "CORS"}
        </div>

        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {detailRows.map(({ label, value, highlight }) => (
              <tr key={label} style={{ borderBottom: "1px solid rgba(36, 77, 115, 0.35)" }}>
                <td
                  style={{
                    padding: "0.35rem 0.4rem 0.35rem 0",
                    color: "#ffffff",
                    verticalAlign: "top",
                    whiteSpace: "nowrap",
                    width: "42%",
                  }}
                >
                  {label}
                </td>
                <td
                  style={{
                    padding: "0.35rem 0",
                    fontWeight: highlight ? 700 : 500,
                    color:
                      label === "Site Status"
                        ? statusColor
                        : label === "Went down" || label === "Down for"
                          ? "#ff6b6b"
                          : "#f1f5f9",
                    wordBreak: "break-word",
                  }}
                >
                  {label === "VTEC" && vtec != null ? `${vtec.toFixed(2)} TECU` : value}
                </td>
              </tr>
            ))}
            {vtec != null && (
              <>
                {tecSource && (
                  <tr style={{ borderBottom: "1px solid rgba(36, 77, 115, 0.35)" }}>
                    <td style={{ padding: "0.35rem 0.4rem 0.35rem 0", color: "#ffffff" }}>TEC Source</td>
                    <td style={{ padding: "0.35rem 0", color: "#ffffff", fontWeight: 600 }}>
                      {tecSource}
                    </td>
                  </tr>
                )}
                <tr style={{ borderBottom: "1px solid rgba(36, 77, 115, 0.35)" }}>
                  <td style={{ padding: "0.35rem 0.4rem 0.35rem 0", color: "#ffffff" }}>ICAO GNSS</td>
                  <td style={{ padding: "0.35rem 0", color: icaoTecColor(vtec), fontWeight: 700 }}>
                    {icaoTecLabel(vtec)}
                  </td>
                </tr>
                {icaoTecDistanceLabel(vtec) && (
                  <tr>
                    <td style={{ padding: "0.35rem 0.4rem 0.35rem 0", color: "#ffffff" }}>Threshold</td>
                    <td style={{ padding: "0.35rem 0", color: "#ffffff" }}>{icaoTecDistanceLabel(vtec)}</td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>

        <div className="site-details-vtec-chart">
          <div className="site-details-vtec-chart-title">Live VTEC · last 6 h</div>
          {vtecLoading ? (
            <div style={{ color: "#94a3b8", fontSize: "0.75rem" }}>Loading VTEC series…</div>
          ) : vtecValues.length > 0 ? (
            <LineChart
              labels={vtecLabels}
              datasets={[{ label: "Observed", data: vtecValues, color: "#3d8bfd", fill: true }]}
              yLabel="TECU"
              height={140}
              compact
            />
          ) : (
            <div style={{ color: "#94a3b8", fontSize: "0.75rem" }}>No live pipeline VTEC for this station.</div>
          )}
        </div>

        <section
          aria-label="Station downtime history"
          style={{
            marginTop: "0.8rem",
            padding: "0.7rem",
            border: "1px solid #244d73",
            borderRadius: "8px",
            background: "rgba(0, 0, 0, 0.28)",
          }}
        >
          <div style={{ fontWeight: 800, fontSize: "0.74rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>
            Downtime archive · 1 year
          </div>
          <div style={{ marginTop: "0.25rem", fontSize: "0.64rem", lineHeight: 1.45, color: "#ffffff" }}>
            Times are recorded from live Spider/NTRIP status transitions and retained for outage analysis.
          </div>

          {uptimeLoading && <div style={{ marginTop: "0.55rem", color: "#ffffff" }}>Loading outage history…</div>}
          {uptimeError && (
            <div role="status" style={{ marginTop: "0.55rem", color: "#ffb347", lineHeight: 1.4 }}>
              Downtime history unavailable: {uptimeError}
            </div>
          )}
          {uptime && !uptimeLoading && (
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "0.45rem" }}>
              <tbody>
                <tr style={{ borderBottom: "1px solid rgba(36, 77, 115, 0.35)" }}>
                  <td style={{ padding: "0.35rem 0.4rem 0.35rem 0", verticalAlign: "top", width: "42%" }}>
                    Current outage
                  </td>
                  <td style={{ padding: "0.35rem 0", color: outageSummary.ongoing ? "#ff6b6b" : "#00ff88", fontWeight: 700 }}>
                    {outageSummary.ongoing
                      ? `Ongoing · ${formatDuration(outageSummary.ongoing.duration_min)}`
                      : liveStatus === "offline"
                        ? "Offline · awaiting a recorded transition time"
                        : liveStatus === "unavailable"
                          ? "Status unavailable"
                          : "None · station up"}
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid rgba(36, 77, 115, 0.35)" }}>
                  <td style={{ padding: "0.35rem 0.4rem 0.35rem 0", verticalAlign: "top" }}>Went down</td>
                  <td style={{ padding: "0.35rem 0", color: "#ffffff", wordBreak: "break-word" }}>
                    {formatArchiveTime(outageSummary.wentDownAt)}
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid rgba(36, 77, 115, 0.35)" }}>
                  <td style={{ padding: "0.35rem 0.4rem 0.35rem 0", verticalAlign: "top" }}>Last restored</td>
                  <td style={{ padding: "0.35rem 0", color: "#ffffff", wordBreak: "break-word" }}>
                    {formatArchiveTime(outageSummary.lastCompleted?.ended_at)}
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid rgba(36, 77, 115, 0.35)" }}>
                  <td style={{ padding: "0.35rem 0.4rem 0.35rem 0", verticalAlign: "top" }}>Last outage</td>
                  <td style={{ padding: "0.35rem 0", color: "#ffffff" }}>
                    {outageSummary.lastCompleted ? formatDuration(outageSummary.lastCompleted.duration_min) : "—"}
                  </td>
                </tr>
                <tr style={{ borderBottom: "1px solid rgba(36, 77, 115, 0.35)" }}>
                  <td style={{ padding: "0.35rem 0.4rem 0.35rem 0", verticalAlign: "top" }}>Outages logged</td>
                  <td style={{ padding: "0.35rem 0", color: "#ffffff" }}>{uptime.outage_events}</td>
                </tr>
                <tr style={{ borderBottom: "1px solid rgba(36, 77, 115, 0.35)" }}>
                  <td style={{ padding: "0.35rem 0.4rem 0.35rem 0", verticalAlign: "top" }}>Downtime total</td>
                  <td style={{ padding: "0.35rem 0", color: "#ffffff" }}>
                    {uptime.samples > 0 ? formatDuration(outageSummary.totalDowntime) : "No archived samples"}
                  </td>
                </tr>
                <tr>
                  <td style={{ padding: "0.35rem 0.4rem 0.35rem 0", verticalAlign: "top" }}>Availability</td>
                  <td style={{ padding: "0.35rem 0", color: "#ffffff" }}>{uptime.online_pct.toFixed(2)}%</td>
                </tr>
              </tbody>
            </table>
          )}

          <a
            href={`/reports?type=uptime&range=1y&station=${encodeURIComponent(stationKey(station.code))}`}
            style={{ display: "inline-block", marginTop: "0.6rem", color: "#63c7ff", fontWeight: 700, fontSize: "0.68rem" }}
          >
            Open full downtime analysis →
          </a>
        </section>

        {station.constellations?.length > 0 && (
          <div style={{ marginTop: "0.65rem", fontSize: "0.72rem", color: "#ffffff" }}>
            Constellations: {station.constellations.join(", ")}
          </div>
        )}
      </div>
    </aside>
  );
}
