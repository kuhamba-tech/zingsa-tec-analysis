"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getTecMethodComparison } from "@/lib/api";
import type { TecMethodComparisonResponse, TecMethodStationCompare } from "@/lib/types";

const REFRESH_MS = 90_000;
const GOPI_COLOR = "#38bdf8";
const GG_COLOR = "#f59e0b";

function fmt(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "—" : v.toFixed(1);
}

function deltaClass(d: number | null | undefined): string {
  if (d == null || !Number.isFinite(d)) return "";
  if (Math.abs(d) < 2) return "tec-cmp-delta-near";
  if (d > 0) return "tec-cmp-delta-pos";
  return "tec-cmp-delta-neg";
}

/**
 * Live station-by-station VTEC: Method 1 GOPI (map) vs Method 2 Gg (TEC_GNSS_Notebook_v5).
 * Shown under the TEC Heat Map Live TEC strip.
 */
export default function LiveTecMethodComparePanel({ className = "" }: { className?: string }) {
  const [data, setData] = useState<TecMethodComparisonResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getTecMethodComparison(3, undefined, 800, 45_000)
        .then((res) => {
          if (cancelled) return;
          setData(res);
          setError(null);
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : "Comparison unavailable");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    };
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  const rows: TecMethodStationCompare[] = useMemo(() => {
    const list = data?.stations ?? [];
    return [...list].sort((a, b) => a.station.localeCompare(b.station));
  }, [data]);

  const gopiRange = useMemo(() => {
    const vals = rows.map((r) => r.gopi_latest).filter((v): v is number => v != null);
    if (!vals.length) return null;
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }, [rows]);

  const ggRange = useMemo(() => {
    const vals = rows.map((r) => r.gg_latest).filter((v): v is number => v != null);
    if (!vals.length) return null;
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }, [rows]);

  return (
    <section className={`live-tec-method-compare ${className}`.trim()} aria-live="polite">
      <header className="live-tec-method-compare-head">
        <div>
          <div className="live-tec-method-compare-title">Live VTEC method comparison</div>
          <p className="live-tec-method-compare-lead">
            Same CORS dual-frequency samples, two calibrations — so you can see why absolute TECU
            can differ while the ionosphere is shared.
          </p>
        </div>
        <Link href="/space-weather/?tab=zimbabwe" className="live-tec-method-compare-link">
          Full charts &amp; teaching lab →
        </Link>
      </header>

      <div className="live-tec-method-compare-methods">
        <div className="live-tec-method-pill" style={{ borderColor: GOPI_COLOR }}>
          <span className="live-tec-method-pill-tag" style={{ color: GOPI_COLOR }}>
            Method 1 · GOPI
          </span>
          <strong>Seemala / Gopi Ch.4</strong>
          <span>
            Live NTRIP decode on the heat map — code TEC (Eq 4.11), thin-shell VTEC, elev ≥ 30°.
            Fast operational scale; residual DCB bias possible without monthly files.
          </span>
          <span className="live-tec-method-pill-range" style={{ color: GOPI_COLOR }}>
            {gopiRange ? `${gopiRange.min.toFixed(1)}–${gopiRange.max.toFixed(1)} TECU` : "—"}
          </span>
        </div>
        <div className="live-tec-method-pill" style={{ borderColor: GG_COLOR }}>
          <span className="live-tec-method-pill-tag" style={{ color: GG_COLOR }}>
            Method 2 · Gg
          </span>
          <strong>Ciraolo–Cesaroni / PyTECGg</strong>
          <span>
            From TEC_GNSS_Notebook_v5 — arc-bias + VTEC(MODIP, LT) polynomial least squares on the
            same samples (elev ≥ 15°). Absolute scale after joint bias removal.
          </span>
          <span className="live-tec-method-pill-range" style={{ color: GG_COLOR }}>
            {ggRange ? `${ggRange.min.toFixed(1)}–${ggRange.max.toFixed(1)} TECU` : "—"}
          </span>
        </div>
      </div>

      {loading && !data && (
        <div className="live-tec-method-compare-status">Computing Gg calibration on live GOPI samples…</div>
      )}
      {error && !data && (
        <div className="live-tec-method-compare-status live-tec-method-compare-status--err">{error}</div>
      )}

      {rows.length > 0 && (
        <div className="live-tec-method-compare-table-wrap">
          <table className="live-tec-method-compare-table">
            <thead>
              <tr>
                <th>Station</th>
                <th style={{ color: GOPI_COLOR }}>GOPI latest</th>
                <th style={{ color: GG_COLOR }}>Gg latest</th>
                <th>Δ (Gg−GOPI)</th>
                <th style={{ color: GOPI_COLOR }}>GOPI mean</th>
                <th style={{ color: GG_COLOR }}>Gg mean</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.station}>
                  <td>
                    <strong>{r.station}</strong>
                  </td>
                  <td style={{ color: GOPI_COLOR }}>{fmt(r.gopi_latest)}</td>
                  <td style={{ color: GG_COLOR }}>{fmt(r.gg_latest)}</td>
                  <td className={deltaClass(r.delta_latest)}>{fmt(r.delta_latest)}</td>
                  <td style={{ color: GOPI_COLOR }}>{fmt(r.gopi_mean)}</td>
                  <td style={{ color: GG_COLOR }}>{fmt(r.gg_mean)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.summary && (
        <div className="live-tec-method-compare-foot">
          <span>
            Paired stations: <strong>{data.summary.paired_stations ?? 0}</strong>
            {data.summary.mean_delta_latest_tecu != null && (
              <>
                {" "}
                · mean Δ latest: <strong>{fmt(data.summary.mean_delta_latest_tecu)} TECU</strong>
              </>
            )}
          </span>
          <span className="live-tec-method-compare-note">
            {data.note ??
              "A stable Δ means calibration offset (bias model), not a second ionosphere."}
          </span>
        </div>
      )}
    </section>
  );
}
