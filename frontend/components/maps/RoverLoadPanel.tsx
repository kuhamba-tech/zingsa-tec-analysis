"use client";

import { useEffect, useState } from "react";
import { getRoverClients } from "@/lib/api";
import type { RoverClientsSnapshot, Station } from "@/lib/types";

interface Props {
  stations: Station[];
}

function fromStations(stations: Station[]): RoverClientsSnapshot | null {
  const withCounts = stations.filter((s) => s.connected_rovers != null);
  if (withCounts.length === 0) return null;
  const ranked = [...withCounts].sort(
    (a, b) => (b.connected_rovers ?? 0) - (a.connected_rovers ?? 0),
  );
  const total = ranked.reduce((sum, s) => sum + (s.connected_rovers ?? 0), 0);
  return {
    available: true,
    updated_at: null,
    source: "stations",
    message: null,
    total_rovers: total,
    stations_with_rovers: ranked.filter((s) => (s.connected_rovers ?? 0) > 0).length,
    busiest_code: ranked[0]?.code ?? null,
    busiest_count: ranked[0]?.connected_rovers ?? 0,
    stations: ranked.map((s, i) => ({
      code: s.code,
      mountpoint: s.mountpoint ?? s.code.toUpperCase(),
      name: s.name,
      connected_rovers: s.connected_rovers ?? 0,
      peak_24h: s.rover_peak_24h ?? null,
      share_pct: s.rover_share_pct ?? null,
      rank: s.rover_rank ?? i + 1,
    })),
  };
}

export default function RoverLoadPanel({ stations }: Props) {
  const [snap, setSnap] = useState<RoverClientsSnapshot | null>(() => fromStations(stations));
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const fromSt = fromStations(stations);
    if (fromSt) setSnap(fromSt);
  }, [stations]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getRoverClients()
      .then((data) => {
        if (!cancelled) setSnap(data);
      })
      .catch(() => {
        if (!cancelled) {
          setSnap((prev) => prev ?? fromStations(stations) ?? {
            available: false,
            updated_at: null,
            source: null,
            message:
              "Could not load rover client stats. Connect a Spider Business Center export to see live counts.",
            total_rovers: 0,
            stations_with_rovers: 0,
            busiest_code: null,
            busiest_count: 0,
            stations: [],
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [stations]);

  const available = snap?.available === true;
  const rows = available ? snap.stations : [];

  return (
    <section className="network-rover-block" aria-label="Live rover load by CORS">
      <div className="network-rover-head">
        <h4 className="network-rover-title">Live rover load</h4>
        <p className="network-rover-lead">
          NTRIP clients connected to each CORS — shows which sites are used most for network
          densification.
        </p>
      </div>

      {!available && (
        <p className="network-rover-empty">
          {loading
            ? "Loading rover stats…"
            : snap?.message ||
              "No Spider/caster client feed yet. Export connected rovers from Leica Spider Business Center into static/data/rover_clients.json (see rover_clients.example.json)."}
        </p>
      )}

      {available && (
        <>
          <div className="network-rover-metrics">
            <div>
              <span className="network-rover-metric-label">Rovers online</span>
              <strong>{snap.total_rovers}</strong>
            </div>
            <div>
              <span className="network-rover-metric-label">CORS with rovers</span>
              <strong>{snap.stations_with_rovers}</strong>
            </div>
            <div>
              <span className="network-rover-metric-label">Busiest</span>
              <strong>
                {snap.busiest_code
                  ? `${snap.busiest_code.toUpperCase()} (${snap.busiest_count})`
                  : "—"}
              </strong>
            </div>
          </div>

          <div className="network-distances-table-wrap network-rover-table-wrap">
            <table className="network-distances-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>CORS</th>
                  <th>Rovers</th>
                  <th>Share</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="network-distances-empty">
                      Feed connected — no rovers online right now.
                    </td>
                  </tr>
                ) : (
                  rows.map((row) => (
                    <tr key={row.code}>
                      <td>{row.rank ?? "—"}</td>
                      <td>
                        <strong>{row.name || row.code.toUpperCase()}</strong>
                        <div className="network-rover-mp">{row.mountpoint}</div>
                      </td>
                      <td className="network-distances-km is-ok">{row.connected_rovers}</td>
                      <td className="network-distances-km">
                        {row.share_pct != null ? `${row.share_pct}%` : "—"}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {snap.updated_at && (
            <p className="network-rover-footnote">Updated {snap.updated_at.replace("T", " ").replace("Z", " UTC")}</p>
          )}
        </>
      )}
    </section>
  );
}
