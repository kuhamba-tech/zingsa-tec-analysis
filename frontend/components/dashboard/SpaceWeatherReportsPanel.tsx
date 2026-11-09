"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import styles from "./SpaceWeatherReportsPanel.module.css";
import LineChart from "@/components/charts/LineChart";
import { getSpaceWeatherReport } from "@/lib/api";
import { downloadSpaceWeatherReportPdf } from "@/lib/reportPdf";
import { conditionsForSeries } from "@/lib/spaceWeatherMetrics";
import type {
  EkfStatus,
  SpaceWeatherReport,
  SpaceWeatherReportDiurnalCard,
  SpaceWeatherReportPeriod,
} from "@/lib/types";

function parameterColor(name: string, value: number | null): string {
  if (value == null) return "#94a3b8";
  if (/kp/i.test(name)) {
    if (value < 3) return "#22c55e";
    if (value < 4) return "#84cc16";
    if (value < 5) return "#eab308";
    if (value < 6) return "#f97316";
    return "#ef4444";
  }
  if (/dst/i.test(name)) {
    if (value < -100) return "#ef4444";
    if (value < -50) return "#f97316";
    if (value < -20) return "#eab308";
    return "#00ff88";
  }
  if (/wind/i.test(name)) {
    if (value > 700) return "#f97316";
    if (value > 500) return "#eab308";
    return "#38bdf8";
  }
  if (/tec/i.test(name)) {
    if (value < 10) return "#00ff88";
    if (value < 40) return "#38bdf8";
    if (value < 100) return "#eab308";
    return "#ef4444";
  }
  if (/s4|scint/i.test(name)) {
    if (value >= 0.5) return "#ef4444";
    if (value >= 0.3) return "#f97316";
    if (value >= 0.15) return "#eab308";
    return "#22c55e";
  }
  return "#38bdf8";
}

function DiurnalMetricCard({ card }: { card: SpaceWeatherReportDiurnalCard }) {
  return (
    <article
      className={styles.metricCard}
      aria-label={card.label}
      style={{ ["--fact-accent" as string]: card.value_color }}
    >
      <span className={styles.metricLabel}>{card.label}</span>
      <strong className={styles.metricValue} style={{ color: card.value_color }}>
        {card.value == null ? "Unavailable" : `${card.value.toFixed(1)} ${card.unit}`}
        <span className={styles.metricSubtitle} style={{ color: card.value_color }}>
          · {card.status_label}
        </span>
      </strong>
      <span className={styles.metricNote}>
        Expected quiet band {card.expected_low.toFixed(0)}–{card.expected_high.toFixed(0)} TECU
      </span>
      <span className={styles.metricMeta}>
        {card.sample_count} sample{card.sample_count === 1 ? "" : "s"} · CAT{" "}
        {card.hours_cat[0]?.toString().padStart(2, "0")}–{card.hours_cat[card.hours_cat.length - 1]?.toString().padStart(2, "0")}
      </span>
    </article>
  );
}

const PERIODS: { id: SpaceWeatherReportPeriod; label: string }[] = [
  { id: "hourly", label: "Hourly Report (Last 1 Hour)" },
  { id: "daily", label: "Daily Report (Last 24 Hours)" },
  { id: "weekly", label: "Weekly Report (Last 7 Days)" },
  { id: "monthly", label: "Monthly Report (Last 30 Days)" },
  { id: "yearly", label: "Yearly Report (Last 365 Days)" },
];

function fmtUtc(iso: string): string {
  return iso.slice(0, 16).replace("T", " ") + " UTC";
}

interface Props {
  ekf?: EkfStatus | null;
  initialPeriod?: SpaceWeatherReportPeriod;
}


