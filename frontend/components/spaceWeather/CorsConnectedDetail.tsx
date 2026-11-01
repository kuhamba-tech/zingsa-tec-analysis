"use client";

import { useEffect, useMemo, useState } from "react";
import LineChart from "@/components/charts/LineChart";
import ChartAnalysisBox from "@/components/dashboard/ChartAnalysisBox";
import { analyzeStationsOnlineTimeline } from "@/lib/dashboardChartAnalysis";
import { getStationUptimeAnalysis } from "@/lib/api";
import {
  ONE_H_MS,
  SIX_H_MS,
  alignTimeDomain,
  chronologicalPoints,
  formatUtcAxisTick,
  sharedTimeDomain,
} from "@/lib/chartTimeAxis";
import { alignEkfToPoints } from "@/lib/ekfAlign";
import {
  getLiveStationStatus,
  ZINGSA_STATION_TOTAL,
  type LiveStationCounts,
} from "@/lib/liveStationStatus";
import { peekStations } from "@/lib/stationsStore";
import type { EkfPoint, StationOutageInterval, StationUptimeAnalysis, TimelinePoint } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatUtc(value: string | null | undefined): string {
  if (!value) return "time not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  return `${date.getUTCFullYear()} ${MONTHS[date.getUTCMonth()]} ${day} ${hour}${minute} UTC`;
}

function formatDuration(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 1) return "under 1 min";
  const rounded = Math.round(minutes);
  if (rounded < 60) return `${rounded} min`;
  const hours = Math.floor(rounded / 60);
  const mins = rounded % 60;
  if (hours < 48) return mins ? `${hours} h ${mins} min` : `${hours} h`;
  const days = Math.floor(hours / 24);
  const rem = hours % 24;
  return rem ? `${days} d ${rem} h` : `${days} d`;
}

function downtimeFromCounts(plot: { ms: number; v: number | null }[]) {
  const samples = plot.filter((point): point is { ms: number; v: number } => point.v != null && Number.isFinite(point.v));
  if (!samples.length) return null;
  const lowest = samples.reduce((best, point) => (point.v < best.v ? point : best), samples[0]);
  const latest = samples[samples.length - 1];
  let troughStart = lowest.ms;
  for (let index = samples.findIndex((point) => point.ms === lowest.ms) - 1; index >= 0; index -= 1) {
    if (samples[index].v <= lowest.v) troughStart = samples[index].ms;
    else break;
  }
  const shortSamples = samples.filter((point) => point.v < ZINGSA_STATION_TOTAL).length;
  return {
    latest,
    lowest,
    troughStart,
    shortSamples,
    sampleCount: samples.length,
  };
}

function stationName(interval: StationOutageInterval): string {
  return (interval.station_code || interval.station_name || "Station").toUpperCase();
}

