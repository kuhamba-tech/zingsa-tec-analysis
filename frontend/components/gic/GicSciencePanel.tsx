"use client";

import { useEffect, useMemo, useState } from "react";
import LineChart from "@/components/charts/LineChart";
import { getGicAssessment, getGicContext, getGicClimatology, saveGicConfiguration,
  type GicAssessment, type GicContext, type GicClimatology, type GicSiteAssessment, type GicSiteConfiguration } from "@/lib/gicOperations";
import styles from "./GicSciencePanel.module.css";

const fmt = (v: number | null | undefined, digits = 1) => v == null ? "Unknown" : v.toFixed(digits);
const when = (v: string | null | undefined) => v ? `${v.replace("T", " ").slice(0, 19)} UTC` : "No valid observation";
const age = (v: number | null | undefined) => v == null ? "Unknown" : v < 0 ? "Clock ahead" : v < 120 ? `${v.toFixed(0)} s` : v < 7200 ? `${(v / 60).toFixed(0)} min` : `${(v / 3600).toFixed(1)} h`;

function SiteSettings({ site, onSaved }: { site: GicSiteAssessment; onSaved: () => void }) {
  const [draft, setDraft] = useState<GicSiteConfiguration>(site.configuration);
  const [adminKey, setAdminKey] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const fields = [
    ["transformer_id", "Transformer identifier"], ["calibration_id", "Sensor calibration reference"],
    ["polarity_convention", "Positive current direction"], ["logger_timezone", "Logger timezone (e.g. UTC or Africa/Harare)"],
    ["commissioning_reference", "Commissioning record reference"], ["engineer_approved_by", "Approving ZETDC engineer"],
    ["engineer_approval_reference", "Engineering approval reference"], ["engineer_approved_at", "Approval timestamp with UTC offset"],
  ] as const;
  return <details className={styles.details}><summary>Administrator / {site.name} configuration</summary>
    <p>Categories are provisional unless site-specific engineering approval is recorded. Approval must identify the transformer. Credentials are held only in this form and are cleared after saving.</p>
    <form onSubmit={async event => {
      event.preventDefault(); setSaving(true); setMessage("");
      try { await saveGicConfiguration(site.station_id, draft, adminKey); setAdminKey(""); setMessage("Configuration saved with an audit record."); onSaved(); }
      catch (error) { setMessage(error instanceof Error ? error.message : "Save failed"); }
      finally { setSaving(false); }
    }}>
      <div className={styles.formGrid}>
        {draft.thresholds_a.map((value, i) => <label key={i}>Category {i + 1} threshold (|A|)<input required type="number" min="0.001" step="any" value={value} onChange={e => setDraft({ ...draft, thresholds_a: draft.thresholds_a.map((v, j) => j === i ? Number(e.target.value) : v) })} /></label>)}
        <label>Expected sample interval (seconds)<input type="number" min="1" max="86400" value={draft.expected_cadence_seconds ?? ""} onChange={e => setDraft({ ...draft, expected_cadence_seconds: e.target.value ? Number(e.target.value) : null })} /></label>
        {fields.map(([key, label]) => <label key={key}>{label}<input value={draft[key] ?? ""} onChange={e => setDraft({ ...draft, [key]: e.target.value || null })} /></label>)}
        <label>Administrator credential<input required type="password" autoComplete="off" value={adminKey} onChange={e => setAdminKey(e.target.value)} /></label>
      </div>
      <label className={styles.check}><input type="checkbox" checked={draft.commissioned} onChange={e => setDraft({ ...draft, commissioned: e.target.checked })} /> Commissioning evidence is documented for this installation</label>
      <button type="submit" className="btn" disabled={saving}>{saving ? "Saving..." : "Save station configuration"}</button>
      <p role="status">{message}</p>
    </form>
  </details>;
}

