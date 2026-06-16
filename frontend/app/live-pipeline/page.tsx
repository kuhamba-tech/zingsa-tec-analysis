"use client";
import { useEffect, useRef, useState } from "react";
import { getLiveVtec, getLiveStations, getForecastStatus } from "@/lib/api";
import MetricCard from "@/components/cards/MetricCard";
import LineChart from "@/components/charts/LineChart";
import type { LiveObservation, StationLiveStatus, ForecastStatus } from "@/lib/types";

export default function LivePipelinePage() {
  const [obs, setObs] = useState<LiveObservation[]>([]);
  const [stationStatus, setStationStatus] = useState<StationLiveStatus[]>([]);
  const [fcStatus, setFcStatus] = useState<ForecastStatus | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const [wsConnected, setWsConnected] = useState(false);

  useEffect(() => {
    // Initial load
    getLiveVtec(2).then(setObs).catch(() => {});
    getLiveStations().then(setStationStatus).catch(() => {});
    getForecastStatus().then(setFcStatus).catch(() => {});

    // WebSocket for live updates
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
        } catch { /* ignore */ }
      };
    } catch { /* ws unavailable */ }

    return () => { wsRef.current?.close(); };
  }, []);

  // Build chart data from obs
  const chartLabels = obs.slice(-200).map((o) => o.time.slice(11, 19));
  const chartData = obs.slice(-200).map((o) => o.vtec_tecu ?? 0);

  // Unique stations in obs
  const uniqueStations = [...new Set(obs.map((o) => o.station))];

  // DB record count from station statuses
  const online = stationStatus.filter((s) => !s.stale).length;
  const total = stationStatus.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.4rem" }}>
      <div>
        <h1 className="page-title">⚡ Live VTEC Pipeline</h1>
        <p className="page-subtitle">NTRIP → RTCM → STEC → VTEC → TimescaleDB → CNN-GRU Forecast</p>
      </div>

      {/* Status cards */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "0.8rem" }}>
        <MetricCard label="NTRIP Caster"  value={wsConnected ? "Connected" : "Offline"}  color={wsConnected ? "#00ff88" : "#ff4444"} variant={wsConnected ? "ok" : "alert"} />
        <MetricCard label="Storage"       value="SQLite" sub="0 records" />
        <MetricCard label="CNN-GRU Model" value={fcStatus ? (fcStatus.torch_ok ? (fcStatus.model_exists ? "Ready" : "No model") : "PyTorch N/A") : "…"} sub={fcStatus ? `Forecast horizon: ${fcStatus.forecast_h} h` : ""} variant={fcStatus?.model_exists ? "ok" : "warn"} />
        <MetricCard label="CORS Network"  value={total > 0 ? `${online}/${total}` : "24"} sub="Stations configured" variant="accent" />
      </div>

      {/* Live VTEC chart */}
      <div style={{ display: "grid", gridTemplateColumns: "3fr 2fr", gap: "1rem" }}>
        <div className="card">
          <div className="metric-label" style={{ marginBottom: "0.6rem" }}>Live VTEC — last 2 hours{wsConnected ? " · 🟢 live" : ""}</div>
          {chartData.length > 0 ? (
            <LineChart labels={chartLabels} datasets={[{ label: "VTEC (TECU)", data: chartData, color: "#168bd2" }]} height={260} />
          ) : (
            <div className="banner banner-info">No live observations yet. Start the NTRIP stream to ingest data.</div>
          )}
        </div>

        <div className="card">
          <div className="metric-label" style={{ marginBottom: "0.6rem" }}>CNN-GRU Forecast (next 6 h)</div>
          {fcStatus && !fcStatus.torch_ok && (
            <div className="banner banner-info">CNN-GRU forecasting requires PyTorch. See requirements.txt.</div>
          )}
          {fcStatus && fcStatus.torch_ok && !fcStatus.model_exists && (
            <div className="banner banner-info">No trained model yet. Collect 30 days of data, then use Train below.</div>
          )}
          {fcStatus && fcStatus.model_exists && (
            <div className="banner banner-info">Model ready. Forecast will appear once live data is streaming.</div>
          )}
        </div>
      </div>

      {/* Station grid */}
      <div>
        <div className="metric-label" style={{ marginBottom: "0.6rem" }}>Station Coverage</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(110px, 1fr))", gap: "0.5rem" }}>
          {stationStatus.map((s) => (
            <div key={s.code} className="card" style={{ padding: "0.5rem 0.7rem", minHeight: "70px" }}>
              <div className="metric-label" style={{ fontSize: "0.62rem" }}>{s.code.toUpperCase()}</div>
              <div style={{ fontWeight: 800, fontSize: "1.1rem", color: s.stale ? "#444466" : "#00cc55" }}>
                {s.last_vtec !== null && s.last_vtec !== undefined ? s.last_vtec.toFixed(1) : "N/A"}
              </div>
              <div className="metric-label" style={{ fontSize: "0.58rem" }}>{s.name.slice(0, 14)}</div>
            </div>
          ))}
          {stationStatus.length === 0 && [...Array(24)].map((_, i) => (
            <div key={i} className="card" style={{ padding: "0.5rem 0.7rem", minHeight: "70px", opacity: 0.4 }}>
              <div className="metric-label" style={{ fontSize: "0.62rem" }}>—</div>
              <div style={{ fontWeight: 800, fontSize: "1.1rem", color: "#444466" }}>N/A</div>
            </div>
          ))}
        </div>
      </div>

      {/* Info */}
      <div className="banner banner-info" style={{ fontSize: "0.78rem" }}>
        Live data requires NTRIP credentials in <code>.streamlit/secrets.toml</code> and a TimescaleDB instance (<code>TSDB_DSN=postgresql://…</code>). Without these, the page shows SQLite-backed historical data.
      </div>
    </div>
  );
}
