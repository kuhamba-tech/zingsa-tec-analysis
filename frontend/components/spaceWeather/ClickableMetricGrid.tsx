"use client";

import Link from "next/link";
import { useState } from "react";
import type { SolarActivityFull, SpaceWeatherCurrent } from "@/lib/types";
import type { LiveStationCounts } from "@/lib/liveStationStatus";
import { FLARE_SCALE } from "@/lib/solarEventColors";
import {
  METRIC_EXPLANATIONS,
  buildMetricCards,
  interpretMetric,
  type MetricCardSpec,
  type MetricDetailRow,
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

function DetailRows({ rows }: { rows: MetricDetailRow[] }) {
  const isList = rows.some((row) => Boolean(row.icon));
  return (
    <div className={`sw-metric-detail-rows${isList ? " sw-metric-detail-rows-list" : ""}`}>
      {rows.map((row) => (
        <div className="sw-metric-detail-row" key={row.label}>
          <span className="sw-metric-detail-left">
            {row.icon ? <span className="sw-metric-detail-icon" aria-hidden>{row.icon}</span> : null}
            <span className="sw-metric-detail-label">{row.label}</span>
          </span>
          <span className="sw-metric-detail-value" style={row.valueColor ? { color: row.valueColor } : undefined}>
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function FlareScaleLegend() {
  return (
    <div className="sw-metric-flare-scale" aria-label="GOES flare class scale">
      {FLARE_SCALE.map((f) => (
        <div className="sw-metric-flare-scale-item" key={f.cls}>
          <div className="sw-metric-flare-scale-bar" style={{ background: f.color }} />
          <div className="sw-metric-flare-scale-letter" style={{ color: f.color }}>
            {f.cls}-
          </div>
          <div className="sw-metric-flare-scale-desc">{f.desc}</div>
        </div>
      ))}
    </div>
  );
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
  subtitle,
  detailRows,
  showFlareScale,
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
  subtitle?: string | null;
  detailRows?: MetricDetailRow[];
  showFlareScale?: boolean;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const isSummary = Boolean(detailRows?.length) && !detailRows?.some((r) => r.icon);
  const isWindList = Boolean(detailRows?.some((r) => r.icon));
  const isFlare = Boolean(showFlareScale);

  return (
    <button
      type="button"
      className={`sw-metric-card${isSummary ? " sw-metric-card-summary" : ""}${isWindList ? " sw-metric-card-wind" : ""}${isFlare ? " sw-metric-card-flare" : ""}${selected ? " sw-metric-card-selected" : ""}${disabled ? " is-loading" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`${label}: ${value}. Click for explanation.`}
    >
      <span className="sw-metric-icon">{icon}</span>
      <div className="sw-metric-label">{label}</div>
      {isFlare && <div className="sw-metric-eyebrow">Current class:</div>}
      <div className="sw-metric-value" style={{ color: valueColor }}>
        {value}
      </div>
      {subtitle ? <div className="sw-metric-subtitle">{subtitle}</div> : null}
      {detailRows?.length ? <DetailRows rows={detailRows} /> : null}
      {showFlareScale ? <FlareScaleLegend /> : null}
      {note ? <div className="sw-metric-note">{note}</div> : null}
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
      {metricKey === "solar_activity" && solar && (
        <div className="sw-metric-explain-body" style={{ marginTop: "0.65rem" }}>
          <div className="sw-metric-explain-heading">Expanded details</div>
          <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
            <li>Solar activity: {solar.activity_label?.trim() || "Unavailable"}</li>
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
      {metricKey === "solar_flare" && solar && (
        <div className="sw-metric-explain-body" style={{ marginTop: "0.65rem" }}>
          <div className="sw-metric-explain-heading">Expanded details</div>
          <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
            <li>Current class: {solar.flare_class?.trim() || "Unavailable"}</li>
            <li>
              Flux:{" "}
              {solar.flux != null && Number.isFinite(solar.flux)
                ? `${solar.flux.toExponential(2)} W/m²`
                : "Unavailable"}
            </li>
            <li>Band: GOES soft X-ray 0.1–0.8 nm</li>
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
            value={loading && !sw && !solar ? "Connecting…" : card.value}
            note={loading && !sw && !solar ? "Waiting for live API" : card.note}
            valueColor={card.valueColor}
            source={loading && !sw && !solar ? undefined : card.source}
            observedAt={loading && !sw && !solar ? null : card.observedAt}
            freshness={loading && !sw && !solar ? undefined : card.freshness}
            subtitle={card.subtitle}
            detailRows={card.detailRows}
            showFlareScale={card.showFlareScale}
            selected={selected === card.key}
            disabled={loading && !sw && !solar}
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
