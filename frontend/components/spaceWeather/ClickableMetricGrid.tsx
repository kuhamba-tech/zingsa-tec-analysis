"use client";

import Link from "next/link";
import { useState } from "react";
import type { SolarActivityFull, SpaceWeatherCurrent } from "@/lib/types";
import type { LiveStationCounts } from "@/lib/liveStationStatus";
import {
  METRIC_EXPLANATIONS,
  buildMetricCards,
  interpretMetric,
  type MetricCardSpec,
  type MetricKey,
} from "@/lib/spaceWeatherMetrics";

interface Props {
  sw: SpaceWeatherCurrent | null;
  updatedUtc?: string | null;
  showHint?: boolean;
  liveStationCounts?: LiveStationCounts | null;
  loading?: boolean;
  solar?: SolarActivityFull | null;
  liveMeanVtec?: number | null;
  solarLoading?: boolean;
  now?: number;
  refreshFailed?: boolean;
  solarRefreshFailed?: boolean;
}

function freshnessClass(freshness: MetricCardSpec["freshness"]): string {
  if (freshness === "LIVE") return "sw-metric-fresh sw-metric-fresh-live";
  if (freshness === "DELAYED") return "sw-metric-fresh sw-metric-fresh-delayed";
  if (freshness === "STALE") return "sw-metric-fresh sw-metric-fresh-stale";
  return "sw-metric-fresh sw-metric-fresh-unavailable";
}

