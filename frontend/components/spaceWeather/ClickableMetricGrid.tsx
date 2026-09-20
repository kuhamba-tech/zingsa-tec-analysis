"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { SolarActivityFull, SpaceWeatherCurrent } from "@/lib/types";
import type { LiveStationCounts } from "@/lib/liveStationStatus";
import { FLARE_SCALE } from "@/lib/solarEventColors";
import {
  METRIC_EXPLANATIONS,
  NOAA_G_SCALE,
  TEC_VTEC_SCALE,
  buildMetricCards,
  interpretMetric,
  type MetricCardSpec,
  type MetricDetailRow,
  type MetricKey,
} from "@/lib/spaceWeatherMetrics";
import TecPrimerBlock from "./TecPrimerBlock";
import { MetricCardIcon, MetricDetailIcon } from "./MetricCardIcons";

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
      {rows.map((row) => {
        const detailIcon = row.icon ? <MetricDetailIcon kind={row.icon} /> : null;
        return (
          <div className="sw-metric-detail-row" key={row.label}>
            <span className="sw-metric-detail-left">
              {detailIcon || row.icon ? (
                <span className="sw-metric-detail-icon" aria-hidden>
                  {detailIcon ?? row.icon}
                </span>
              ) : null}
              <span className="sw-metric-detail-label">{row.label}</span>
            </span>
            <span className="sw-metric-detail-value" style={row.valueColor ? { color: row.valueColor } : undefined}>
              {row.value}
            </span>
          </div>
        );
      })}
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

function GScaleLegend({ activeCode }: { activeCode?: string | null }) {
  return (
    <div className="sw-metric-flare-scale sw-metric-g-scale" aria-label="NOAA G-scale">
      {NOAA_G_SCALE.map((g) => {
        const active = activeCode === g.code;
        return (
          <div
            className={`sw-metric-flare-scale-item${active ? " is-active" : ""}`}
            key={g.code}
          >
            <div
              className="sw-metric-flare-scale-bar"
              style={{
                background: g.color,
                height: active ? 4 : 2,
                opacity: active || !activeCode ? 1 : 0.45,
              }}
            />
            <div
              className="sw-metric-flare-scale-letter"
              style={{
                color: g.color,
                fontWeight: active ? 900 : 800,
              }}
            >
              {g.code}
            </div>
            <div className="sw-metric-flare-scale-desc">{g.desc}</div>
          </div>
        );
      })}
    </div>
  );
}

function TecScaleLegend({ activeCode }: { activeCode?: string | null }) {
  return (
    <div
      className="sw-metric-flare-scale sw-metric-g-scale sw-metric-tec-scale"
      aria-label="Typical VTEC scale"
    >
      {TEC_VTEC_SCALE.map((level) => {
        const active = activeCode === level.code;
        return (
          <div
            className={`sw-metric-flare-scale-item${active ? " is-active" : ""}`}
            key={level.code}
            title={`${level.desc}: ${level.range} TECU`}
          >
            <div
              className="sw-metric-flare-scale-bar"
              style={{
                background: level.color,
                height: active ? 4 : 2,
                opacity: active || !activeCode ? 1 : 0.45,
              }}
            />
            <div
              className="sw-metric-flare-scale-letter"
              style={{
                color: level.color,
                fontWeight: active ? 900 : 800,
              }}
            >
              {level.desc}
            </div>
            <div className="sw-metric-flare-scale-desc">{level.desc}</div>
          </div>
        );
      })}
    </div>
  );
}

