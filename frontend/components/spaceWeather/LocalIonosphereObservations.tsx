import SwSectionBanner from "./SwSectionBanner";
import type { LiveStationVtecSeries } from "@/lib/types";
import { trustedLiveVtec } from "@/lib/mergeLiveVtecStations";
import { monitoringFreshness, observationEpoch, observationTime } from "@/lib/monitoringStatus";
import { formatVtecDisplay, vtecColor } from "@/lib/spaceWeatherMetrics";

export default function LocalIonosphereObservations({ stations, now, refreshFailed, loading }: {
  stations: LiveStationVtecSeries[];
  now: number;
  refreshFailed: boolean;
  loading: boolean;
}) {
  const rows = stations.map((station) => {
    // Same floor as /space-weather/current mean_vtec so the card stays in lockstep.
    const latest = station.points.filter(
      (point) =>
        Number.isFinite(point.vtec_tecu) &&
        point.vtec_tecu > 1.0 &&
        observationEpoch(point.time) !== null,
    )
      .reduce<(typeof station.points)[number] | null>((last, point) =>
        !last || observationEpoch(point.time)! > observationEpoch(last.time)! ? point : last, null);
    const status = monitoringFreshness(latest?.time, now, Boolean(latest), refreshFailed);
    // Spike-filtered VTEC — same consensus as map G labels / live merge.
    const vtec = trustedLiveVtec(station);
    return { station, latest, status, vtec };
  });
  const fresh = rows.filter((row) => row.status === "LIVE" && row.latest);
  // Prefer LIVE for the mean; if ingest is lagging, still surface DELAYED readings
  // so a successful API response is not shown as a blank "Unavailable" panel.
  const delayed = rows.filter((row) => row.status === "DELAYED" && row.latest);
  const contributing = fresh.length > 0 ? fresh : delayed;
  const values = contributing
    .map((row) => row.vtec)
    .filter((v): v is number => v != null && Number.isFinite(v) && v > 0);
  const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const rangeMin = values.length ? Math.min(...values) : null;
  const rangeMax = values.length ? Math.max(...values) : null;
  const anyLive = fresh.length > 0;
  const anyDelayed = delayed.length > 0;
  const tone = refreshFailed ? "warn" : anyLive ? "ok" : loading || anyDelayed ? "warn" : "off";
  const statusLabel = refreshFailed
    ? "Refresh failed"
    : anyLive
      ? "Live Data"
      : loading
        ? "Loading"
        : anyDelayed
          ? "Delayed"
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
            {loading
              ? "Loading…"
              : `${contributing.length} of ${rows.length} returned${anyLive ? "" : anyDelayed ? " (delayed)" : ""}`}
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
            <tbody>{rows.map(({ station, latest, status, vtec }) => (
              <tr key={station.station}>
                <th scope="row">{station.name || station.station}</th>
                <td style={vtec != null ? { color: vtecColor(vtec), fontWeight: 700 } : undefined}>
                  {vtec != null ? formatVtecDisplay(vtec) : "Unavailable"}
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