export default function GicSciencePanel({ stationId, hours, refreshToken }: { stationId: string; hours: number; refreshToken?: string }) {
  const [assessment, setAssessment] = useState<GicAssessment | null>(null);
  const [context, setContext] = useState<GicContext | null>(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [grouping, setGrouping] = useState("daily");
  const [seasons, setSeasons] = useState("");
  const [climatology, setClimatology] = useState<GicClimatology | null>(null);
  const [researchError, setResearchError] = useState("");
  const [researchBusy, setResearchBusy] = useState(false);
  useEffect(() => {
    let stopped = false;
    setAssessment(null); setContext(null); setError("");
    const load = async () => {
      const [a, c] = await Promise.allSettled([getGicAssessment(hours), getGicContext(stationId, hours)]);
      if (stopped) return;
      setAssessment(a.status === "fulfilled" ? a.value : null);
      setContext(c.status === "fulfilled" ? c.value : null);
      setError(a.status === "rejected" ? "Field assessment unavailable; counts and health could not be verified." : c.status === "rejected" ? "Some context sources are unavailable. Field observations remain separate." : "");
    };
    void load();
    const timer = window.setInterval(() => void load(), 60000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [stationId, hours, refreshToken, version]);
  useEffect(() => { setClimatology(null); setResearchError(""); }, [stationId, grouping, seasons]);
  const selected = assessment?.stations.find(s => s.station_id === stationId);
  const timeline = useMemo(() => {
    const times = new Set<string>();
    assessment?.comparison.forEach(p => times.add(new Date(p.t).toISOString()));
    context?.sources.forEach(s => s.points.forEach(p => times.add(new Date(p.t).toISOString())));
    return Array.from(times).sort();
  }, [assessment, context]);
  const labels = timeline.map(t => t.replace("T", " ").slice(0, 19));
  const sourceChart = (ids: string[], title: string, unit: string) => {
    const sources = context?.sources.filter(s => ids.includes(s.id)) ?? [];
    const hasPoints = sources.some(s => s.points.some(p => p.value != null));
    return <section className={styles.chart} key={title}><h3>{title}</h3>
      {hasPoints ? <LineChart labels={labels} datasets={sources.map((s, i) => { const values = new Map(s.points.map(p => [new Date(p.t).toISOString(), p.value])); return { label: s.id, data: timeline.map(t => values.get(t) ?? null), color: ["#75cbff", "#c4a0ff", "#74e4bd"][i % 3], spanGaps: false, tension: 0 }; })} yLabel={unit} height={170} /> : <p className={styles.empty}>No observations from this source in the selected window.</p>}
      {sources.map(s => <p className={styles.source} key={s.id}><strong>{s.id}</strong>: {when(s.latest_observation)} / age {age(s.age_seconds)}{s.fetch_failed ? " / fetch failed; retained source timestamps shown" : ""}<br />{s.source}{s.note ? ` / ${s.note}` : ""}</p>)}
    </section>;
  };
  const comparison = useMemo(() => {
    const values = new Map(assessment?.comparison.map(p => [new Date(p.t).toISOString(), p]) ?? []);
    return ["DEMA_001", "ALASKA_001"].map((id, i) => ({ label: `${id} measured current`, data: timeline.map(t => { const value = values.get(t)?.[id]; return typeof value === "number" ? value : null; }), color: i ? "#c4a0ff" : "#74e4bd", spanGaps: false, tension: 0 }));
  }, [assessment, timeline]);
  return <div className={styles.panel}>
    <section className={styles.intro}><span className={styles.kicker}>Field evidence / scientific assessment</span><h2>Measurement readiness & station comparison</h2>
      <p>Dema and Alaska are the registered monitoring sites. Station descriptions identify the intended sensor and logger architecture; verified commissioning, calibration and received measurements are tracked separately.</p>
      <p className={styles.notice}>Operational declaration withheld until actual transformer-neutral observations and commissioning evidence have been verified. Missing data are never simulated.</p>
    </section>
    {error && <p className="banner banner-warn" role="status">{error}</p>}
    {!assessment && !error && <p role="status">Checking stored observations and source health...</p>}
    {assessment && <>
      <div className={styles.sites}>{assessment.stations.map(site => <section key={site.station_id} className={styles.site}><h3>{site.name}</h3><span className={styles.kicker}>{site.station_id}</span>
        <dl><dt>Latest valid observation</dt><dd>{when(site.latest_valid_observation)}</dd><dt>Observation age</dt><dd>{age(site.data_age_seconds)}</dd><dt>Latest stored measurement in window</dt><dd>{when(site.latest_stored_measurement)}</dd>
          <dt>Sensor health</dt><dd>{site.sensor_health}</dd><dt>Communication evidence</dt><dd>{site.communications}</dd><dt>Logger clock offset</dt><dd>{fmt(site.clock_offset_seconds)} s / {site.clock_check}</dd>
          <dt>Transformer / calibration</dt><dd>{site.configuration.transformer_id ?? "Not documented"} / {site.configuration.calibration_id ?? "Not documented"}</dd><dt>Positive current direction</dt><dd>{site.configuration.polarity_convention ?? "Not documented"}</dd><dt>Transformer metadata</dt><dd>{Object.entries(site.configuration.transformer_metadata).map(([key, value]) => `${key}: ${String(value)}`).join("; ") || "Not documented"}</dd>
          <dt>Valid / stored records</dt><dd>{site.coverage.valid_records} / {site.coverage.records}</dd><dt>Missing-data percentage</dt><dd>{fmt(site.coverage.missing_pct)}{site.coverage.missing_pct == null ? " / configure expected cadence" : "%"}</dd>
          <dt>Peak magnitude / signed peak</dt><dd>{fmt(site.peak_abs_a, 3)} / {fmt(site.peak_signed_a, 3)} A</dd><dt>Polarity counts</dt><dd>{site.positive_samples} positive / {site.negative_samples} negative</dd><dt>Observed intervals ≥ {site.event_threshold_a} A</dt><dd>{fmt(site.above_event_threshold_seconds)} s / gaps excluded</dd>
        </dl></section>)}</div>
      <section className={styles.chart}><h3>Dema versus Alaska / synchronized signed current</h3><p>{when(assessment.window_start)} to {when(assessment.window_end)}. Shared UTC axis across all panels; no interpolation.</p>
        {assessment.comparison.length ? <LineChart labels={labels} datasets={comparison} yLabel="A" height={240} /> : <p className={styles.empty}>Neither station has genuine stored field observations in this window.</p>}
      </section>
    </>}
    <div className={styles.charts}>
      {sourceChart(["bx_nt", "by_nt", "bz_nt"], `${stationId} ground magnetic components`, "nT")}
      {sourceChart(["dbdt_horizontal", "dhdt"], "Horizontal magnetic-field rates", "nT/min")}
      {sourceChart(["imf_bz"], "IMF Bz / GSM at L1", "nT")}
      {sourceChart(["solar_wind"], "Solar-wind speed at L1", "km/s")}
      {sourceChart(["kp"], "Planetary Kp / context", "Kp")}
      {sourceChart(["sym_h"], "SYM-H / Kyoto archive context", "nT")}
    </div>
    <p className={styles.source}>dH/dt is computed from co-timed ground Bx and By in nT/min. Current rate dGIC/dt in A/min is a different quantity. Ground components require a documented sensor coordinate frame. Missing local magnetic measurements are never replaced with GOES satellite measurements.</p>
    {selected && <>
      <section className={styles.chart}><h3>Observed current flags</h3><p>These magnitude flags describe measurements, independently of prediction residuals. They do not diagnose transformer damage or authorize action.</p>
        {selected.observed_alerts.length ? selected.observed_alerts.map((flag, i) => <p key={i}>{when(flag.time)}: {fmt(flag.current_a, 3)} A / {flag.polarity} / {flag.provisional ? "provisional category" : "approved site policy"} / {flag.fresh ? "within configured freshness window" : "historical or freshness unknown"}. Observed threshold intervals: {fmt(flag.duration_seconds)} s.</p>) : <p>No observed-current flags in the latest valid record. Missing data do not establish quiet conditions.</p>}
      </section>
      <details className={styles.details} open><summary>EKF audit & independent test metrics / research only</summary>
        <p>{selected.validation.reason}</p><p>State: {selected.validation.state.join(", ")}. {selected.validation.inputs}.</p><p>{selected.validation.observation_model}. {selected.validation.uncertainty}.</p>
        <p>Fixed assumptions: {Object.entries(selected.validation.assumptions).map(([key, value]) => `${key}=${value}`).join("; ")}.</p>
        <p>Warm-up: {selected.validation.training_period ? `${when(selected.validation.training_period.start)} to ${when(selected.validation.training_period.end)}` : "No eligible period"}. Independent chronological test: {selected.validation.test_period ? `${when(selected.validation.test_period.start)} to ${when(selected.validation.test_period.end)}` : "No eligible period"}.</p>
        {selected.validation.metrics && <div className={styles.scroll}><table><thead><tr><th>Model</th><th>MAE (A)</th><th>RMSE (A)</th><th>Bias (A)</th><th>Test samples</th></tr></thead><tbody>{Object.entries(selected.validation.metrics).map(([name, metric]) => <tr key={name}><th>{name}</th><td>{fmt(metric.mae_a, 3)}</td><td>{fmt(metric.rmse_a, 3)}</td><td>{fmt(metric.bias_a, 3)}</td><td>{metric.samples}</td></tr>)}</tbody></table></div>}
        <p>Bias = predicted minus observed. A held-out one-step test assimilates earlier test observations after each prediction. Independent storm-event evaluation and uncertainty calibration are still needed. Operational prediction overlays and warnings remain disabled.</p>
      </details>
      <SiteSettings key={`${stationId}-${version}`} site={selected} onSaved={() => setVersion(v => v + 1)} />
    </>}
    <details className={styles.details}><summary>Archive research / daily to annual GIC statistics</summary><p>Group genuine stored observations by calendar period or local hour. Planetary storm context is shown separately; these summaries do not establish an ordinary daily baseline.</p>
      <div className={styles.researchControls}><label>Research grouping<select value={grouping} onChange={e => setGrouping(e.target.value)}><option value="daily">Daily</option><option value="monthly">Monthly</option><option value="seasonal">Seasonal / supplied month groups</option><option value="annual">Annual</option><option value="diurnal">Daily variation / hour in CAT</option></select></label>
        {grouping === "seasonal" && <label>Approved meteorological month groups (JSON)<input value={seasons} onChange={e => setSeasons(e.target.value)} placeholder='{"Season name":[1,2,3]}' /></label>}
        <button type="button" className="btn" disabled={researchBusy} onClick={async () => { setResearchBusy(true); setResearchError(""); setClimatology(null); try { setClimatology(await getGicClimatology(stationId, grouping, seasons || undefined)); } catch { setResearchError("Research summary unavailable. Seasonal month groups must explicitly cover each month exactly once."); } finally { setResearchBusy(false); } }}>{researchBusy ? "Loading..." : "Generate archive statistics"}</button>
      </div><p role="status">{researchError}</p>
      {climatology && <><p>{climatology.note}</p><div className={styles.scroll}><table><thead><tr><th>Period</th><th>Geomagnetic context</th><th>Samples</th><th>Mean (A)</th><th>Peak |A|</th><th>P95 |A|</th></tr></thead><tbody>{climatology.rows.map((row, i) => <tr key={i}><th>{row.period}</th><td>{row.geomagnetic_context}</td><td>{row.samples}</td><td>{fmt(row.mean_signed_a, 3)}</td><td>{fmt(row.peak_abs_a, 3)}</td><td>{fmt(row.p95_abs_a, 3)}</td></tr>)}</tbody></table></div></>}
    </details>
  </div>;
}