function MetricCardButton({
  metricKey,
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
  showGScale,
  activeGCode,
  showTecScale,
  activeTecCode,
  selected,
  disabled,
  onClick,
}: {
  metricKey: MetricKey;
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
  showGScale?: boolean;
  activeGCode?: string | null;
  showTecScale?: boolean;
  activeTecCode?: string | null;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const isSummary = Boolean(detailRows?.length) && !detailRows?.some((r) => r.icon);
  const isWindList = Boolean(detailRows?.some((r) => r.icon));
  const isFlare = Boolean(showFlareScale);
  const isGStorm = Boolean(showGScale);
  const isTecIono = Boolean(showTecScale);
  const isEventCount =
    metricKey === "donki_flares" || metricKey === "donki_cmes" || metricKey === "donki_storms";

  return (
    <button
      type="button"
      className={`sw-metric-card${isSummary ? " sw-metric-card-summary" : ""}${isWindList ? " sw-metric-card-wind" : ""}${isFlare ? " sw-metric-card-flare" : ""}${isGStorm ? " sw-metric-card-gstorm" : ""}${isTecIono ? " sw-metric-card-tec" : ""}${isEventCount ? " sw-metric-card-events" : ""}${selected ? " sw-metric-card-selected" : ""}${disabled ? " is-loading" : ""}`}
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={`${label}: ${value}. Click for explanation.`}
    >
      <span className="sw-metric-icon" aria-hidden>
        <MetricCardIcon metricKey={metricKey} />
      </span>
      <div className="sw-metric-label">{label}</div>
      {isFlare && <div className="sw-metric-eyebrow">Current class:</div>}
      <div className="sw-metric-value" style={{ color: valueColor }}>
        {value}
      </div>
      {subtitle ? <div className="sw-metric-subtitle">{subtitle}</div> : null}
      {detailRows?.length ? <DetailRows rows={detailRows} /> : null}
      {showFlareScale ? <FlareScaleLegend /> : null}
      {showGScale ? <GScaleLegend activeCode={activeGCode} /> : null}
      {showTecScale ? <TecScaleLegend activeCode={activeTecCode} /> : null}
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
  panelRef,
}: {
  label: string;
  value: string;
  metricKey: MetricKey;
  sw: SpaceWeatherCurrent | null;
  solar?: SolarActivityFull | null;
  liveMeanVtec?: number | null;
  panelRef?: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="sw-metric-explain" ref={panelRef}>
      <div className="sw-metric-explain-title">{label}</div>
      <div className="sw-metric-explain-current">Current value: {value}</div>
      <div className="sw-metric-explain-heading">Explanation</div>
      <p className="sw-metric-explain-body">{METRIC_EXPLANATIONS[metricKey]}</p>
      {metricKey === "zimbabwe_iono" && (
        <div style={{ marginTop: "0.75rem" }}>
          <TecPrimerBlock />
        </div>
      )}
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
      {(metricKey === "donki_flares" ||
        metricKey === "donki_cmes" ||
        metricKey === "donki_storms") &&
        solar && (
          <div className="sw-metric-explain-body" style={{ marginTop: "0.65rem" }}>
            <div className="sw-metric-explain-heading">Expanded details</div>
            <ul style={{ margin: "0.35rem 0 0", paddingLeft: "1.1rem" }}>
              <li>Feed: NASA DONKI ({solar.donki_status || "unknown"})</li>
              {solar.donki_date_start && solar.donki_date_end ? (
                <li>
                  Window: {solar.donki_date_start} – {solar.donki_date_end}
                </li>
              ) : null}
              <li>
                Flare events:{" "}
                {Array.isArray(solar.donki_flares) ? solar.donki_flares.length : "—"}
              </li>
              <li>
                CME events: {Array.isArray(solar.donki_cmes) ? solar.donki_cmes.length : "—"}
              </li>
              <li>
                Geomagnetic storm events:{" "}
                {Array.isArray(solar.donki_storms) ? solar.donki_storms.length : "—"}
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
  const explainRef = useRef<HTMLDivElement | null>(null);
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

  const bootstrapping = loading && !sw && !solar;

  // Close the explanation once the user scrolls down past it.
  useEffect(() => {
    if (!selected) return;
    const el = explainRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        // Fully above the viewport → scrolled past while going down.
        if (!entry.isIntersecting && entry.boundingClientRect.bottom < 0) {
          setSelected(null);
        }
      },
      { threshold: 0, root: null, rootMargin: "0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [selected]);

  return (
    <div className="sw-metric-section">
      {showHint && (
        <p className="sw-metric-hint">
          What is happening now — click a card for the scientific explanation.{updatedNote}
          {bootstrapping ? " · Connecting to live feeds…" : ""}
        </p>
      )}
      <div className="dashboard-metric-grid sw-metric-grid">
        {cards.map((card) => (
          <MetricCardButton
            key={card.key}
            metricKey={card.key}
            label={card.label}
            value={card.value}
            note={card.note}
            valueColor={card.valueColor}
            source={card.source}
            observedAt={card.observedAt}
            freshness={card.freshness}
            subtitle={card.subtitle}
            detailRows={card.detailRows}
            showFlareScale={card.showFlareScale}
            showGScale={card.showGScale}
            activeGCode={card.activeGCode}
            showTecScale={card.showTecScale}
            activeTecCode={card.activeTecCode}
            selected={selected === card.key}
            disabled={false}
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
          panelRef={explainRef}
        />
      )}
    </div>
  );
}
