"use client";

import {
  TEC_DEFINITION,
  TEC_FORMULA,
  TEC_OPERATIONAL_NOTE,
  TEC_TYPICAL_VALUES,
  TEC_UNIT,
} from "@/lib/tecPrimer";

/** Compact “What is TEC” primer for metric cards and VTEC panels. */
export default function TecPrimerBlock({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`tec-primer${compact ? " tec-primer-compact" : ""}`}>
      <div className="sw-metric-explain-heading">What is TEC</div>
      <p className="sw-metric-explain-body">{TEC_DEFINITION}</p>
      <p className="tec-primer-formula" aria-label="TEC formula">
        <span className="tec-primer-formula-eq">{TEC_FORMULA}</span>
        <span className="tec-primer-formula-unit">{TEC_UNIT}</span>
      </p>
      <div className="sw-metric-explain-heading">Typical values</div>
      <table className="tec-primer-table">
        <thead>
          <tr>
            <th scope="col">Condition</th>
            <th scope="col">TEC (TECU)</th>
          </tr>
        </thead>
        <tbody>
          {TEC_TYPICAL_VALUES.map((row) => (
            <tr key={row.condition}>
              <td>{row.condition}</td>
              <td>{row.range}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!compact && (
        <>
          <p className="sw-metric-explain-body" style={{ marginTop: "0.65rem" }}>
            {TEC_OPERATIONAL_NOTE}
          </p>
          <p className="sw-metric-explain-body" style={{ marginTop: "0.45rem", fontSize: "0.78rem" }}>
            On Zimbabwe Ionospheric Response, open the teaching guide for STEC vs VTEC classification
            and the GOPI vs Gg calculation differences from TEC_GNSS_Notebook_v5.
          </p>
        </>
      )}
    </div>
  );
}
