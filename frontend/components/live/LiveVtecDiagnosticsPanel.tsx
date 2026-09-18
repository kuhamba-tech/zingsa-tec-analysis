"use client";

import { useEffect, useMemo, useState } from "react";
import { getLiveVtecHealth } from "@/lib/api";
import { liveVtecBlockerLabel, liveVtecSourceLabel } from "@/lib/liveVtecLabels";
import type { LiveVtecHealth, LiveVtecStationHealth } from "@/lib/types";

const REFRESH_MS = 60_000;

function blockerRows(stations: LiveVtecStationHealth[]) {
  return stations
    .filter((s) => s.blocker && s.source !== "live")
    .sort((a, b) => a.station.localeCompare(b.station));
}

type Props = {
  className?: string;
};

export default function LiveVtecDiagnosticsPanel({ className }: Props) {
  const [health, setHealth] = useState<LiveVtecHealth | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      getLiveVtecHealth()
        .then((payload) => {
          if (!cancelled) setHealth(payload);
        })
        .catch(() => {
          if (!cancelled) setHealth(null);
        });
    void load();
    const id = window.setInterval(() => void load(), REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const waiting = useMemo(
    () => (health ? blockerRows(health.stations) : []),
    [health],
  );

  if (!health) return null;

  return (
    <section className={`live-vtec-diagnostics card ${className ?? ""}`.trim()} aria-label="Live VTEC diagnostics">
      <h2 className="home-section-heading" style={{ fontSize: "1rem", marginBottom: "0.5rem" }}>
        Live VTEC diagnostics
      </h2>
      <p className="station-vtec-plots-sub" style={{ marginBottom: "0.75rem" }}>
        Measured: {health.stations_measured_live} · Fresh DB consensus: {health.stations_with_fresh_vtec} ·
        Interpolated: {health.stations_interpolated}
        {health.ephemeris_svs != null ? ` · GPS ephemeris SVs: ${health.ephemeris_svs}` : ""}
      </p>
      {health.blockers.length > 0 && (
        <p className="banner banner-warn" style={{ marginBottom: "0.75rem", padding: "0.5rem 0.75rem" }}>
          {health.blockers.join(" · ")}
        </p>
      )}
      {waiting.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: "0.88rem" }}>
          All reporting sites have fresh live VTEC or no blockers detected.
        </p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="data-table" style={{ fontSize: "0.82rem" }}>
            <thead>
              <tr>
                <th>Site</th>
                <th>Source</th>
                <th>VTEC</th>
                <th>Issue</th>
              </tr>
            </thead>
            <tbody>
              {waiting.slice(0, 12).map((row) => (
                <tr key={row.station}>
                  <td>{row.station.toUpperCase()}</td>
                  <td>{liveVtecSourceLabel(row.source as "live" | "estimate" | "none")}</td>
                  <td>{row.vtec != null ? row.vtec.toFixed(1) : "—"}</td>
                  <td>{liveVtecBlockerLabel(row.blocker)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {waiting.length > 12 && (
            <p style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.35rem" }}>
              +{waiting.length - 12} more sites without fresh live VTEC
            </p>
          )}
        </div>
      )}
    </section>
  );
}
