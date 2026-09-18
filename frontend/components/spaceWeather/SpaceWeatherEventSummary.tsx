"use client";

import { useState } from "react";
import type { SolarActivityFull, SpaceWeatherCurrent } from "@/lib/types";
import {
  buildSpaceWeatherEventSummary,
  type ChainStageStatus,
} from "@/lib/spaceWeatherEventSummary";
import type { ForecastStatus } from "@/lib/gnssWeatherIntelligence";

interface Props {
  sw: SpaceWeatherCurrent | null;
  solar?: SolarActivityFull | null;
  loading?: boolean;
}

const TONE_BORDER: Record<ForecastStatus, string> = {
  excellent: "#00ff88",
  moderate: "#eab308",
  warning: "#ef4444",
};

function statusColor(status: ChainStageStatus): string {
  if (status === "STORM" || status === "DISTURBED") return "#ef4444";
  if (status === "ELEVATED" || status === "ACTIVE") return "#eab308";
  if (status === "UNAVAILABLE") return "#94a3b8";
  return "#00ff88";
}

export default function SpaceWeatherEventSummary({
  sw,
  solar = null,
  loading = false,
}: Props) {
  const [showChain, setShowChain] = useState(true);
  const [showCaveat, setShowCaveat] = useState(false);

  if (loading && !sw) {
    return (
      <section className="sw-event-summary is-loading" aria-busy="true" aria-label="Space weather event summary">
        <div className="sw-event-summary-title">CURRENT SPACE WEATHER — ZIMBABWE</div>
        <p className="sw-event-summary-body">Connecting to live indices…</p>
      </section>
    );
  }

  if (!sw) return null;

  const summary = buildSpaceWeatherEventSummary(sw, solar);

  return (
    <section
      className="sw-event-summary"
      style={{ borderColor: TONE_BORDER[summary.tone] }}
      aria-label="Space weather event summary for Zimbabwe"
    >
      <div className="sw-event-summary-head">
        <h2 className="sw-event-summary-title">{summary.title}</h2>
        <span className="sw-event-summary-updated">{summary.updatedLabel}</span>
      </div>

      <div className="sw-event-summary-blocks">
        <div className="sw-event-block">
          <div className="sw-event-block-title">🌍 {summary.globalHeadline}</div>
          <p className="sw-event-summary-body">{summary.globalBody}</p>
        </div>
        <div className="sw-event-block">
          <div className="sw-event-block-title">🇿🇼 {summary.ionosphereHeadline}</div>
          <p className="sw-event-summary-body">{summary.ionosphereBody}</p>
        </div>
        <div className="sw-event-block">
          <div className="sw-event-block-title">🛰️ {summary.gnssHeadline}</div>
          <p className="sw-event-summary-body">{summary.gnssBody}</p>
        </div>
      </div>

      <div className="sw-event-summary-actions">
        <button
          type="button"
          className="sw-event-summary-toggle"
          onClick={() => setShowChain((v) => !v)}
          aria-expanded={showChain}
        >
          {showChain ? "Hide evidence chain ▾" : "Show evidence chain ▸"}
        </button>
        <button
          type="button"
          className="sw-event-summary-toggle"
          onClick={() => setShowCaveat((v) => !v)}
          aria-expanded={showCaveat}
        >
          {showCaveat ? "Hide association rules ▾" : "Association rules ▸"}
        </button>
      </div>

      {showChain && (
        <ol className="sw-event-chain" aria-label="Sun to advisory evidence chain">
          {summary.stages.map((stage, index) => (
            <li key={stage.id} className="sw-event-chain-stage">
              {index > 0 && <span className="sw-event-chain-arrow" aria-hidden>↓</span>}
              <div className="sw-event-chain-card">
                <span className="sw-event-chain-label">{stage.label}</span>
                <span className="sw-event-chain-detail">{stage.detail}</span>
                <span
                  className="sw-event-chain-status"
                  style={{ color: statusColor(stage.status) }}
                >
                  {stage.status}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}

      {showCaveat && <p className="sw-event-summary-caveat">{summary.caveat}</p>}
    </section>
  );
}
