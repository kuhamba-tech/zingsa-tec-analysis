"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getGlobalVtecByStation, getTecMethodComparison, getTecMethodPeriods } from "@/lib/api";
import { idwFillByStation, stationCodeKey, type LatLonSite } from "@/lib/idwSurface";
import type { TecMethodComparisonResponse, TecMethodStationCompare } from "@/lib/types";

const REFRESH_MS = 90_000;
const GOPI_COLOR = "#38bdf8";
const GG_COLOR = "#f59e0b";
const GLOBAL_COLOR = "#c4b5fd";

type CompareRow = TecMethodStationCompare & {
  global_latest: number | null;
  delta_gopi_global: number | null;
  delta_gg_global: number | null;
  gopi_interpolated: boolean;
  gg_interpolated: boolean;
};

function stationKey(code: string): string {
  return code.toLowerCase().replace(/_+$/, "");
}

function spread(a: number | null, b: number | null): number | null {
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((a - b) * 10) / 10;
}

function meanAbs(values: Array<number | null>): number | null {
  const nums = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (!nums.length) return null;
  return nums.reduce((sum, v) => sum + Math.abs(v), 0) / nums.length;
}

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
 * Live station-by-station VTEC: Method 1 GOPI (map) vs Method 2 Gg = Cesaroni.
 * Shown under the TEC Heat Map Live TEC strip.
 */
function signed(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const text = v.toFixed(1);
  return v > 0 ? `+${text}` : text;
}

