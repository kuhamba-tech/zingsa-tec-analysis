"use client";

import { useMemo, useState } from "react";
import type { Station } from "@/lib/types";
import {
  buildCorsNetworkEdges,
  filterNetworkEdges,
  networkEdgesToCsv,
} from "@/lib/corsNetworkDistances";
import {
  NRTK_SPACING_MAX_KM,
  NRTK_SPACING_MIN_KM,
} from "@/lib/corsGeneticOptimizer";

interface Props {
  stations: Station[];
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

/** Measured CORS baselines only — no GA / rover overlays. */
export default function NetworkDistancesPanel({ stations }: Props) {
  const [query, setQuery] = useState("");

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

  const emptyMessage =
    stations.length === 0 ? "No CORS stations loaded." : "No baselines match this search.";

  const rows =
    visible.length === 0 ? (
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
    );

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
          <tbody>{rows}</tbody>
        </table>
      </div>
    </aside>
  );
}
