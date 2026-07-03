"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import MetricCard from "@/components/cards/MetricCard";
import LineChart from "@/components/charts/LineChart";
import GicLiveDashboard from "./GicLiveDashboard";
import GicNetworkMap from "./GicNetworkMap";
import {
  downloadGicReportCsv,
  getGicNetwork,
  getGicReport,
  getGicSeries,
  getGicStatus,
  uploadGicFile,
} from "@/lib/api";
import type {
  GicNetwork,
  GicReport,
  GicReportPeriod,
  GicSeriesResponse,
  GicStatusResponse,
} from "@/lib/types";

const RANGES: { label: string; hours: number; resample?: string }[] = [
  { label: "1 h", hours: 1 },
  { label: "24 h", hours: 24 },
  { label: "7 d", hours: 168, resample: "10min" },
  { label: "1 m", hours: 720, resample: "1h" },
  { label: "1 yr", hours: 8760, resample: "6h" },
];

const REPORT_PERIODS: { id: GicReportPeriod; label: string; hint: string }[] = [
  { id: "hourly", label: "Hourly", hint: "last 1 hour" },
  { id: "daily", label: "Daily", hint: "last 24 hours" },
  { id: "weekly", label: "Weekly", hint: "last 7 days" },
  { id: "monthly", label: "Monthly", hint: "last 30 days" },
  { id: "yearly", label: "Yearly", hint: "last 365 days" },
];

const SEVERITY_COLOR: Record<string, string> = {
  Low: "#00ff88",
  Moderate: "#ffcc00",
  High: "#ff7a00",
  Severe: "#ff2e2e",
};

