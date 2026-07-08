"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getLiveVtec,
  getLiveStations,
  getForecastStatus,
  getLivePipelineStatus,
  runNtripProbe,
  getCnnGruForecast,
  getCnnGruTrainStatus,
  trainCnnGruModel,
  getStations,
} from "@/lib/api";
import MetricCard from "@/components/cards/MetricCard";
import LineChart from "@/components/charts/LineChart";
import { countLiveStationStatuses, formatCorsConnectedDisplay } from "@/lib/liveStationStatus";
import type { Station } from "@/lib/types";
import type {
  LiveObservation,
  StationLiveStatus,
  ForecastStatus,
  LivePipelineStatus,
  NtripProbeResponse,
  ForecastPoint,
  CnnGruTrainStatus,
} from "@/lib/types";

const POLL_MS = 30_000;

const VERDICT_COLOR: Record<string, string> = {
  msm_streaming: "#00ff88",
  rtcm_no_msm: "#ff8c00",
  connected_no_data: "#ffcc00",
  offline: "#ff4444",
};

const VERDICT_LABEL: Record<string, string> = {
  msm_streaming: "MSM streaming (VTEC-ready)",
  rtcm_no_msm: "RTCM only, no MSM",
  connected_no_data: "Connected, no RTCM",
  offline: "Offline / rejected",
};

function formatMsgTypes(types: Record<string, number> | undefined): string {
  if (!types || Object.keys(types).length === 0) return "—";
  return Object.entries(types)
    .map(([k, v]) => `${k}×${v}`)
    .join(", ");
}

