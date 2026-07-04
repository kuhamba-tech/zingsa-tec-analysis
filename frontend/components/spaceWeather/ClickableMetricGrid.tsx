"use client";

import { useState } from "react";
import type { SpaceWeatherCurrent } from "@/lib/types";
import type { LiveStationCounts } from "@/lib/liveStationStatus";
import {
  METRIC_EXPLANATIONS,
  buildMetricCards,
  interpretMetric,
  type MetricKey,
} from "@/lib/spaceWeatherMetrics";

interface Props {
  sw: SpaceWeatherCurrent | null;
  updatedUtc?: string | null;
  showHint?: boolean;
  liveStationCounts?: LiveStationCounts | null;
}

function MetricCardButton({
  icon,
  label,
  value,
  note,
  valueColor,
  selected,
  onClick,
}: {
  icon: string;
  label: string;
  value: string;
  note: string;
  valueColor: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`sw-metric-card${selected ? " sw-metric-card-selected" : ""}`}
      onClick={onClick}
      aria-pressed={selected}
      aria-label={`${label}: ${value}. Click for explanation.`}
    >
      <span className="sw-metric-icon">{icon}</span>
      <div className="sw-metric-label">{label}</div>
      <div className="sw-metric-value" style={{ color: valueColor }}>
        {value}
      </div>
      <div className="sw-metric-note">{note}</div>
    </button>
  );
}

function ExplanationPanel({
  label,
  value,
  metricKey,
  sw,
}: {
  label: string;
  value: string;
  metricKey: MetricKey;
  sw: SpaceWeatherCurrent | null;
}) {
  return (
    <div className="sw-metric-explain">
      <div className="sw-metric-explain-title">{label}</div>
      <div className="sw-metric-explain-current">Current value: {value}</div>
      <div className="sw-metric-explain-heading">Explanation</div>
      <p className="sw-metric-explain-body">{METRIC_EXPLANATIONS[metricKey]}</p>
      <div className="sw-metric-explain-heading">Current Metric Interpretation</div>
      <p className="sw-metric-explain-body">{interpretMetric(sw, metricKey)}</p>
    </div>
  );
}

export default function ClickableMetricGrid({ sw, updatedUtc, showHint = true, liveStationCounts = null }: Props) {
  const [selected, setSelected] = useState<MetricKey | null>(null);
  const cards = buildMetricCards(sw, { liveStationCounts });

  const updatedNote = updatedUtc
    ? ` · Updated ${updatedUtc.slice(0, 16).replace("T", " ")} UTC`
    : "";

  const selectedCard = selected ? cards.find((c) => c.key === selected) : null;

  return (
    <div className="sw-metric-section">
      {showHint && (
        <p className="sw-metric-hint">
          Click a card for an explanation of what the value means.{updatedNote}
        </p>
      )}
      <div className="dashboard-metric-grid sw-metric-grid">
        {cards.map((card) => (
          <MetricCardButton
            key={card.key}
            icon={card.icon}
            label={card.label}
            value={card.value}
            note={card.note}
            valueColor={card.valueColor}
            selected={selected === card.key}
            onClick={() => setSelected((prev) => (prev === card.key ? null : card.key))}
          />
        ))}
      </div>
      {selectedCard && (
        <ExplanationPanel
          label={selectedCard.label}
          value={selectedCard.value}
          metricKey={selectedCard.key}
          sw={sw}
        />
      )}
    </div>
  );
}
