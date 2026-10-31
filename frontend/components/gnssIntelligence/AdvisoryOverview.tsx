import type { AdvisoryRisk, GnssAdvisoryAssessment } from "@/lib/types";
import { formatNewsTime } from "@/lib/newsTimestamps";

const labels: Record<AdvisoryRisk, string> = {
  favourable: "Favourable",
  caution: "Caution",
  high_risk: "High risk",
  insufficient_data: "Insufficient data",
};
const colors: Record<AdvisoryRisk, string> = {
  favourable: "#39dc9a",
  caution: "#ffc857",
  high_risk: "#ff7676",
  insufficient_data: "#c4d0df",
};

function titleCase(value: string): string {
  const text = value.replaceAll("_", " ").trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

export default function AdvisoryOverview({ assessment: a }: { assessment: GnssAdvisoryAssessment }) {
  const readings = [
    { label: "Nearby station TEC", value: a.vtec == null ? "Unavailable" : `${a.vtec.toFixed(1)} TECU` },
    { label: "Ionospheric risk", value: labels[a.ionospheric_risk] },
    { label: "Observed GNSS performance", value: titleCase(a.gnss_performance) },
    {
      label: "Future working conditions",
      value: a.forecast_enabled ? "See validated intervals below" : "Pending — no validated forecast",
    },
  ];

  return (
    <section className="card gnwi-advisory-overview" aria-label="Current operational assessment">
      <header className="gnwi-advisory-head">
        <h3>
          {a.location} — <span style={{ color: colors[a.risk_level] }}>{labels[a.risk_level]}</span>
        </h3>
        <dl className="gnwi-advisory-times">
          <div>
            <dt>Data observed</dt>
            <dd>{formatNewsTime(a.observation_time) || "Unavailable"}</dd>
          </div>
          <div>
            <dt>Brief generated</dt>
            <dd>{formatNewsTime(a.issued_at)}</dd>
          </div>
        </dl>
      </header>

      <dl className="gnwi-evidence-grid">
        {readings.map((reading) => (
          <div key={reading.label}>
            <dt>{reading.label}</dt>
            <dd>{reading.value}</dd>
          </div>
        ))}
      </dl>

      <p className="gnwi-advisory-note">
        {a.coverage.warning}
        {a.coverage.contributors.length > 0 &&
          ` Contributors: ${a.coverage.contributors.map((s) => `${s.code.toUpperCase()} (${s.distance_km} km from reference)`).join(", ")}.`}
      </p>
      <p className="gnwi-advisory-note">
        TEC alone cannot confirm GPS accuracy. Freshness: {a.freshness}. Next check: {formatNewsTime(a.next_update)}.
      </p>

      <h3 className="gnwi-window-title">GNSS Working Window Advisor — {a.working_day} (CAT)</h3>
      <div className="gnwi-window-scroll" tabIndex={0} role="region" aria-label="Working window table">
        <table className="gnwi-window-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Assessment</th>
              <th>Basis and advice</th>
            </tr>
          </thead>
          <tbody>
            {a.working_windows.map((w) => (
              <tr key={w.start}>
                <th scope="row">{w.time_cat}</th>
                <td>
                  <span className="gnwi-assess-pill" style={{ color: colors[w.risk_level] }}>
                    {labels[w.risk_level]}
                  </span>
                </td>
                <td className="gnwi-window-advice">
                  <strong>{titleCase(w.basis)}</strong>
                  <span>{w.conditions}</span>
                  <span>{w.recommendation}</span>
                  {w.confidence != null && <span>Confidence: {Math.round(w.confidence * 100)}%.</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="gnwi-risk-legend">
        {Object.entries(labels).map(([risk, label]) => (
          <li key={risk}>
            <span className="gnwi-risk-swatch" style={{ background: colors[risk as AdvisoryRisk] }} />
            {label}
          </li>
        ))}
      </ul>

      <details>
        <summary>Evidence, methodology and limits</summary>
        <p>
          Assessment {a.assessment_id}; rules {a.rules_version}. Valid until {formatNewsTime(a.valid_until)}. Confidence:{" "}
          {a.confidence == null ? "not established" : a.confidence}.
        </p>
        <ul>{a.limitations.map((l) => <li key={l}>{l}</li>)}</ul>
        <p>
          Station-mean TEC change: {a.tec_rate_tecu_per_min ?? "Unavailable"} TECU/min. ROT: {a.rot ?? "Unavailable"}; ROTI:{" "}
          {a.roti ?? "Unavailable"}; calibrated anomaly: {a.delta_tec ?? "Unavailable"}.
        </p>
        <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(a.data_sources, null, 2)}</pre>
      </details>
    </section>
  );
}
