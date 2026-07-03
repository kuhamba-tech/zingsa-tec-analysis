"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import LineChart from "@/components/charts/LineChart";
import { getSpaceWeatherReport } from "@/lib/api";
import { conditionsForSeries } from "@/lib/spaceWeatherMetrics";
import type { SpaceWeatherReport, SpaceWeatherReportPeriod } from "@/lib/types";

const PERIODS: { id: SpaceWeatherReportPeriod; label: string }[] = [
  { id: "hourly", label: "Hourly Report (Last 1 Hour)" },
  { id: "daily", label: "Daily Report (Today)" },
  { id: "weekly", label: "Weekly Report (This Week)" },
  { id: "monthly", label: "Monthly Report (This Month)" },
  { id: "yearly", label: "Yearly Report (This Year)" },
];

function fmtUtc(iso: string): string {
  return iso.slice(0, 16).replace("T", " ") + " UTC";
}

/** Space weather report card — inserted between scale reference and metric correlations. */
export default function SpaceWeatherReportsPanel() {
  const [period, setPeriod] = useState<SpaceWeatherReportPeriod>("hourly");
  const [report, setReport] = useState<SpaceWeatherReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: SpaceWeatherReportPeriod) => {
    setBusy(true);
    setError(null);
    try {
      const data = await getSpaceWeatherReport(p);
      setReport(data);
    } catch {
      setError("Could not load report — check that the backend is running and the archive has samples.");
      setReport(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    load(period);
  }, [load, period]);

  const periodLabel = PERIODS.find((p) => p.id === period)?.label ?? "Report";

  const chartsBlock = useMemo(() => {
    if (!report?.charts.labels.length) return null;
    const { labels, kp, dst, tec } = report.charts;
    const kpConditions = conditionsForSeries(kp, "kp");
    const dstConditions = conditionsForSeries(dst, "dst");
    const tecConditions = conditionsForSeries(tec, "tec");
    return (
      <div className="sw-report-charts">
        <div className="sw-report-mini-chart">
          <div className="sw-report-mini-title">Kp Index</div>
          <LineChart
            labels={labels}
            datasets={[{ label: "Kp", data: kp, color: "#a78bfa" }]}
            yLabel="Kp"
            height={120}
            tooltipDetails={kpConditions}
            tooltipDetailLabel="Geomagnetic condition"
            compact
          />
        </div>
        <div className="sw-report-mini-chart">
          <div className="sw-report-mini-title">Dst Index (nT)</div>
          <LineChart
            labels={labels}
            datasets={[{ label: "Dst", data: dst, color: "#168bd2" }]}
            yLabel="nT"
            height={120}
            tooltipDetails={dstConditions}
            tooltipDetailLabel="Geomagnetic condition"
            compact
          />
        </div>
        <div className="sw-report-mini-chart">
          <div className="sw-report-mini-title">TEC (TECU)</div>
          <LineChart
            labels={labels}
            datasets={[{ label: "TEC", data: tec, color: "#00ff88" }]}
            yLabel="TECU"
            height={120}
            tooltipDetails={tecConditions}
            tooltipDetailLabel="Ionospheric condition"
            compact
          />
        </div>
      </div>
    );
  }, [report]);

  const handleExportJson = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `space_weather_${report.period}_report.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const scrollToCharts = () => {
    document.getElementById("dashboard-timelines")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="card sw-report-panel">
      <div className="sw-report-header">
        <div className="sw-report-header-copy">
          <div className="sw-report-icon" aria-hidden>📋</div>
          <div>
            <h2 className="sw-report-title">Space Weather Reports</h2>
            <p className="sw-report-subtitle">
              Generated insights and analysis of space weather conditions and their impact.
            </p>
          </div>
        </div>
        <div className="sw-report-header-actions">
          <button type="button" className="btn sw-report-share-btn" onClick={() => navigator.clipboard?.writeText(window.location.href)}>
            Share
          </button>
          <button type="button" className="btn sw-report-export-btn" onClick={handleExportJson} disabled={!report}>
            Export ▾
          </button>
        </div>
      </div>

      <div className="sw-report-controls">
        <label className="sw-report-control-label">
          Select Report Period
          <select
            className="form-select sw-report-select"
            value={period}
            onChange={(e) => setPeriod(e.target.value as SpaceWeatherReportPeriod)}
          >
            {PERIODS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </label>
        {report && (
          <>
            <label className="sw-report-control-label">
              From
              <input className="form-input sw-report-date" readOnly value={fmtUtc(report.window_start)} />
            </label>
            <label className="sw-report-control-label">
              To
              <input className="form-input sw-report-date" readOnly value={fmtUtc(report.window_end)} />
            </label>
          </>
        )}
        <button type="button" className="btn sw-report-generate-btn" onClick={() => load(period)} disabled={busy}>
          {busy ? "Generating…" : "✦ Generate Report"}
        </button>
      </div>

      {error && <div className="banner banner-warn">{error}</div>}

      {busy && !report && <div className="banner banner-info">Building {periodLabel.toLowerCase()}…</div>}

      {report && !busy && (
        <>
          <div className="sw-report-summary">
            <p>{report.executive_summary}</p>
            <span className="sw-report-impact-badge" style={{ backgroundColor: report.impact.color }}>
              {report.impact.label}
            </span>
          </div>

          {chartsBlock && (
            <div className="sw-report-charts-section">
              <div className="sw-report-charts-header">
                <div className="sw-report-section-title">Key Charts ({periodLabel.replace(/ Report.*/, "")})</div>
                <button type="button" className="btn sw-report-view-charts-btn" onClick={scrollToCharts}>
                  View Full Charts
                </button>
              </div>
              {chartsBlock}
            </div>
          )}
        </>
      )}
    </div>
  );
}
