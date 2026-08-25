"use client";

import { useMemo, useState, useTransition } from "react";
import type { Station } from "@/lib/types";
import {
  buildCorsNetworkEdges,
  filterNetworkEdges,
  networkEdgesToCsv,
} from "@/lib/corsNetworkDistances";
import {
  clampNewSiteCount,
  isValidProposedCorsSite,
  MAX_NEW_SITES,
  MIN_NEW_SITES,
  NRTK_SPACING_MAX_KM,
  NRTK_SPACING_MIN_KM,
  optimizeCorsPlacement,
  SINGLE_RTK_RECOMMENDED_KM,
  type GeneticOptimizeResult,
  type ProposedCorsSite,
  USEFUL_COVERAGE_KM,
} from "@/lib/corsGeneticOptimizer";
import RoverLoadPanel from "./RoverLoadPanel";

interface Props {
  stations: Station[];
  proposedSites: ProposedCorsSite[];
  onProposedSitesChange: (sites: ProposedCorsSite[]) => void;
}

function spacingClassForKm(distanceKm: number): string {
  if (distanceKm < NRTK_SPACING_MIN_KM) return "network-distances-km is-tight";
  if (distanceKm > NRTK_SPACING_MAX_KM) return "network-distances-km is-wide";
  return "network-distances-km is-ok";
}

function spacingTitleForKm(distanceKm: number): string {
  if (distanceKm < NRTK_SPACING_MIN_KM) {
    return `Below Leica NRTK spacing floor (${NRTK_SPACING_MIN_KM} km)`;
  }
  if (distanceKm > NRTK_SPACING_MAX_KM) {
    return `Above Leica NRTK spacing ceiling (${NRTK_SPACING_MAX_KM} km)`;
  }
  return `Within Leica NRTK spacing band (${NRTK_SPACING_MIN_KM}–${NRTK_SPACING_MAX_KM} km)`;
}