export default function LivePipelinePage() {
  const [obs, setObs] = useState<LiveObservation[]>([]);
  const [stationStatus, setStationStatus] = useState<StationLiveStatus[]>([]);
  const [fcStatus, setFcStatus] = useState<ForecastStatus | null>(null);
  const [forecast, setForecast] = useState<ForecastPoint[]>([]);
  const [pipelineStatus, setPipelineStatus] = useState<LivePipelineStatus | null>(null);
  const [corsStations, setCorsStations] = useState<Station[]>([]);
  const [probe, setProbe] = useState<NtripProbeResponse | null>(null);
  const [probeLoading, setProbeLoading] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const [trainStatus, setTrainStatus] = useState<CnnGruTrainStatus | null>(null);
  const [trainStarting, setTrainStarting] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const refreshLive = useCallback(async () => {
    const [vtec, stations, pipe, fc, cors] = await Promise.allSettled([
      getLiveVtec(2),
      getLiveStations(),
      getLivePipelineStatus(),
      getForecastStatus(),
      getStations(false),
    ]);
    if (vtec.status === "fulfilled") setObs(vtec.value);
    if (stations.status === "fulfilled") setStationStatus(stations.value);
    if (pipe.status === "fulfilled") setPipelineStatus(pipe.value);
    if (cors.status === "fulfilled") setCorsStations(cors.value);
    getStations(true)
      .then(setCorsStations)
      .catch(() => null);
    if (fc.status === "fulfilled") {
      setFcStatus(fc.value);
      if (fc.value.model_exists && fc.value.torch_ok) {
        getCnnGruForecast()
          .then(setForecast)
          .catch(() => setForecast([]));
      }
    }
    getCnnGruTrainStatus().then(setTrainStatus).catch(() => null);
  }, []);

  useEffect(() => {
    if (!trainStatus?.running) return;
    const id = window.setInterval(() => {
      getCnnGruTrainStatus()
        .then((status) => {
          setTrainStatus(status);
          if (!status.running && status.result && !status.error) {
            getForecastStatus().then((s) => {
              setFcStatus(s);
              if (s.model_exists && s.torch_ok) {
                getCnnGruForecast().then(setForecast).catch(() => setForecast([]));
              }
            });
          }
        })
        .catch(() => null);
    }, 2000);
    return () => window.clearInterval(id);
  }, [trainStatus?.running]);

  async function handleTrainModel() {
    setTrainStarting(true);
    try {
      await trainCnnGruModel();
      setTrainStatus(await getCnnGruTrainStatus());
    } catch {
      /* ignore */
    } finally {
      setTrainStarting(false);
    }
  }

  useEffect(() => {
    void refreshLive();
    const timer = window.setInterval(() => void refreshLive(), POLL_MS);

    const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    const wsUrl = API.replace(/^http/, "ws") + "/live/stream";
    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;
      ws.onopen = () => setWsConnected(true);
      ws.onclose = () => setWsConnected(false);
      ws.onmessage = (ev) => {
        try {
          const rows: LiveObservation[] = JSON.parse(ev.data);
          setObs((prev) => [...prev.slice(-500), ...rows]);
        } catch {
          /* ignore */
        }
      };
    } catch {
      /* ws unavailable */
    }

    return () => {
      window.clearInterval(timer);
      wsRef.current?.close();
    };
  }, [refreshLive]);

  async function handleProbe() {
    setProbeLoading(true);
    setProbeError(null);
    try {
      const result = await runNtripProbe(6);
      if (result.error) {
        setProbe(null);
        setProbeError(result.error);
      } else {
        setProbe(result);
      }
    } catch (err) {
      setProbe(null);
      setProbeError(err instanceof Error ? err.message : "NTRIP probe failed");
    }
    setProbeLoading(false);
  }

  const chartLabels = obs.slice(-200).map((o) => o.time.slice(11, 19));
  const chartData = obs.slice(-200).map((o) => o.vtec_tecu ?? 0);
  const vtecOnline = stationStatus.filter((s) => !s.stale && s.last_vtec != null && s.last_vtec > 0).length;
  const total = corsStations.length || stationStatus.length || 24;
  const corsCounts = countLiveStationStatuses(corsStations, total);
  const corsConnected = formatCorsConnectedDisplay(corsCounts);
  const configuredStreams = pipelineStatus ? Object.keys(pipelineStatus.streams ?? {}).length : 0;
  const activeStreams = pipelineStatus?.active_streams ?? 0;
  const streamTotal = configuredStreams || total;
  const streamRows = pipelineStatus?.streams ? Object.entries(pipelineStatus.streams) : [];
  const pipelineDiagnostics = pipelineStatus?.diagnostics ?? {};
  const ntripState = pipelineStatus
    ? pipelineStatus.ingest_enabled
      ? activeStreams > 0
        ? vtecOnline > 0
          ? "Streaming"
          : "Connected idle"
        : "Not connected"
      : "Collector disabled"
    : "Checking";
  const ntripVariant = ntripState === "Streaming" ? "ok" : ntripState === "Checking" ? "accent" : "warn";
  const storageBackend =
    pipelineStatus?.db_backend && pipelineStatus.db_backend !== "unknown"
      ? pipelineStatus.db_backend
      : "sqlite";
  const storageRecords = pipelineStatus?.record_count ?? 0;
  const storageRecent = pipelineStatus?.recent_record_count_1h ?? 0;
  const storageSub =
    storageRecords > 0
      ? `${storageRecords.toLocaleString()} records`
      : storageRecent > 0
        ? `${storageRecent.toLocaleString()} in last hour`
        : "No VTEC rows ingested yet";
  const corsSub =
    vtecOnline > 0
      ? `${corsConnected.note} · ${vtecOnline} outputting VTEC`
      : corsConnected.note;

  return (
    <div className="page-stack">
      <div>
        <h1 className="page-title">⚡ Live VTEC Pipeline</h1>
        <p className="page-subtitle">
          NTRIP → RTCM MSM + GPS ephemeris → STEC → VTEC (nav-derived elevation) → TecDB → CNN-GRU forecast
        </p>
      </div>

      <div className="metrics-auto-grid">
        <MetricCard
          label="NTRIP Collector"
          value={ntripState}
          sub={pipelineStatus ? `${activeStreams}/${streamTotal} connected station streams` : ""}
          color={ntripState === "Streaming" ? "#00ff88" : "#ef9f27"}
          variant={ntripVariant}
        />
        <MetricCard
          label="Storage"
          value={storageBackend}
          sub={storageSub}
        />
        <MetricCard
          label="CNN-GRU Model"
          value={fcStatus ? (fcStatus.torch_ok ? (fcStatus.model_exists ? "Ready" : "No model") : "PyTorch N/A") : "…"}
          sub={fcStatus ? `Forecast horizon: ${fcStatus.forecast_h} h` : ""}
          variant={fcStatus?.model_exists ? "ok" : "warn"}
        />
        <MetricCard label="CORS Connected" value={corsConnected.value} sub={corsSub} variant="accent" />
      </div>

      {ntripState === "Connected idle" && (
        <div className="banner banner-warn" style={{ fontSize: "0.82rem" }}>
          NTRIP streams are connected but no VTEC has been written yet — waiting for MSM observations and GPS ephemeris (RTCM 1019).
          Connected stations will show N/A until the ingest pipeline decodes observations.
        </div>
      )}

      {pipelineStatus?.message ? (
        <div className="banner banner-info" style={{ fontSize: "0.82rem" }}>
          {pipelineStatus.message}
        </div>
      ) : null}

      {streamRows.length > 0 && (
        <div className="card">
          <div className="metric-label" style={{ marginBottom: "0.6rem" }}>Active NTRIP stream status</div>
          <div className="table-scroll compact">
            <table className="dark-table">
              <thead>
                <tr>
                  <th>Station</th>
                  <th>Mountpoint</th>
                  <th>Connected</th>
                  <th>Messages</th>
                  <th>VTEC</th>
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {streamRows.map(([code, row]) => {
                  const diag = pipelineDiagnostics[code] ?? {};
                  const emitted = diag.vtec_emitted ?? 0;
                  const missingElevation = diag.missing_elevation ?? 0;
                  const observations = diag.observations ?? 0;
                  const vtecNote =
                    emitted > 0
                      ? `${emitted} emitted`
                      : observations > 0 && missingElevation > 0
                        ? "Waiting for ephemeris/elevation"
                        : observations > 0
                          ? "Waiting for L1/L2 pair"
                          : "No observations";
                  return (
                    <tr key={code}>
                      <td>{code.toUpperCase()}</td>
                      <td>{row.mountpoint}</td>
                      <td>{row.connected ? "Yes" : "No"}</td>
                      <td>{row.msg_count ?? 0}</td>
                      <td style={{ color: emitted > 0 ? "#00ff88" : observations > 0 ? "#ef9f27" : "var(--text-muted)" }}>
                        {vtecNote}
                      </td>
                      <td>{row.last_seen ? String(row.last_seen).slice(11, 19) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.75rem", alignItems: "center", justifyContent: "space-between", marginBottom: "0.75rem" }}>
          <div>
            <div style={{ fontWeight: 700 }}>NTRIP mountpoint verification</div>
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", margin: "0.35rem 0 0" }}>
              Requires <code>ENABLE_NTRIP_PROBE=true</code> in backend env. Tests each mountpoint for MSM4/MSM7 observations.
            </p>
          </div>
          <button className="btn btn-primary" onClick={handleProbe} disabled={probeLoading}>
            {probeLoading ? "Probing 24 mountpoints…" : "Verify all NTRIP connections"}
          </button>
        </div>

        {probeError && <div className="banner banner-alert" style={{ marginBottom: "0.75rem" }}>{probeError}</div>}

        {probe && (
          <>
            <div className="banner banner-info" style={{ fontSize: "0.82rem", marginBottom: "0.75rem" }}>
              Probed {probe.host}:{probe.port} at {probe.probed_at} —{" "}
              <span style={{ color: "#00ff88", fontWeight: 700 }}>{probe.summary.msm_streaming} MSM streaming</span> ·{" "}
              <span style={{ color: "#ff8c00", fontWeight: 700 }}>{probe.summary.rtcm_no_msm} RTCM, no MSM</span> ·{" "}
              {probe.summary.connected_no_data} connected (no RTCM) · {probe.summary.offline} offline
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)", textAlign: "left" }}>
                    <th style={{ padding: "0.4rem" }}>Station</th>
                    <th style={{ padding: "0.4rem" }}>Mountpoint</th>
                    <th style={{ padding: "0.4rem" }}>Verdict</th>
                    <th style={{ padding: "0.4rem" }}>RTCM</th>
                    <th style={{ padding: "0.4rem" }}>MSM</th>
                    <th style={{ padding: "0.4rem" }}>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {probe.stations.map((row) => (
                    <tr key={row.station} style={{ borderBottom: "1px solid rgba(36,77,115,0.35)" }}>
                      <td style={{ padding: "0.4rem", fontWeight: 700 }}>{row.station.toUpperCase()}</td>
                      <td style={{ padding: "0.4rem" }}>{row.mountpoint}</td>
                      <td style={{ padding: "0.4rem", color: VERDICT_COLOR[row.verdict] ?? "#fff", fontWeight: 700 }}>
                        {VERDICT_LABEL[row.verdict] ?? row.verdict}
                      </td>
                      <td style={{ padding: "0.4rem" }}>{row.rtcm_total ?? row.rtcm_frames}</td>
                      <td style={{ padding: "0.4rem", color: row.msm_count > 0 ? "#00ff88" : "inherit" }}>{row.msm_count ?? 0}</td>
                      <td style={{ padding: "0.4rem", color: "var(--text-muted)" }}>{row.error ?? row.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>

      <div className="page-split-charts">
        <div className="card">
          <div className="metric-label" style={{ marginBottom: "0.6rem" }}>
            Live VTEC — last 2 hours{wsConnected ? " · 🟢 live" : ""} · refreshes every 30s
          </div>
          {chartData.length > 0 ? (
            <LineChart labels={chartLabels} datasets={[{ label: "VTEC (TECU)", data: chartData, color: "#168bd2" }]} height={260} />
          ) : (
            <div className="banner banner-info">No live observations yet. Start the NTRIP stream to ingest data.</div>
          )}
        </div>

        <div className="card">
          <div className="metric-label" style={{ marginBottom: "0.6rem" }}>CNN-GRU Forecast</div>
          {trainStatus?.running && (
            <div className="banner banner-info" style={{ marginBottom: "0.75rem", fontSize: "0.82rem" }}>
              <strong>Training CNN-GRU…</strong> epoch {trainStatus.epoch}/{trainStatus.total_epochs}
              {trainStatus.last_loss != null ? ` · loss ${trainStatus.last_loss.toFixed(5)}` : ""}
            </div>
          )}
          {fcStatus && fcStatus.torch_ok && !fcStatus.model_exists && !trainStatus?.running && (
            <div className="banner banner-info" style={{ marginBottom: "0.75rem" }}>
              No trained model yet. Train on archived VTEC in TimescaleDB/SQLite, or use{" "}
              <a href="/anomaly-detection" style={{ color: "inherit" }}>TEC Anomaly → TEC Prediction</a>.
              <div style={{ marginTop: "0.6rem" }}>
                <button type="button" className="btn btn-primary" onClick={handleTrainModel} disabled={trainStarting}>
                  {trainStarting ? "Starting…" : "Train CNN-GRU model"}
                </button>
              </div>
            </div>
          )}
          {fcStatus && !fcStatus.torch_ok && (
            <div className="banner banner-info">CNN-GRU forecasting requires PyTorch. See backend/requirements.txt.</div>
          )}
          {fcStatus && fcStatus.torch_ok && fcStatus.model_exists && forecast.length === 0 && (
            <div className="banner banner-info" style={{ marginBottom: "0.75rem" }}>
              Model ready — forecast uses the latest archived VTEC when live ingest is idle.
            </div>
          )}
          {forecast.length > 0 ? (
            <LineChart
              labels={forecast.map((f) => f.t)}
              datasets={[{ label: "Forecast VTEC", data: forecast.map((f) => f.predicted_vtec), color: "#ff8c00" }]}
              height={260}
            />
          ) : null}
        </div>
      </div>

      <div>
        <div className="metric-label" style={{ marginBottom: "0.6rem" }}>Station Coverage</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "0.5rem" }}>
          {stationStatus.map((s) => (
            <div key={s.code} className="card" style={{ padding: "0.5rem 0.7rem", minHeight: "70px" }}>
              <div className="metric-label" style={{ fontSize: "0.62rem" }}>{s.code.toUpperCase()}</div>
              <div style={{ fontWeight: 800, fontSize: "1.1rem", color: s.stale ? "#444466" : s.last_vtec != null ? "#00cc55" : "#ef9f27" }}>
                {s.last_vtec != null ? s.last_vtec.toFixed(1) : s.stale ? "N/A" : "…"}
              </div>
              <div className="metric-label" style={{ fontSize: "0.58rem" }}>
                {s.stale ? s.name.slice(0, 14) : s.last_vtec != null ? s.name.slice(0, 14) : "Connected"}
              </div>
            </div>
          ))}
          {stationStatus.length === 0 &&
            [...Array(24)].map((_, i) => (
              <div key={i} className="card" style={{ padding: "0.5rem 0.7rem", minHeight: "70px", opacity: 0.4 }}>
                <div className="metric-label" style={{ fontSize: "0.62rem" }}>—</div>
                <div style={{ fontWeight: 800, fontSize: "1.1rem", color: "#444466" }}>N/A</div>
              </div>
            ))}
        </div>
      </div>

      <div className="banner banner-info" style={{ fontSize: "0.78rem" }}>
        VTEC uses GPS broadcast ephemeris (RTCM 1019) and station coordinates for satellite elevation — no synthetic 45° default.
        Charts refresh every 30 seconds and via WebSocket when new DB rows arrive.
      </div>
    </div>
  );
}
