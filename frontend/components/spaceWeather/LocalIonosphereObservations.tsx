"use client";

import { useEffect, useState } from "react";
import SwSectionBanner from "./SwSectionBanner";
import { getLivePipelineStatus, getLiveStationReadings, getTecHeatmap } from "@/lib/api";
import type { LivePipelineStatus, LiveStationVtecSeries, TecHeatmapResponse } from "@/lib/types";
import { measuredLiveTec } from "@/lib/measuredLiveTec";
import { isSurveyorGeneral, ZINGSA_STATION_TOTAL } from "@/lib/liveStationStatus";
import { monitoringFreshness, observationEpoch, observationTime } from "@/lib/monitoringStatus";
import { formatVtecDisplay, vtecColor } from "@/lib/spaceWeatherMetrics";

function seriesFromHeatmap(heatmap: TecHeatmapResponse | null): LiveStationVtecSeries[] {
  const observedAt = new Date().toISOString();
  return (heatmap?.stations ?? [])
    .filter((station) => !isSurveyorGeneral(station.code) && measuredLiveTec(station) != null)
    .map((station) => ({
      station: station.code.toLowerCase().replace(/_+$/, ""),
      name: station.name,
      points: [{ time: observedAt, vtec_tecu: station.vtec, obs_count: station.obs_count }],
      latest_vtec: station.vtec,
      mean_vtec: station.vtec,
    }));
}

function hasFreshGopi(rows: LiveStationVtecSeries[]): boolean {
  return rows.some(
    (row) =>
      !isSurveyorGeneral(row.station) &&
      typeof row.latest_vtec === "number" &&
      Number.isFinite(row.latest_vtec) &&
      row.latest_vtec > 0,
  );
}