/** Space weather report card — dashboard and /reports. */
export default function SpaceWeatherReportsPanel({
  ekf = null,
  initialPeriod = "hourly",
}: Props) {
  const [period, setPeriod] = useState<SpaceWeatherReportPeriod>(initialPeriod);
  const [report, setReport] = useState<SpaceWeatherReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (p: SpaceWeatherReportPeriod) => {
    setBusy(true);
    setError(null);
    try {
      const data = await getSpaceWeatherReport(p);
      setReport(data);
    } catch (loadError) {
      const detail = loadError instanceof Error ? loadError.message : "Unknown report error";
      if (/timed out/i.test(detail)) {
        setError(
          "Report request timed out — the backend may be cold-starting. Click Generate Report to retry.",
        );
      } else if (/→ 5\d\d/.test(detail) || /→ 500/.test(detail)) {
        setError(
          "Report server error — try again in a moment. If it persists, check space-weather archive health.",
        );
      } else if (/unreachable|Failed to fetch|NetworkError/i.test(detail)) {
        setError("Could not reach the API — check that the backend is running.");
      } else {
        setError(`Could not load report — ${detail}`);
      }
      setReport(null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    setPeriod(initialPeriod);
  }, [initialPeriod]);

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
            datasets={[
              { label: "Kp (Observed)", data: kp, color: "#a78bfa" },
            ]}
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
            datasets={[
              { label: "Dst (Observed)", data: dst, color: "#168bd2" },
            ]}
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
            datasets={[
              { label: "TEC (Observed)", data: tec, color: "#00ff88" },
            ]}
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

  const [exportBusy, setExportBusy] = useState(false);

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

  const handleExportPdf = async () => {
    if (!report) return;
    setExportBusy(true);
    try {
      await downloadSpaceWeatherReportPdf(report);
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <div className={`card sw-report-panel ${styles.panel}`}>
      <div className="sw-report-header">
        <div className="sw-report-header-copy">
          <div className="sw-report-icon" aria-hidden>📋</div>
          <div>
            <h2 className="sw-report-title">Space Weather Reports</h2>
            <p className="sw-report-subtitle">
              An evidence-led assessment of the Sun-Earth environment and its relevance to Zimbabwe.
            </p>
          </div>
        </div>
        <div className="sw-report-header-actions">
          <button
            type="button"
            className="btn sw-report-share-btn"
            onClick={() => {
              void import("@/lib/safeClipboard").then(({ safeClipboardWrite }) => {
                void safeClipboardWrite(window.location.href);
              });
            }}
          >
            Share
          </button>
          <button type="button" className="btn sw-report-export-btn" onClick={handleExportJson} disabled={!report}>
            Export JSON
          </button>
          <button
            type="button"
            className="btn btn-primary sw-report-export-btn"
            onClick={() => void handleExportPdf()}
            disabled={!report || exportBusy}
          >
            {exportBusy ? "Saving PDF…" : "Save PDF"}
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
          <article className={styles.assessment} aria-label="Scientific assessment">
            <header className={styles.masthead}>
              <span className={styles.kicker}>ZINGSA / Space weather assessment</span>
              <h3>{report.period.charAt(0).toUpperCase() + report.period.slice(1)} scientific bulletin</h3>
              <p>{fmtUtc(report.window_start)} to {fmtUtc(report.window_end)}</p>
              <div className={styles.metadata}><span>Issued {fmtUtc(report.generated_utc)}</span><span>{report.sample_count.toLocaleString()} archived records</span><span>Automated assessment / scientist review not recorded</span></div>
            </header>
            <section className={styles.summary} aria-labelledby="report-summary-heading">
              <span className={styles.kicker}>01 / Overview</span>
              <h4 id="report-summary-heading">Assessment at a glance</h4>
              <p>
                {report.sections?.length
                  ? report.executive_summary
                  : "This archive contains the parameter records shown below. Regenerate with the updated reporting service for the structured scientific assessment; local operational impacts have not been independently established."}
              </p>
              <p className={styles.scope}>
                Retrospective assessment of available records. Local impacts and future conditions require
                additional evidence.
              </p>
            </section>

            {(report.diurnal_cards?.length ?? 0) > 0 && (
              <section aria-labelledby="report-diurnal-heading">
                <div className={styles.summary} style={{ borderBottom: "none", paddingBottom: "0.35rem" }}>
                  <span className={styles.kicker}>02 / Diurnal TEC</span>
                  <h4 id="report-diurnal-heading">Morning, noon and night versus expected quiet-day values</h4>
                  <p>
                    Network-mean TEC in CAT, compared with quiet-day climatological bands used on Live Space
                    Weather. Colour follows the same severity palette as the live metric cards.
                  </p>
                </div>
                <div className={`${styles.metricGrid} ${styles.metricGridDiurnal}`}>
                  {report.diurnal_cards!.map((card) => (
                    <DiurnalMetricCard key={card.id} card={card} />
                  ))}
                </div>
              </section>
            )}

            {report.parameters.length > 0 && (
              <section aria-labelledby="report-params-heading">
                <div className={styles.summary} style={{ borderBottom: "none", paddingBottom: "0.35rem" }}>
                  <span className={styles.kicker}>03 / Indicators</span>
                  <h4 id="report-params-heading">Latest archived measurements</h4>
                  <p>Latest record in the window — not the period maximum. Tile layout matches Alerts Centre index cards.</p>
                </div>
                <div className={styles.metricGrid}>
                  {report.parameters.map((parameter) => {
                    const color = parameterColor(parameter.name, parameter.current);
                    return (
                      <article
                        className={styles.metricCard}
                        key={parameter.name}
                        style={{ ["--fact-accent" as string]: color }}
                      >
                        <span className={styles.metricLabel}>{parameter.name}</span>
                        <strong className={styles.metricValue} style={{ color }}>
                          {parameter.current == null
                            ? "Unavailable"
                            : `${parameter.current.toFixed(1)}${parameter.unit ? ` ${parameter.unit}` : ""}`}
                          <span className={styles.metricSubtitle} style={{ color }}>
                            {" "}
                            · {parameter.current == null ? "—" : parameter.trend}
                          </span>
                        </strong>
                        <span className={styles.metricNote}>{parameter.interpretation}</span>
                      </article>
                    );
                  })}
                </div>
              </section>
            )}

            {report.sections?.length ? (
              <div className={styles.narrative}>
                {report.sections.map((section, index) => (
                  <section key={section.id} id={`report-${section.id}`}>
                    <span className={styles.kicker}>
                      {String(index + 4).padStart(2, "0")} /{" "}
                      {section.id === "methods" ? "Methods" : "Assessment"}
                    </span>
                    <h4>{section.title}</h4>
                    {section.paragraphs.map((paragraph, i) => (
                      <p key={i}>{paragraph}</p>
                    ))}
                  </section>
                ))}
              </div>
            ) : null}

            {!!report.references?.length && (
              <footer className={styles.references}>
                <h4>Scientific reference framework</h4>
                <p>These references explain the indicators; they are not an endorsement of this generated bulletin.</p>
                {report.references.map((reference) => (
                  <a key={reference.url} href={reference.url} target="_blank" rel="noreferrer">
                    {reference.title}
                  </a>
                ))}
              </footer>
            )}
          </article>

          {chartsBlock && (
            <div className="sw-report-charts-section">
              <div className="sw-report-charts-header">
                <div className="sw-report-section-title">Key Charts ({periodLabel.replace(/ Report.*/, "")})</div>
                <Link className="btn sw-report-view-charts-btn" href="/time-series/">Explore time series</Link>
              </div>
              {chartsBlock}
              <p className={styles.chartNote}>Selected archive records, shown in UTC. Connecting lines are visual guides; gaps and short-lived peaks may not be fully represented. These plots are retrospective observations, not forecasts.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