export default function LiveTecMethodComparePanel({
  className = "",
  stations = [],
}: {
  className?: string;
  stations?: LatLonSite[];
}) {
  const [data, setData] = useState<TecMethodComparisonResponse | null>(null);
  const [periods, setPeriods] = useState<Awaited<ReturnType<typeof getTecMethodPeriods>> | null>(null);
  const [periodDay, setPeriodDay] = useState<string | null>(null);
  const [globalByCode, setGlobalByCode] = useState<Record<string, number>>({});
  const [globalEpoch, setGlobalEpoch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      getTecMethodComparison(2, undefined, 300, 60_000)
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
      getGlobalVtecByStation(2, true)
        .then((globalTec) => {
          if (cancelled || !globalTec) return;
          const map: Record<string, number> = {};
          for (const row of globalTec.latest ?? []) {
            if (typeof row.vtec_tecu === "number" && Number.isFinite(row.vtec_tecu) && row.vtec_tecu > 0) {
              map[stationKey(row.station)] = row.vtec_tecu;
            }
          }
          for (const row of globalTec.stations ?? []) {
            const key = stationKey(row.station);
            if (map[key] != null) continue;
            if (typeof row.latest_vtec === "number" && Number.isFinite(row.latest_vtec) && row.latest_vtec > 0) {
              map[key] = row.latest_vtec;
            }
          }
          setGlobalByCode(map);
          setGlobalEpoch(globalTec.epoch ?? null);
        })
        .catch(() => {
          if (!cancelled) {
            setGlobalByCode({});
            setGlobalEpoch(null);
          }
        });
    };
    load();
    const id = window.setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadPeriods = () => {
      getTecMethodPeriods(periodDay)
        .then((payload) => {
          if (!cancelled) setPeriods(payload);
        })
        .catch(() => {
          if (!cancelled) setPeriods(null);
        });
    };
    loadPeriods();
    const id = window.setInterval(loadPeriods, REFRESH_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [periodDay]);

  const rows: CompareRow[] = useMemo(() => {
    const byCode = new Map<string, TecMethodStationCompare>();
    const measuredGopi: Record<string, number> = {};
    const measuredGg: Record<string, number> = {};
    for (const row of data?.stations ?? []) {
      const key = stationKey(row.station);
      byCode.set(key, row);
      if (typeof row.gopi_latest === "number" && Number.isFinite(row.gopi_latest) && row.gopi_latest > 0) {
        measuredGopi[key] = row.gopi_latest;
      }
      if (typeof row.gg_latest === "number" && Number.isFinite(row.gg_latest) && row.gg_latest > 0) {
        measuredGg[key] = row.gg_latest;
      }
    }
    const gopiFill = idwFillByStation(stations, measuredGopi);
    const ggFill = idwFillByStation(stations, measuredGg);
    const codes = new Set<string>([
      ...byCode.keys(),
      ...Object.keys(globalByCode),
      ...stations.map((site) => stationCodeKey(site.code)),
    ]);
    return [...codes]
      .map((code) => {
        const row = byCode.get(code);
        const globalLatest = globalByCode[code] ?? null;
        const gopi = gopiFill.values[code] ?? row?.gopi_latest ?? null;
        const gg = ggFill.values[code] ?? row?.gg_latest ?? null;
        return {
          station: (row?.station ?? code).toUpperCase(),
          gopi_latest: gopi,
          gg_latest: gg,
          gopi_mean: row?.gopi_mean ?? null,
          gg_mean: row?.gg_mean ?? null,
          delta_latest: spread(gg, gopi),
          delta_mean: row?.delta_mean ?? null,
          gopi_samples: row?.gopi_samples ?? 0,
          gg_samples: row?.gg_samples ?? 0,
          gopi_time: row?.gopi_time,
          gg_time: row?.gg_time,
          global_latest: globalLatest,
          delta_gopi_global: spread(gopi, globalLatest),
          delta_gg_global: spread(gg, globalLatest),
          gopi_interpolated: Boolean(gopiFill.interpolated[code]),
          gg_interpolated: Boolean(ggFill.interpolated[code]),
        };
      })
      .filter((row) => row.gopi_latest != null || row.gg_latest != null || row.global_latest != null)
      .sort((a, b) => a.station.localeCompare(b.station));
  }, [data, globalByCode, stations]);

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

  const globalRange = useMemo(() => {
    const vals = rows.map((r) => r.global_latest).filter((v): v is number => v != null);
    if (!vals.length) return null;
    return { min: Math.min(...vals), max: Math.max(...vals) };
  }, [rows]);

  const variation = useMemo(
    () => ({
      ggGopi: meanAbs(rows.map((r) => r.delta_latest)),
      gopiGlobal: meanAbs(rows.map((r) => r.delta_gopi_global)),
      ggGlobal: meanAbs(rows.map((r) => r.delta_gg_global)),
    }),
    [rows],
  );

  return (
    <section className={`live-tec-method-compare ${className}`.trim()} aria-live="polite">
      <header className="live-tec-method-compare-head">
        <div>
          <div className="live-tec-method-compare-title">Live VTEC method comparison</div>
          <p className="live-tec-method-compare-lead">
            GOPI and Gg at each CORS station, set against the DLR global TEC map at the same site.
            A station without its own sample is filled by inverse-distance interpolation from nearby
            measured stations of that method. Δ is the local value minus the comparison value, in TECU.
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
          <strong>Gg = Cesaroni</strong>
          <span>
            Arc-bias + VTEC(MODIP, LT) least squares on the same samples (elev ≥ 30°, IPP 350 km).
            Calibration is the key difference from Method 1 (Ciraolo 2007; Cesaroni 2015/2021; PyTECGg).
          </span>
          <span className="live-tec-method-pill-range" style={{ color: GG_COLOR }}>
            {ggRange ? `${ggRange.min.toFixed(1)}–${ggRange.max.toFixed(1)} TECU` : "—"}
          </span>
        </div>
        <div className="live-tec-method-pill" style={{ borderColor: GLOBAL_COLOR }}>
          <span className="live-tec-method-pill-tag" style={{ color: GLOBAL_COLOR }}>
            Global TEC · DLR
          </span>
          <strong>1-hour global map</strong>
          <span>
            DLR IMPC global VTEC sampled at each Zimbabwe CORS coordinate. This is the background
            ionosphere, not a receiver measurement.
            {globalEpoch ? ` Epoch ${globalEpoch.replace("T", " ").replace("Z", " UTC")}.` : ""}
          </span>
          <span className="live-tec-method-pill-range" style={{ color: GLOBAL_COLOR }}>
            {globalRange ? `${globalRange.min.toFixed(1)}–${globalRange.max.toFixed(1)} TECU` : "—"}
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
                <th style={{ color: GOPI_COLOR }}>GOPI</th>
                <th style={{ color: GG_COLOR }}>Gg</th>
                <th style={{ color: GLOBAL_COLOR }}>Global</th>
                <th>Gg − GOPI</th>
                <th>GOPI − Global</th>
                <th>Gg − Global</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.station}>
                  <td>
                    <strong>{r.station}</strong>
                  </td>
                  <td
                    style={{ color: GOPI_COLOR }}
                    title={r.gopi_interpolated ? "Interpolated from nearby measured GOPI" : "Measured GOPI"}
                  >
                    {fmt(r.gopi_latest)}
                  </td>
                  <td
                    style={{ color: GG_COLOR }}
                    title={r.gg_interpolated ? "Interpolated from nearby measured Gg" : "Measured Gg"}
                  >
                    {fmt(r.gg_latest)}
                  </td>
                  <td style={{ color: GLOBAL_COLOR }}>{fmt(r.global_latest)}</td>
                  <td className={deltaClass(r.delta_latest)}>{fmt(r.delta_latest)}</td>
                  <td className={deltaClass(r.delta_gopi_global)}>{fmt(r.delta_gopi_global)}</td>
                  <td className={deltaClass(r.delta_gg_global)}>{fmt(r.delta_gg_global)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data?.summary && (
        <div className="live-tec-method-compare-foot">
          <span>
            Stations: <strong>{rows.length}</strong>
            {variation.ggGopi != null && (
              <>
                {" "}
                · mean |Gg − GOPI|: <strong>{variation.ggGopi.toFixed(1)} TECU</strong>
              </>
            )}
            {variation.gopiGlobal != null && (
              <>
                {" "}
                · mean |GOPI − Global|: <strong>{variation.gopiGlobal.toFixed(1)} TECU</strong>
              </>
            )}
            {variation.ggGlobal != null && (
              <>
                {" "}
                · mean |Gg − Global|: <strong>{variation.ggGlobal.toFixed(1)} TECU</strong>
              </>
            )}
          </span>
          <span className="live-tec-method-compare-note">
            {data.note ??
              "A stable Δ means calibration offset (bias model), not a second ionosphere."}
          </span>
        </div>
      )}

      {periods && (
        <div className="live-tec-method-periods">
          <div>
            <div className="live-tec-method-compare-title">Morning, afternoon, and night</div>
            <p className="live-tec-method-compare-lead">
              Stored measured hours for {periods.day}, {periods.timezone}. Each number is the
              median of the station-hours in that part of the day. A positive difference means
              the first value is higher. Choose a date to compare days.
            </p>
          </div>
          {(periods.logged_days?.length ?? 0) > 0 && (
            <div className="live-tec-method-period-days">
              <button
                type="button"
                className={periodDay == null ? "is-active" : ""}
                onClick={() => setPeriodDay(null)}
              >
                Today
              </button>
              {periods.logged_days.map((day) => (
                <button
                  key={day}
                  type="button"
                  className={periodDay === day ? "is-active" : ""}
                  onClick={() => setPeriodDay(day)}
                >
                  {day}
                </button>
              ))}
            </div>
          )}
          <div className="live-tec-method-period-grid">
            {periods.periods.map((period) => (
              <article key={period.id} className="live-tec-method-period-card">
                <h3>{period.label}</h3>
                <p>{period.hours_local}</p>
                {period.station_hours === 0 ? (
                  <p>No measured hours stored for this part of the day.</p>
                ) : (
                  <>
                    <p>GOPI {fmt(period.gopi)} · Gg {fmt(period.gg)} · Global {fmt(period.global)} TECU</p>
                    <p>Gg − GOPI <strong className={deltaClass(period.gg_minus_gopi)}>{signed(period.gg_minus_gopi)}</strong></p>
                    <p>GOPI − Global <strong className={deltaClass(period.gopi_minus_global)}>{signed(period.gopi_minus_global)}</strong></p>
                    <p>Gg − Global <strong className={deltaClass(period.gg_minus_global)}>{signed(period.gg_minus_global)}</strong></p>
                    <p>{period.station_hours} station-hours</p>
                  </>
                )}
              </article>
            ))}
          </div>
          {periods.note && <p className="live-tec-method-compare-note">{periods.note}</p>}
        </div>
      )}

      {data?.references?.length ? (
        <details className="live-tec-method-compare-refs">
          <summary>Gg = Cesaroni references</summary>
          <ul>
            {data.references.map((r) => (
              <li key={r.doi}>
                {r.cite}: {r.title}. DOI:{" "}
                <a href={`https://doi.org/${r.doi}`} target="_blank" rel="noreferrer">
                  {r.doi}
                </a>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
