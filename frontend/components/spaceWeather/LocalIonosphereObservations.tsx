import SwSectionBanner from "./SwSectionBanner";
import type { LiveStationVtecSeries } from "@/lib/types";
import { monitoringFreshness, observationEpoch, observationTime } from "@/lib/monitoringStatus";
import { formatVtecDisplay, vtecColor } from "@/lib/spaceWeatherMetrics";

export default function LocalIonosphereObservations({ stations, now, refreshFailed, loading }: {
  stations: LiveStationVtecSeries[];
  now: number;
  refreshFailed: boolean;
  loading: boolean;
}) {
  const rows = stations.map((station) => {
    const latest = station.points.filter((point) => Number.isFinite(point.vtec_tecu) && observationEpoch(point.time) !== null)
      .reduce<(typeof station.points)[number] | null>((last, point) =>
        !last || observationEpoch(point.time)! > observationEpoch(last.time)! ? point : last, null);
    const status = monitoringFreshness(latest?.time, now, Boolean(latest), refreshFailed);
    return { station, latest, status };
  });
  const fresh = rows.filter((row) => row.status === "LIVE" && row.latest);
  const values = fresh.map((row) => row.latest!.vtec_tecu);
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const rangeMin = values.length ? Math.min(...values) : null;
  const rangeMax = values.length ? Math.max(...values) : null;
  const anyLive = fresh.length > 0;
  const tone = refreshFailed ? "warn" : anyLive ? "ok" : loading ? "warn" : "off";
  const statusLabel = refreshFailed
    ? "Refresh failed"
    : anyLive
      ? "Live Data"
      : loading
        ? "Loading"
        : "Unavailable";

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
              {statusLabel} · ZINGSA CORS
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
            {mean === null ? "Unavailable" : formatVtecDisplay(mean)}
          </strong>
        </div>
        <div>
          <span>Stations contributing</span>
          <strong style={{ color: stationsColor }}>
            {loading ? "Loading…" : `${fresh.length} of ${rows.length} returned`}
          </strong>
        </div>
        <div>
          <span>Station range</span>
          <strong style={{ color: rangeColor }}>
            {rangeMin != null && rangeMax != null
              ? `${rangeMin.toFixed(1)}–${rangeMax.toFixed(1)} TECU`
              : "Unavailable"}
          </strong>
        </div>
      </div>
      <p className="sw-supporting-text">Only observations within the last 15 minutes contribute. This is a station mean, not a spatially weighted national estimate. VTEC alone does not establish disturbance; local impact remains unverified.</p>
      {refreshFailed && <p role="status">Station observations could not be refreshed. Saved readings are marked and excluded from the current mean.</p>}
      <details className="sw-alert-bulletin">
        <summary>Station readings and observation times</summary>
        <div className="sw-table-scroll">
          <table className="sw-observation-table">
            <thead><tr><th scope="col">Station</th><th scope="col">VTEC</th><th scope="col">Observed (UTC)</th><th scope="col">Status</th></tr></thead>
            <tbody>{rows.map(({ station, latest, status }) => (
              <tr key={station.station}>
                <th scope="row">{station.name || station.station}</th>
                <td style={latest ? { color: vtecColor(latest.vtec_tecu), fontWeight: 700 } : undefined}>
                  {latest ? formatVtecDisplay(latest.vtec_tecu) : "Unavailable"}
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