export default function CorsConnectedDetail({
  points,
  ekfPoints,
  counts,
}: {
  points: TimelinePoint[];
  ekfPoints?: EkfPoint[] | null;
  counts?: LiveStationCounts | null;
}) {
  const [uptime, setUptime] = useState<StationUptimeAnalysis | null>(null);
  const [uptimeError, setUptimeError] = useState<string | null>(null);
  const [uptimeLoading, setUptimeLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setUptimeLoading(true);
    getStationUptimeAnalysis(168)
      .then((payload) => {
        if (!cancelled) setUptime(payload);
      })
      .catch(() => {
        if (!cancelled) setUptimeError("The station outage archive did not respond.");
      })
      .finally(() => {
        if (!cancelled) setUptimeLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const plot = useMemo(() => chronologicalPoints(points), [points]);
  const analysis = useMemo(() => analyzeStationsOnlineTimeline(points), [points]);
  const countDowntime = useMemo(() => downtimeFromCounts(plot), [plot]);
  const offlineNow = useMemo(
    () => peekStations().filter((station) => getLiveStationStatus(station) === "offline"),
    [counts],
  );

  const epochs = plot.map((point) => point.ms);
  const domain = sharedTimeDomain([epochs])
    ?? (epochs.length ? alignTimeDomain(epochs[0] - ONE_H_MS, epochs[epochs.length - 1] + ONE_H_MS) : null);
  const spanHours = domain ? (domain.max - domain.min) / ONE_H_MS : 6;
  const hourMarks = spanHours <= 26;
  const ekf = alignEkfToPoints(plot.map((point) => ({ t: point.t, v: point.v })), ekfPoints ?? undefined);
  const observedOnline = plot.some((point) => point.v != null && point.v > 0);
  const ekfFlatZero = ekf.data.every((value) => value == null || value === 0);
  const showEkf = ekf.data.some((value) => value != null) && !(observedOnline && ekfFlatZero);

  const intervals = uptime?.outage_intervals ?? [];
  const ongoing = intervals.filter((item) => item.ongoing).slice(0, 12);
  const closed = intervals
    .filter((item) => !item.ongoing)
    .sort((a, b) => Date.parse(b.ended_at ?? b.started_at) - Date.parse(a.ended_at ?? a.started_at))
    .slice(0, 8);
  const weakest = [...(uptime?.stations ?? [])]
    .filter((row) => Number.isFinite(row.online_pct))
    .sort((a, b) => a.online_pct - b.online_pct)
    .slice(0, 5);

  return (
    <div className="sw-metric-explain-body" style={{ marginTop: "0.75rem" }}>
      <div className="sw-metric-explain-heading">Live CORS stations online</div>
      {plot.length > 0 && domain ? (
        <>
          <LineChart
            labels={plot.map((point) => point.t)}
            datasets={[
              {
                label: "Observed",
                data: plot.map((point) => point.v),
                color: "#00ff88",
                spanGaps: false,
                tension: 0,
              },
              ...(showEkf
                ? [{
                    label: "EKF Predicted",
                    data: ekf.data,
                    color: "#86efac",
                    dashed: true,
                    spanGaps: false,
                    meta: ekf.meta,
                  }]
                : []),
            ]}
            yLabel="Stations online"
            height={220}
            xValues={epochs}
            epochMs={epochs}
            xMin={domain.min}
            xMax={domain.max}
            xStepSize={ONE_H_MS}
            xMajorStepMs={hourMarks ? ONE_H_MS : SIX_H_MS}
            formatXTick={(ms) => formatUtcAxisTick(ms, { majorHours: hourMarks ? 1 : 6 })}
            xLabel="UTC"
            yMin={0}
            yMax={ZINGSA_STATION_TOTAL}
          />
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)", margin: "0.45rem 0 0" }}>
            ZINGSA CORS network — {ZINGSA_STATION_TOTAL} stations, Surveyor General sites excluded · {plot.length} points · synced UTC axis.
          </p>
        </>
      ) : (
        <p>The stations-online timeline is not in this snapshot yet.</p>
      )}
      <ChartAnalysisBox block={analysis} title="Timeline analysis" />

      <div className="sw-metric-explain-heading" style={{ marginTop: "0.85rem" }}>Downtime analysis</div>
      <p>
        {counts && counts.online + counts.offline > 0
          ? `Right now ${counts.online} of ${ZINGSA_STATION_TOTAL} ZINGSA CORS stations are online and ${counts.offline} are offline.`
          : "The live online and offline counts are still updating."}
        {offlineNow.length > 0
          ? ` Named offline in the current station list: ${offlineNow.map((station) => station.code.toUpperCase()).join(", ")}.`
          : ""}
      </p>
      {countDowntime && (
        <p>
          On this timeline the lowest count is {Math.round(countDowntime.lowest.v)} online ({ZINGSA_STATION_TOTAL - Math.round(countDowntime.lowest.v)} offline) at {formatUtc(new Date(countDowntime.lowest.ms).toISOString())}.
          That low run starts at {formatUtc(new Date(countDowntime.troughStart).toISOString())}.
          {" "}{countDowntime.shortSamples} of {countDowntime.sampleCount} samples are below the full {ZINGSA_STATION_TOTAL}-station network.
          The latest sample is {Math.round(countDowntime.latest.v)} online.
        </p>
      )}
      {uptimeLoading && <p>Reading the 7-day outage archive…</p>}
      {uptimeError && <p>The per-station outage archive is not available from this server. The downtime above uses the stations-online timeline and the live station list.</p>}
      {uptime && (
        <>
          <p>
            Over the last {Math.round(uptime.hours / 24)} days the archived network was online {uptime.network_online_pct.toFixed(1)}% of samples
            {Number.isFinite(uptime.offline_pct) ? `, with ${uptime.offline_pct.toFixed(1)}% offline` : ""}.
            {" "}{uptime.outage_events} outage {uptime.outage_events === 1 ? "event is" : "events are"} in the archive.
          </p>
          {ongoing.length > 0 ? (
            <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
              {ongoing.map((item) => (
                <li key={`${stationName(item)}-${item.started_at}`}>
                  {stationName(item)} went down at {formatUtc(item.started_at)} and is still down ({formatDuration(item.duration_min)}).
                </li>
              ))}
            </ul>
          ) : (
            <p>No ongoing outage is recorded in the archive.</p>
          )}
          {closed.length > 0 && (
            <>
              <p style={{ marginTop: "0.45rem" }}>Recent completed outages:</p>
              <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
                {closed.map((item) => (
                  <li key={`${stationName(item)}-${item.started_at}-${item.ended_at}`}>
                    {stationName(item)} down from {formatUtc(item.started_at)} to {formatUtc(item.ended_at)} ({formatDuration(item.duration_min)}).
                  </li>
                ))}
              </ul>
            </>
          )}
          {weakest.length > 0 && (
            <p style={{ marginTop: "0.45rem" }}>
              Lowest online time in this archive: {weakest.map((row) => `${(row.station_code || row.station_name).toUpperCase()} ${row.online_pct.toFixed(1)}%`).join(", ")}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
