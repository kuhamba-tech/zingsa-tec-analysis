"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getLiveVtec,
  getLiveStations,
  getForecastStatus,
  getLivePipelineStatus,
  runNtripProbe,
  getCnnGruForecast,
} from "@/lib/api";
import MetricCard from "@/components/cards/MetricCard";
import LineChart from "@/components/charts/LineChart";
import type {
  LiveObservation,
  StationLiveStatus,
  ForecastStatus,
  LivePipelineStatus,
  NtripProbeResponse,
  ForecastPoint,
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
  const [probe, setProbe] = useState<NtripProbeResponse | null>(null);
  const [probeLoading, setProbeLoading] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  const refreshLive = useCallback(async () => {
    const [vtec, stations, pipe, fc] = await Promise.allSettled([
      getLiveVtec(2),
      getLiveStations(),
      getLivePipelineStatus(),
      getForecastStatus(),
    ]);
    if (vtec.status === "fulfilled") setObs(vtec.value);
    if (stations.status === "fulfilled") setStationStatus(stations.value);
    if (pipe.status === "fulfilled") setPipelineStatus(pipe.value);
    if (fc.status === "fulfilled") {
      setFcStatus(fc.value);
      if (fc.value.model_exists && fc.value.torch_ok) {
        getCnnGruForecast()
          .then(setForecast)
          .catch(() => setForecast([]));
      }
    }
  }, []);

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
  const online = stationStatus.filter((s) => !s.stale).length;
  const total = stationStatus.length;
  const configuredStreams = pipelineStatus ? Object.keys(pipelineStatus.streams ?? {}).length : 0;
  const streamRows = pipelineStatus?.streams ? Object.entries(pipelineStatus.streams) : [];
  const ntripState = pipelineStatus
    ? pipelineStatus.ingest_enabled
      ? pipelineStatus.active_streams > 0
        ? online > 0
          ? "Streaming"
          : "Connected idle"
        : "Not connected"
      : "Collector disabled"
    : "Checking";
  const ntripVariant = ntripState === "Streaming" ? "ok" : ntripState === "Checking" ? "accent" : "warn";

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
          sub={pipelineStatus ? `${pipelineStatus.active_streams}/${configuredStreams || 24} connected station streams` : ""}
          color={ntripState === "Streaming" ? "#00ff88" : "#ef9f27"}
          variant={ntripVariant}
        />
        <MetricCard
          label="Storage"
          value={pipelineStatus?.db_backend ?? "Checking"}
          sub={pipelineStatus ? `${pipelineStatus.record_count.toLocaleString()} records` : ""}
        />
        <MetricCard
          label="CNN-GRU Model"
          value={fcStatus ? (fcStatus.torch_ok ? (fcStatus.model_exists ? "Ready" : "No model") : "PyTorch N/A") : "…"}
          sub={fcStatus ? `Forecast horizon: ${fcStatus.forecast_h} h` : ""}
          variant={fcStatus?.model_exists ? "ok" : "warn"}
        />
        <MetricCard label="CORS Network" value={total > 0 ? `${online}/${total}` : "24"} sub="Stations with live VTEC" variant="accent" />
      </div>

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
                  <th>Last seen</th>
                </tr>
              </thead>
              <tbody>
                {streamRows.map(([code, row]) => (
                  <tr key={code}>
                    <td>{code.toUpperCase()}</td>
                    <td>{row.mountpoint}</td>
                    <td>{row.connected ? "Yes" : "No"}</td>
                    <td>{row.msg_count ?? 0}</td>
                    <td>{row.last_seen ? String(row.last_seen).slice(11, 19) : "—"}</td>
                  </tr>
                ))}
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
          {fcStatus && !fcStatus.torch_ok && (
            <div className="banner banner-info">CNN-GRU forecasting requires PyTorch. See backend/requirements.txt.</div>
          )}
          {fcStatus && fcStatus.torch_ok && !fcStatus.model_exists && (
            <div className="banner banner-info">No trained model yet. Collect 30 days of data, then train the model.</div>
          )}
          {forecast.length > 0 ? (
            <LineChart
              labels={forecast.map((f) => f.t)}
              datasets={[{ label: "Forecast VTEC", data: forecast.map((f) => f.predicted_vtec), color: "#ff8c00" }]}
              height={260}
            />
          ) : fcStatus?.model_exists ? (
            <div className="banner banner-info">Model ready — forecast will appear once enough live archive data is available.</div>
          ) : null}
        </div>
      </div>

      <div>
        <div className="metric-label" style={{ marginBottom: "0.6rem" }}>Station Coverage</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "0.5rem" }}>
          {stationStatus.map((s) => (
            <div key={s.code} className="card" style={{ padding: "0.5rem 0.7rem", minHeight: "70px" }}>
              <div className="metric-label" style={{ fontSize: "0.62rem" }}>{s.code.toUpperCase()}</div>
              <div style={{ fontWeight: 800, fontSize: "1.1rem", color: s.stale ? "#444466" : "#00cc55" }}>
                {s.last_vtec != null ? s.last_vtec.toFixed(1) : "N/A"}
              </div>
              <div className="metric-label" style={{ fontSize: "0.58rem" }}>{s.name.slice(0, 14)}</div>
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