function MetricCardButton({
  icon,
  label,
  value,
  note,
  valueColor,
  source,
  observedAt,
  freshness,
  selected,
  disabled,
  onClick,
}: {
  icon: string;
  label: string;
  value: string;
  note: string;
  valueColor: string;
  source?: string;
  observedAt?: string | null;
  freshness?: MetricCardSpec["freshness"];
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`sw-metric-card${selected ? " sw-metric-card-selected" : ""}${disabled ? " is-loading" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`${label}: ${value}. Click for explanation.`}
    >
      <span className="sw-metric-icon">{icon}</span>
      <div className="sw-metric-label">{label}</div>
      <div className="sw-metric-value" style={{ color: valueColor }}>
        {value}
      </div>
      <div className="sw-metric-note">{note}</div>
      <div className="sw-metric-meta">
        {freshness && freshness !== "DELAYED" && (
          <span className={freshnessClass(freshness)}>{freshness}</span>
        )}
        {source && <span className="sw-metric-source">{source}</span>}
        {observedAt && <span className="sw-metric-observed">{observedAt}</span>}
      </div>
    </button>
  );
}

function ExplanationPanel({
  label,
  value,
  metricKey,
  sw,
  solar,
  liveMeanVtec,
}: {
  label: string;
  value: string;
  metricKey: MetricKey;
  sw: SpaceWeatherCurrent | null;
  solar?: SolarActivityFull | null;
  liveMeanVtec?: number | null;
}) {
  return (
    <div className="sw-metric-explain">
      <div className="sw-metric-explain-title">{label}</div>
      <div className="sw-metric-explain-current">Current value: {value}</div>
      <div className="sw-metric-explain-heading">Explanation</div>
      <p className="sw-metric-explain-body">{METRIC_EXPLANATIONS[metricKey]}</p>
      <div className="sw-metric-explain-heading">Current Metric Interpretation</div>
      <p className="sw-metric-explain-body">
        {interpretMetric(sw, metricKey, { solar, liveMeanVtec })}
      </p>
      {metricKey === "stations" && (
        <p className="sw-metric-explain-body" style={{ marginTop: "0.65rem" }}>
          <Link href="/#cors-network" className="link-inline">
            View Network — open Zimbabwe CORS map
          </Link>
          . Online status, GNSS observation availability, and TEC processing are not always the same
          state.
        </p>
      )}
      {metricKey === "solar_flare" && solar && (
        <div className="sw-metric-explain-body" style={{ marginTop: "0.65rem" }}>
          <div className="sw-metric-explain-heading">Expanded details</div>
          <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
            <li>
              Solar activity: {solar.activity_label?.trim() || "Unavailable"}
            </li>
            <li>Current flare: {solar.flare_class?.trim() || "Unavailable"}</li>
            <li>
              SWPC alerts:{" "}
              {Array.isArray(solar.alerts) ? solar.alerts.length : "Unavailable"}
            </li>
            <li>
              <Link href="/storm-watch/" className="link-inline">
                Open Alerts for NOAA bulletins
              </Link>
            </li>
          </ul>
        </div>
      )}
      {metricKey === "solar_wind" && solar?.solar_wind && (
        <div className="sw-metric-explain-body" style={{ marginTop: "0.65rem" }}>
          <div className="sw-metric-explain-heading">Expanded details</div>
          <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
            <li>
              Speed:{" "}
              {solar.solar_wind.speed != null
                ? `${Math.round(solar.solar_wind.speed)} km/s`
                : "Updating…"}
            </li>
            <li>
              Density:{" "}
              {solar.solar_wind.density != null
                ? `${solar.solar_wind.density.toFixed(1)} p/cm³`
                : "Updating…"}
            </li>
            <li>
              Proton Temp.:{" "}
              {solar.solar_wind.temperature != null
                ? `${Math.round(solar.solar_wind.temperature).toLocaleString()} K`
                : "Updating…"}
            </li>
            <li>
              IMF Bz:{" "}
              {solar.solar_wind.bz != null
                ? `${solar.solar_wind.bz >= 0 ? "+" : ""}${solar.solar_wind.bz.toFixed(1)} nT`
                : "Updating…"}
            </li>
            <li>
              IMF Bt:{" "}
              {solar.solar_wind.bt != null
                ? `${solar.solar_wind.bt.toFixed(1)} nT`
                : "Updating…"}
            </li>
            <li>
              Dynamic pressure:{" "}
              {solar.solar_wind.dynamic_pressure != null
                ? `${solar.solar_wind.dynamic_pressure.toFixed(1)} nPa`
                : "Updating…"}
            </li>
          </ul>
        </div>
      )}
      {metricKey === "imf_bz" && solar?.solar_wind && (
        <div className="sw-metric-explain-body" style={{ marginTop: "0.65rem" }}>
          <div className="sw-metric-explain-heading">Expanded details</div>
          <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
            <li>
              Bz:{" "}
              {solar.solar_wind.bz != null ? `${solar.solar_wind.bz.toFixed(1)} nT` : "Updating…"}
            </li>
            <li>
              Bt:{" "}
              {solar.solar_wind.bt != null ? `${solar.solar_wind.bt.toFixed(1)} nT` : "Updating…"}
            </li>
            <li>
              Southward duration:{" "}
              {solar.solar_wind.southward_duration_minutes != null
                ? `${solar.solar_wind.southward_duration_minutes} min`
                : "Updating…"}
            </li>
          </ul>
        </div>
      )}
      {metricKey === "zimbabwe_iono" && (
        <div className="sw-metric-explain-body" style={{ marginTop: "0.65rem" }}>
          <div className="sw-metric-explain-heading">Local ionosphere products</div>
          <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
            <li>VTEC: live CORS network mean when available</li>
            <li>ΔTEC: reference baseline under development</li>
            <li>ROTI: calculating / unavailable until validated sampling window</li>
          </ul>
        </div>
      )}
    </div>
  );
}

export default function ClickableMetricGrid({
  sw,
  updatedUtc,
  showHint = true,
  liveStationCounts = null,
  loading = false,
  solar = null,
  liveMeanVtec = null,
  solarLoading = false,
  now,
  refreshFailed = false,
  solarRefreshFailed = false,
}: Props) {
  const [selected, setSelected] = useState<MetricKey | null>(null);
  const cards = buildMetricCards(sw, {
    liveStationCounts,
    solar,
    liveMeanVtec,
    solarLoading,
    indicesLoading: loading,
    now,
    refreshFailed,
    solarRefreshFailed,
  });

  const updatedNote = updatedUtc
    ? ` · Snapshot ${updatedUtc.slice(0, 16).replace("T", " ")} UTC`
    : "";

  const selectedCard = selected ? cards.find((c) => c.key === selected) : null;

  return (
    <div className="sw-metric-section">
      {showHint && (
        <p className="sw-metric-hint">
          What is happening now — click a card for the scientific explanation.{updatedNote}
        </p>
      )}
      <div className="dashboard-metric-grid sw-metric-grid">
        {cards.map((card) => (
          <MetricCardButton
            key={card.key}
            icon={card.icon}
            label={card.label}
            value={loading && !sw ? "Connecting…" : card.value}
            note={loading && !sw ? "Waiting for live API" : card.note}
            valueColor={card.valueColor}
            source={loading && !sw ? undefined : card.source}
            observedAt={loading && !sw ? null : card.observedAt}
            freshness={loading && !sw ? undefined : card.freshness}
            selected={selected === card.key}
            disabled={loading && !sw}
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
          solar={solar}
          liveMeanVtec={liveMeanVtec}
        />
      )}
    </div>
  );
}