export default function NetworkDistancesPanel({
  stations,
  proposedSites,
  onProposedSitesChange,
}: Props) {
  const [query, setQuery] = useState("");
  const [newSiteCount, setNewSiteCount] = useState(4);
  const [result, setResult] = useState<GeneticOptimizeResult | null>(null);
  const [pending, startTransition] = useTransition();

  const edges = useMemo(() => buildCorsNetworkEdges(stations, 3), [stations]);
  const visible = useMemo(() => filterNetworkEdges(edges, query), [edges, query]);

  const downloadCsv = () => {
    const blob = new Blob([networkEdgesToCsv(visible)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `zimbabwe-cors-network-distances.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const runOptimizer = () => {
    const count = clampNewSiteCount(newSiteCount);
    setNewSiteCount(count);
    startTransition(() => {
      const next = optimizeCorsPlacement(stations, {
        newSiteCount: count,
        seed: Date.now() % 1_000_000,
      });
      const inlandOnly = next.proposed.filter((s) => isValidProposedCorsSite(s.lat, s.lon));
      setResult({ ...next, proposed: inlandOnly });
      onProposedSitesChange(inlandOnly);
    });
  };

  const clearProposed = () => {
    setResult(null);
    onProposedSitesChange([]);
  };

  const emptyMessage =
    stations.length === 0 ? "No CORS stations loaded." : "No baselines match this search.";

  return (
    <aside className="network-distances-panel" aria-label="Measured CORS network distances">
      <header className="network-distances-panel-head">
        <div>
          <h3 className="network-distances-panel-title">Measured Distances</h3>
          <p className="network-distances-panel-sub">
            {visible.length} baseline{visible.length === 1 ? "" : "s"} · great-circle km
          </p>
        </div>
        <button
          type="button"
          className="network-distances-download"
          onClick={downloadCsv}
          disabled={visible.length === 0}
          title="Download CSV"
          aria-label="Download measured distances as CSV"
        >
          ⬇
        </button>
      </header>

      <section className="network-ga-block" aria-label="Genetic CORS placement optimizer">
        <div className="network-ga-head">
          <h4 className="network-ga-title">GA network optimization</h4>
          <p className="network-ga-lead">
            Enter how many new CORS stations to add. The optimiser analyses the whole network and
            places sites in distinct coverage gaps nationwide (not clustered in one corridor),
            only inside Zimbabwe. Uses Leica NRTK spacing {NRTK_SPACING_MIN_KM}–{NRTK_SPACING_MAX_KM}{" "}
            km · rover ≤ {USEFUL_COVERAGE_KM} km · single RTK prefer ≤ {SINGLE_RTK_RECOMMENDED_KM} km.
          </p>
        </div>

        <div className="network-ga-controls">
          <label className="network-ga-count">
            <span>Stations to add</span>
            <input
              type="number"
              min={MIN_NEW_SITES}
              max={MAX_NEW_SITES}
              step={1}
              value={newSiteCount}
              onChange={(e) => setNewSiteCount(Number(e.target.value))}
              onBlur={() => setNewSiteCount(clampNewSiteCount(newSiteCount))}
              disabled={pending}
              aria-label={`Number of new CORS stations to add (${MIN_NEW_SITES}–${MAX_NEW_SITES})`}
            />
          </label>
          <button
            type="button"
            className="network-ga-run"
            onClick={runOptimizer}
            disabled={pending || stations.length === 0}
          >
            {pending ? "Optimizing…" : "Run genetic algorithm"}
          </button>
          {proposedSites.length > 0 && (
            <button type="button" className="network-ga-clear" onClick={clearProposed} disabled={pending}>
              Clear
            </button>
          )}
        </div>

        {result && (
          <div className="network-ga-result">
            <div className="network-ga-metrics">
              <div>
                <span className="network-ga-metric-label">Coverage ≤{USEFUL_COVERAGE_KM} km</span>
                <strong>
                  {result.before.coverageWithinUsefulPct}% → {result.after.coverageWithinUsefulPct}%
                </strong>
              </div>
              <div>
                <span className="network-ga-metric-label">Mean nearest</span>
                <strong>
                  {result.before.meanNearestKm} → {result.after.meanNearestKm} km
                </strong>
              </div>
              <div>
                <span className="network-ga-metric-label">Max gap</span>
                <strong>
                  {result.before.maxNearestKm} → {result.after.maxNearestKm} km
                </strong>
              </div>
            </div>

            <ul className="network-ga-sites">
              {result.proposed.map((site) => (
                <li key={site.id}>
                  <strong>{site.label}</strong>
                  <span>
                    {site.lat.toFixed(3)}°, {site.lon.toFixed(3)}°
                  </span>
                  <span className="network-ga-site-hint">{site.regionHint}</span>
                  <span className="network-ga-site-meta">
                    {site.nearestExistingKm.toFixed(1)} km from {site.nearestExistingCode}
                  </span>
                </li>
              ))}
            </ul>

            <p className="network-ga-footnote">
              {result.newSiteCount} site{result.newSiteCount === 1 ? "" : "s"} · {result.generations}{" "}
              generations · pop {result.populationSize} · {result.elapsedMs} ms
              {result.improvementPct !== 0
                ? ` · coverage Δ ${result.improvementPct > 0 ? "+" : ""}${result.improvementPct}%`
                : ""}
            </p>
          </div>
        )}
      </section>

      <RoverLoadPanel stations={stations} />

      <label className="network-distances-search">
        <span className="network-distances-search-label">Search stations</span>
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search stations…"
          autoComplete="off"
        />
      </label>

      <div className="network-distances-table-wrap">
        <table className="network-distances-table">
          <thead>
            <tr>
              <th>From Station</th>
              <th>To Station</th>
              <th>Distance (km)</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 ? (
              <tr>
                <td colSpan={3} className="network-distances-empty">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              visible.map((edge) => (
                <tr key={edge.id}>
                  <td>{edge.fromName}</td>
                  <td>{edge.toName}</td>
                  <td className={spacingClassForKm(edge.distanceKm)} title={spacingTitleForKm(edge.distanceKm)}>
                    {edge.distanceKm.toFixed(1)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </aside>
  );
}