export default function LocalIonosphereObservations({ now }: { now: number }) {
  const [stations, setStations] = useState<LiveStationVtecSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshFailed, setRefreshFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      let showed = false;
      let readingsDone = false;
      let heatDone = false;
      const finishFail = () => {
        if (cancelled || showed || !readingsDone || !heatDone) return;
        setRefreshFailed(true);
        setLoading(false);
      };
      getTecHeatmap()
        .then((heatmap) => {
          if (cancelled) return;
          heatDone = true;
          const rows = seriesFromHeatmap(heatmap);
          if (!rows.length) {
            finishFail();
            return;
          }
          if (showed) return;
          showed = true;
          setStations(rows);
          setRefreshFailed(false);
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          heatDone = true;
          finishFail();
        });
      getLiveStationReadings()
        .then((rows) => {
          if (cancelled) return;
          readingsDone = true;
          const list = Array.isArray(rows) ? rows : [];
          if (!hasFreshGopi(list)) {
            finishFail();
            return;
          }
          showed = true;
          setStations(list);
          setRefreshFailed(false);
          setLoading(false);
        })
        .catch(() => {
          if (cancelled) return;
          readingsDone = true;
          finishFail();
        });
    };
    load();
    const timer = window.setInterval(() => {
      if (!document.hidden) load();
    }, 60_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
  const rows = stations.filter((station) => !isSurveyorGeneral(station.station)).map((station) => {
    const latest = station.points.filter((point) => Number.isFinite(point.vtec_tecu) && observationEpoch(point.time) !== null)
      .reduce<(typeof station.points)[number] | null>((last, point) =>
        !last || observationEpoch(point.time)! > observationEpoch(last.time)! ? point : last, null);
    const gopi = typeof station.latest_vtec === "number" && Number.isFinite(station.latest_vtec) && station.latest_vtec > 0
      ? station.latest_vtec
      : null;
    const status = gopi == null
      ? "UNAVAILABLE" as const
      : latest
        ? monitoringFreshness(latest.time, now, true, false)
        : "LIVE" as const;
    return { station, latest, gopi, status };
  });
  const fresh = rows.filter((row) => row.status === "LIVE" && row.gopi != null);
  const values = fresh.map((row) => row.gopi!);
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const rangeMin = values.length ? Math.min(...values) : null;
  const rangeMax = values.length ? Math.max(...values) : null;
  const anyLive = fresh.length > 0;
  const [pipeline, setPipeline] = useState<LivePipelineStatus | null>(null);
  useEffect(() => {
    if (loading || anyLive) return;
    let cancelled = false;
    const check = () => getLivePipelineStatus()
      .then(value => { if (!cancelled) setPipeline(value); })
      .catch(() => { if (!cancelled) setPipeline(null); });
    void check();
    const timer = window.setInterval(() => { if (!document.hidden) void check(); }, 30000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [loading, anyLive]);
  const tone = anyLive ? "ok" : refreshFailed || loading ? "warn" : "off";
  const statusLabel = anyLive
    ? "Live Data"
    : refreshFailed
      ? "Refresh failed"
      : loading
        ? "Loading"
        : "No recent TEC readings";

  const meanColor = vtecColor(mean);
  // Match CORS Connected metric card — always brand blue when counts are live.
  const stationsColor = loading || rows.length === 0 ? "#94a3b8" : "#168bd2";
  // Colour the range by the high end — same threshold bands as the metric card.
  const rangeColor = vtecColor(rangeMax);

  return (
    <section className="card" aria-labelledby="local-ionosphere-title">
      <SwSectionBanner
        icon="🇿🇼"
        title="Zimbabwe ionosphere observations"
        titleId="local-ionosphere-title"
        tone={tone}
        meta={
          <>
            <span>
              {statusLabel} · Zimbabwe CORS network
              {mean != null ? (
                <>
                  {" · "}
                  <span style={{ color: meanColor, fontWeight: 800 }}>
                    {mean.toFixed(1)} TECU mean
                  </span>
                </>
              ) : null}
            </span>
            <a href="/tec-heatmap/">View TEC map →</a>
          </>
        }
      />
      <div className="sw-local-readings">
        <div>
          <span>Mean of fresh station readings</span>
          <strong style={{ color: meanColor }}>
            {mean === null ? loading ? "Loading…" : "No recent measurements" : formatVtecDisplay(mean)}
          </strong>
        </div>
        <div>
          <span>Stations contributing</span>
          <strong style={{ color: stationsColor }}>
            {loading ? "Loading…" : `${fresh.length} of ${ZINGSA_STATION_TOTAL} with fresh TEC`}
          </strong>
        </div>
        <div>
          <span>Station range</span>
          <strong style={{ color: rangeColor }}>
            {rangeMin != null && rangeMax != null
              ? `${rangeMin.toFixed(1)}–${rangeMax.toFixed(1)} TECU`
              : loading ? "Loading…" : "No recent measurements"}
          </strong>
        </div>
      </div>
      {!loading && !anyLive && <div className="banner banner-info" role="status">
        <strong>Station connectivity and TEC measurements are separate.</strong>{" "}
        {pipeline?.runtime_mode === "persistent-process" && !pipeline.ntrip_configured && pipeline.recent_record_count_1h === 0
          ? "The local TEC pipeline is not running and no recent measurements are stored. Configure the NTRIP caster connection and start the collector."
          : pipeline && pipeline.active_streams > 0
            ? `${pipeline.active_streams} streams are connected, but no fresh VTEC is available in this view. Check decoding and observation times.`
            : "No fresh VTEC measurements reached this view. Check the collector connection, decoding and observation times."}
        {" "}<a href="/live-pipeline/">Open live pipeline diagnostics →</a>
      </div>}
      <p className="sw-supporting-text">Only Gopi code TEC from the last 15 minutes contributes. Each station is the satellite consensus, so one bad satellite cannot set the range. This is a station mean, not a spatially weighted national estimate. VTEC alone does not establish disturbance; local impact remains unverified.</p>
      {refreshFailed && !anyLive && <p role="status">Station observations could not be refreshed. Saved readings are marked and excluded from the current mean.</p>}
      <details className="sw-alert-bulletin">
        <summary>Station readings and observation times</summary>
        <div className="sw-table-scroll">
          <table className="sw-observation-table">
            <thead><tr><th scope="col">Station</th><th scope="col">VTEC</th><th scope="col">Observed (UTC)</th><th scope="col">Status</th></tr></thead>
            <tbody>{rows.map(({ station, latest, gopi, status }) => (
              <tr key={station.station}>
                <th scope="row">{station.name || station.station}</th>
                <td style={gopi != null && status === "LIVE" ? { color: vtecColor(gopi), fontWeight: 700 } : undefined}>
                  {gopi != null && status === "LIVE" ? formatVtecDisplay(gopi) : "Unavailable"}
                </td>
                <td>{observationTime(latest?.time)}</td>
                <td>{status}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {!rows.length && <p>{loading ? "Loading station observations…" : "No station observations available."}</p>}
      </details>
    </section>
  );
}