export default function GicMonitorPanel() {
  const [network, setNetwork] = useState<GicNetwork | null>(null);
  const [status, setStatus] = useState<GicStatusResponse | null>(null);
  const [stationId, setStationId] = useState<string>("");
  const [rangeIdx, setRangeIdx] = useState(1);
  const [series, setSeries] = useState<GicSeriesResponse | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);

  const [uploadStation, setUploadStation] = useState("MARIMBA_001");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const [reportPeriod, setReportPeriod] = useState<GicReportPeriod>("daily");
  const [report, setReport] = useState<GicReport | null>(null);
  const [reportBusy, setReportBusy] = useState(false);

  const loadStatic = useCallback(async () => {
    const [net, st] = await Promise.all([
      getGicNetwork().catch(() => null),
      getGicStatus().catch(() => null),
    ]);
    setNetwork(net);
    setStatus(st);
    if (st && !stationId) {
      const withData = st.stations.find((s) => s.has_data);
      setStationId((withData ?? st.stations[0])?.station_id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stationId]);

  useEffect(() => {
    loadStatic();
    const id = window.setInterval(loadStatic, 120000);
    return () => window.clearInterval(id);
  }, [loadStatic]);

  const loadSeries = useCallback(async () => {
    if (!stationId) return;
    setSeriesLoading(true);
    const range = RANGES[rangeIdx];
    const data = await getGicSeries(stationId, range.hours, range.resample).catch(() => null);
    setSeries(data);
    setSeriesLoading(false);
  }, [stationId, rangeIdx]);

  useEffect(() => {
    loadSeries();
    const id = window.setInterval(loadSeries, 60000);
    return () => window.clearInterval(id);
  }, [loadSeries]);

  const selectedStatus = useMemo(
    () => status?.stations.find((s) => s.station_id === stationId) ?? null,
    [status, stationId],
  );

  const chartData = useMemo(() => {
    if (!series || series.points.length === 0) return null;
    const labels = series.points.map((p) => p.t.replace("T", " ").slice(0, 16));
    return {
      labels,
      observed: series.points.map((p) => p.observed),
      predicted: series.points.map((p) => p.predicted),
      meta: series.points.map((p) =>
        p.error != null || p.confidence != null ? { error: p.error, confidence: p.confidence } : null,
      ),
      rate: series.points.map((p) => p.rate_a_per_min),
    };
  }, [series]);

  const swChart = useMemo(() => {
    if (!series || series.space_weather.length === 0) return null;
    return {
      labels: series.space_weather.map((p) => p.t.replace("T", " ").slice(0, 16)),
      kp: series.space_weather.map((p) => p.kp),
      dst: series.space_weather.map((p) => p.dst),
    };
  }, [series]);

  const handleUpload = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setUploadMsg("Choose a CR1000 TOA5 or CSV file first.");
      return;
    }
    setUploadBusy(true);
    setUploadMsg(null);
    try {
      const res = await uploadGicFile(file, uploadStation);
      setUploadMsg(
        `✓ ${res.filename}: ${res.parsed} rows parsed, ${res.inserted} new rows stored for ${res.station_id} (${res.from.slice(0, 16)} → ${res.to.slice(0, 16)}).`,
      );
      if (fileRef.current) fileRef.current.value = "";
      await loadStatic();
      await loadSeries();
    } catch (e) {
      setUploadMsg(`Upload failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUploadBusy(false);
    }
  };

  const handleReport = async (period?: GicReportPeriod) => {
    const p = period ?? reportPeriod;
    if (!stationId) return;
    setReportPeriod(p);
    setReportBusy(true);
    setReport(null);
    const r = await getGicReport(stationId, p).catch(() => null);
    setReport(r);
    setReportBusy(false);
  };

  const handleReportCsv = async (period?: GicReportPeriod) => {
    const p = period ?? reportPeriod;
    if (!stationId) return;
    const blob = await downloadGicReportCsv(stationId, p).catch(() => null);
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `gic_${stationId.toLowerCase()}_${p}_report.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const reportPanel = (
    <div className="card card-accent" id="gic-reports">
      <div className="operations-chart-title">GIC Report Generator</div>
      <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.7rem" }}>
        Generate hourly, daily, weekly, monthly, or yearly reports for the selected monitoring station.
        Each report includes peak/mean GIC statistics, risk-band occupancy, large-GIC events (≥ 10 A),
        plain-language interpretation, and Kp/Dst correlation — computed from stored field data only.
      </p>
      <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.85rem" }}>
        <label style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Station</label>
        <select
          value={stationId}
          onChange={(e) => {
            setStationId(e.target.value);
            setReport(null);
          }}
          className="form-select"
        >
          {(status?.stations ?? []).map((s) => (
            <option key={s.station_id} value={s.station_id}>
              {s.station_id} — {s.name}{s.has_data ? "" : " (no data)"}
            </option>
          ))}
        </select>
      </div>
      <div className="gic-report-period-grid">
        {REPORT_PERIODS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`gic-report-period-btn${reportPeriod === p.id ? " is-active" : ""}`}
            onClick={() => handleReport(p.id)}
            disabled={reportBusy || !stationId}
            title={`Generate ${p.label.toLowerCase()} report (${p.hint})`}
          >
            <span className="gic-report-period-label">{p.label}</span>
            <span className="gic-report-period-hint">{p.hint}</span>
          </button>
        ))}
      </div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", margin: "0.85rem 0" }}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => handleReport()}
          disabled={reportBusy || !stationId}
        >
          {reportBusy ? "Generating…" : `Generate ${REPORT_PERIODS.find((p) => p.id === reportPeriod)?.label ?? ""} Report`}
        </button>
        <button type="button" className="btn" onClick={() => handleReportCsv()} disabled={!stationId}>
          Download CSV
        </button>
      </div>

      {reportBusy && (
        <div className="banner banner-info">Building {reportPeriod} report for {stationId}…</div>
      )}

      {report && !reportBusy && (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
          <div style={{ fontSize: "0.82rem", color: "var(--text-muted)" }}>
            <b style={{ color: "var(--text)" }}>{report.period_label}</b> · {report.station_id} ·{" "}
            {report.window_start.slice(0, 16).replace("T", " ")} → {report.window_end.slice(0, 16).replace("T", " ")} UTC ·{" "}
            {report.sample_count} samples · generated {report.generated_utc.slice(0, 19).replace("T", " ")} UTC
          </div>

          {report.statistics ? (
            <div className="grid-4">
              <MetricCard label="Peak |GIC|" value={report.statistics.peak_abs_a} unit="A" sub={`at ${report.statistics.peak_time.slice(0, 16).replace("T", " ")}`} />
              <MetricCard label="Mean GIC" value={report.statistics.mean_a} unit="A" sub={`σ = ${report.statistics.std_a} A`} />
              <MetricCard label="95th pct |GIC|" value={report.statistics.p95_abs_a} unit="A" sub="magnitude percentile" />
              <MetricCard
                label="Large-GIC events"
                value={report.events.length}
                sub="|GIC| ≥ 10 A episodes"
                variant={report.events.length > 0 ? "warn" : "ok"}
              />
            </div>
          ) : (
            <div className="banner banner-info">No measurements in this window — upload field data or check the station uplink.</div>
          )}

          {report.band_minutes.length > 0 && report.sample_count > 0 && (
            <div>
              <div className="operations-chart-title" style={{ marginBottom: "0.4rem" }}>Risk-Band Occupancy</div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "0.3rem 0.5rem" }}>Band</th>
                    <th style={{ textAlign: "right", padding: "0.3rem 0.5rem" }}>Minutes</th>
                    <th style={{ textAlign: "right", padding: "0.3rem 0.5rem" }}>Samples</th>
                  </tr>
                </thead>
                <tbody>
                  {report.band_minutes.map((b) => (
                    <tr key={b.level} style={{ borderBottom: "1px solid rgba(36,77,115,0.35)" }}>
                      <td style={{ padding: "0.3rem 0.5rem", fontWeight: 700 }}>{b.level}</td>
                      <td style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>{b.minutes}</td>
                      <td style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>{b.samples}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {report.events.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.8rem" }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "0.3rem 0.5rem" }}>Event start (UTC)</th>
                  <th style={{ textAlign: "right", padding: "0.3rem 0.5rem" }}>Duration (min)</th>
                  <th style={{ textAlign: "right", padding: "0.3rem 0.5rem" }}>Peak (A)</th>
                  <th style={{ textAlign: "left", padding: "0.3rem 0.5rem" }}>Band</th>
                </tr>
              </thead>
              <tbody>
                {report.events.map((e) => (
                  <tr key={e.start} style={{ borderBottom: "1px solid rgba(36,77,115,0.35)" }}>
                    <td style={{ padding: "0.3rem 0.5rem" }}>{e.start.slice(0, 19).replace("T", " ")}</td>
                    <td style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>{e.duration_min}</td>
                    <td style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>{e.peak_gic_a}</td>
                    <td style={{ padding: "0.3rem 0.5rem" }}>{e.level}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div>
            <div className="operations-chart-title" style={{ marginBottom: "0.4rem" }}>Interpretation</div>
            <ul style={{ fontSize: "0.82rem", lineHeight: 1.65, paddingLeft: "1.2rem", margin: 0 }}>
              {report.interpretation.map((note, i) => (
                <li key={i}>{note}</li>
              ))}
            </ul>
          </div>

          {report.kp_correlation && (
            <p style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
              |GIC| vs Kp: r = {report.kp_correlation.kp_r ?? "N/A"}
              {report.kp_correlation.dst_r != null && <> · |GIC| vs Dst: r = {report.kp_correlation.dst_r}</>}
              {" "}({report.kp_correlation.samples} co-sampled bins)
            </p>
          )}
        </div>
      )}
    </div>
  );

  const stationsWithData = status?.stations.filter((s) => s.has_data).length ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.2rem" }}>
      {series?.banner && (
        <div className="banner banner-alert" role="alert">
          {series.banner}
        </div>
      )}

      {/* ── KPI cards ── */}
      <div className="grid-4">
        <MetricCard
          label="Monitoring Stations"
          value={status ? status.stations.length : null}
          sub={`${stationsWithData} reporting field data`}
          variant={stationsWithData > 0 ? "ok" : "warn"}
        />
        <MetricCard
          label="Stored Measurements"
          value={status ? status.total_records.toLocaleString() : null}
          sub="transformer-neutral samples"
        />
        <MetricCard
          label={`Latest GIC — ${stationId || "N/A"}`}
          value={selectedStatus?.latest_gic_a != null ? selectedStatus.latest_gic_a.toFixed(2) : null}
          unit="A"
          sub={selectedStatus?.latest_level ? `${selectedStatus.latest_level} band` : "no data ingested yet"}
          variant={
            selectedStatus?.latest_level && ["High", "Severe"].includes(selectedStatus.latest_level)
              ? "alert"
              : selectedStatus?.latest_level === "Large"
                ? "warn"
                : "ok"
          }
        />
        <MetricCard
          label="EKF Deviation"
          value={series?.deviation?.available ? (series.deviation.ratio ?? 0).toFixed(2) : null}
          sub={
            series?.deviation?.available
              ? `severity: ${series.deviation.severity} (alert if ratio ≥ 1)`
              : "needs more observed history"
          }
          color={series?.deviation ? SEVERITY_COLOR[series.deviation.severity] : undefined}
        />
      </div>

      {/* ── ZETDC network map ── */}
      <div className="card card-accent">
        <div className="operations-chart-title">ZETDC Transmission Network &amp; GIC Sensors</div>
        <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.6rem" }}>
          HV substations and 330/400 kV lines of the Zimbabwe grid. Circled substations host a
          ZINGSA/ZETDC GIC monitoring station (clamp sensor on the transformer neutral). Click any
          feature for details.
        </p>
        <GicNetworkMap network={network} stationStatus={status?.stations ?? []} />
      </div>

      {/* ── Live station dashboard (Diagram 2 display) ── */}
      <GicLiveDashboard stationId={stationId} stationStatus={selectedStatus} network={network} />

      {/* ── Series controls + charts ── */}
      <div className="card card-accent">
        <div className="operations-chart-title">GIC Time Series — Observed vs EKF Predicted</div>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center", margin: "0.5rem 0 0.9rem" }}>
          <label style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>Station</label>
          <select
            value={stationId}
            onChange={(e) => setStationId(e.target.value)}
            className="form-select"
          >
            {(status?.stations ?? []).map((s) => (
              <option key={s.station_id} value={s.station_id}>
                {s.station_id} — {s.name}{s.has_data ? "" : " (no data)"}
              </option>
            ))}
          </select>
          <span style={{ width: "0.5rem" }} />
          {RANGES.map((r, i) => (
            <button
              key={r.label}
              type="button"
              className={`home-map-layer-btn${rangeIdx === i ? " is-active" : ""}`}
              onClick={() => setRangeIdx(i)}
            >
              {r.label}
            </button>
          ))}
        </div>

        {seriesLoading && !chartData && (
          <p style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>Loading series…</p>
        )}

        {!seriesLoading && (!chartData || chartData.observed.every((v) => v == null)) && (
          <div className="banner banner-info">
            No GIC measurements for {stationId || "this station"} in the selected window. Upload a
            CR1000 datalogger file below, or point the field gateway at <code>POST /gic/ingest</code>.
            Nothing is simulated — charts stay empty until real field data arrives.
          </div>
        )}

        {chartData && (
          <>
            <LineChart
              labels={chartData.labels}
              datasets={[
                { label: "Observed GIC (A)", data: chartData.observed, color: "#168bd2" },
                {
                  label: "EKF Predicted (A)",
                  data: chartData.predicted,
                  color: "#ff8c00",
                  dashed: true,
                  meta: chartData.meta,
                },
              ]}
              yLabel="GIC (A)"
              height={300}
              threshold={{ value: 10, label: "Large GIC (10 A)" }}
              thresholds={[
                { value: 25, label: "Moderate (25 A)", color: "#ffcc00" },
                { value: 50, label: "High (50 A)", color: "#ff7a00" },
                { value: 75, label: "Extreme (75 A)", color: "#ff2e2e" },
              ]}
            />
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
              Solid line: measured transformer-neutral current. Dashed line: one-step-ahead Extended
              Kalman Filter prediction. A persistent gap between them (beyond mean + 3σ of recent
              errors) triggers the geomagnetic disturbance alert.
            </p>

            <div className="operations-chart-title" style={{ marginTop: "1.1rem" }}>
              Rate of Change (GIC analogue of dB/dt)
            </div>
            <LineChart
              labels={chartData.labels}
              datasets={[{ label: "dGIC/dt (A/min)", data: chartData.rate, color: "#a78bfa" }]}
              yLabel="A / min"
              height={200}
            />
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
              Impulsive changes track dB/dt of the geomagnetic field — the physical driver of GIC.
              Sharp spikes during storm sudden commencements are the moments of highest transformer stress.
            </p>
          </>
        )}

        {swChart && (
          <>
            <div className="operations-chart-title" style={{ marginTop: "1.1rem" }}>
              Space-Weather Context (same window)
            </div>
            <div className="grid-2">
              <LineChart
                labels={swChart.labels}
                datasets={[{ label: "Kp Index", data: swChart.kp, color: "#00ff88" }]}
                yLabel="Kp"
                height={190}
                threshold={{ value: 5, label: "Storm (Kp 5)" }}
              />
              <LineChart
                labels={swChart.labels}
                datasets={[{ label: "Dst (nT)", data: swChart.dst, color: "#ff4444" }]}
                yLabel="Dst (nT)"
                height={190}
                threshold={{ value: -50, label: "Storm (−50 nT)" }}
              />
            </div>
            <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: "0.4rem" }}>
              GIC episodes that coincide with elevated Kp / depressed Dst are geomagnetically driven;
              activity without space-weather support points to local engineering sources.
            </p>
          </>
        )}
      </div>

      {reportPanel}

      {/* ── Risk bands reference ── */}
      {network && (
        <div className="card card-accent">
          <div className="operations-chart-title">Interpreting GIC Magnitudes</div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.82rem" }}>
            <thead>
              <tr style={{ borderBottom: "1px solid var(--border)" }}>
                <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Band</th>
                <th style={{ textAlign: "right", padding: "0.35rem 0.5rem" }}>|GIC| from</th>
                <th style={{ textAlign: "left", padding: "0.35rem 0.5rem" }}>Engineering meaning</th>
              </tr>
            </thead>
            <tbody>
              {network.risk_bands.map((b) => (
                <tr key={b.level} style={{ borderBottom: "1px solid rgba(36,77,115,0.35)" }}>
                  <td style={{ padding: "0.35rem 0.5rem", color: b.color, fontWeight: 700 }}>{b.level}</td>
                  <td style={{ padding: "0.35rem 0.5rem", textAlign: "right" }}>{b.min_abs_a} A</td>
                  <td style={{ padding: "0.35rem 0.5rem" }}>{b.meaning}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Data ingest ── */}
      <div className="card card-accent">
          <div className="operations-chart-title">Upload Datalogger File</div>
          <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.7rem" }}>
            Offline path: Campbell CR1000 TOA5 files or CSV with TIMESTAMP + GIC current columns.
            Duplicate timestamps are skipped automatically.
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <select
              value={uploadStation}
              onChange={(e) => setUploadStation(e.target.value)}
              className="form-select"
              style={{ alignSelf: "flex-start" }}
            >
              {(status?.stations ?? [{ station_id: "MARIMBA_001" }]).map((s) => (
                <option key={s.station_id} value={s.station_id}>{s.station_id}</option>
              ))}
            </select>
            <input ref={fileRef} type="file" accept=".dat,.csv,.txt" style={{ fontSize: "0.8rem" }} />
            <button type="button" className="btn btn-primary" onClick={handleUpload} disabled={uploadBusy} style={{ alignSelf: "flex-start" }}>
              {uploadBusy ? "Uploading…" : "Upload & Ingest"}
            </button>
            {uploadMsg && (
              <p style={{ fontSize: "0.78rem", color: uploadMsg.startsWith("✓") ? "#00ff88" : "#ff8c00" }}>{uploadMsg}</p>
            )}
          </div>
      </div>

    </div>
  );
}
